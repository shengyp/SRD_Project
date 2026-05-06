# 知识库服务：从 knowledge_topics 和 knowledge_documents 表获取数据
import asyncio
import aiomysql
from typing import List, Dict, Any, Optional
import json
import os
import re
import time
import hashlib
from functools import wraps
from pathlib import Path


def _simple_cache(ttl_seconds: int = 300):
    """简单的内存缓存装饰器（适用于异步方法）"""
    def decorator(func):
        cache_data = {"value": None, "timestamp": 0}
        lock = False  # 简单锁，防止并发刷新

        @wraps(func)
        async def wrapper(*args, **kwargs):
            nonlocal lock
            current_time = time.time()

            # 检查缓存是否有效
            if cache_data["value"] is not None:
                if current_time - cache_data["timestamp"] < ttl_seconds:
                    return cache_data["value"]

            # 缓存过期或不存在，执行函数
            result = await func(*args, **kwargs)
            cache_data["value"] = result
            cache_data["timestamp"] = current_time
            return result

        # 添加清除缓存的方法
        wrapper._cache_clear = lambda: cache_data.update({"value": None, "timestamp": 0})
        return wrapper
    return decorator


class KnowledgeService:
    """知识库服务，依赖 MySQL 连接池。"""

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool
        self._topics_cache: Optional[List[Dict[str, Any]]] = None
        self._topics_cache_time: float = 0
        self._topics_cache_ttl: int = 300  # 5分钟缓存

        # 文档列表缓存（仅缓存无筛选条件的第一页，最常用场景）
        self._docs_cache: Optional[Dict[str, Any]] = None
        self._docs_cache_time: float = 0
        self._docs_cache_ttl: int = 60  # 1分钟缓存
        self._sync_signature: Optional[str] = None
        self._sync_result: Optional[Dict[str, Any]] = None
        self._sync_lock = asyncio.Lock()

    def _knowledge_root(self) -> Path:
        backend_dir = Path(__file__).resolve().parents[2]
        return backend_dir / "SuiAgent-main" / "rag-skill" / "knowledge"

    def _catalog_path(self) -> Path:
        return self._knowledge_root() / "knowledge_catalog.json"

    def _clear_all_caches(self):
        self._clear_topics_cache()
        self._docs_cache = None
        self._docs_cache_time = 0
        try:
            self.get_keywords._cache_clear()  # type: ignore[attr-defined]
        except Exception:
            pass

    def _compute_local_signature(self, base_path: Path) -> str:
        if not base_path.exists():
            return "missing"
        entries = []
        for file_path in sorted(p for p in base_path.rglob("*") if p.is_file()):
            rel = str(file_path.relative_to(base_path)).replace("\\", "/")
            stat = file_path.stat()
            entries.append(f"{rel}|{int(stat.st_mtime)}|{stat.st_size}")
        return hashlib.sha1("\n".join(entries).encode("utf-8", errors="ignore")).hexdigest()

    def _slugify(self, text: str, fallback_prefix: str = "item") -> str:
        slug = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
        if slug:
            return slug
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]
        return f"{fallback_prefix}_{digest}"

    def _compose_sub_topic_code(self, topic_code: str, sub_name: str, max_length: int = 48) -> str:
        """生成稳定且受长度约束的 sub_topic_code，避免超出数据库字段限制。"""
        sub_slug = self._slugify(sub_name, "sub")
        code = f"{topic_code}__{sub_slug}"
        if len(code) <= max_length:
            return code

        digest = hashlib.sha1(f"{topic_code}|{sub_name}".encode("utf-8")).hexdigest()[:8]
        reserve = max_length - len(digest) - 2
        topic_prefix = topic_code[:max(8, reserve)]
        trimmed = f"{topic_prefix}__{digest}"
        return trimmed[:max_length]

    def _format_size(self, file_size: int) -> str:
        if file_size < 1024:
            return f"{file_size} B"
        if file_size < 1024 * 1024:
            return f"{file_size / 1024:.1f} KB"
        return f"{file_size / 1024 / 1024:.1f} MB"

    def _build_local_bundle_from_catalog(self, base_path: Path) -> Dict[str, Any]:
        catalog_path = self._catalog_path()
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)

        topics: List[Dict[str, Any]] = []
        sub_topics: List[Dict[str, Any]] = []
        documents: List[Dict[str, Any]] = []
        keyword_counts: Dict[str, int] = {}

        for topic_index, theme in enumerate(catalog.get("themes", []), start=1):
            topic_name = theme.get("theme_name_zh") or theme.get("theme_dir") or f"主题{topic_index}"
            theme_dir = theme.get("theme_dir") or topic_name
            topic_code = self._slugify(theme_dir, "topic")
            topic_keywords = list(theme.get("theme_aliases", []) or [])

            topics.append({
                "topic_code": topic_code,
                "topic_name": topic_name,
                "description": theme.get("description", ""),
                "sort_order": topic_index,
                "keywords": topic_keywords,
            })

            for sub_index, subtheme in enumerate(theme.get("subthemes", []), start=1):
                sub_name = subtheme.get("name") or f"{topic_name}-子主题{sub_index}"
                sub_code = self._compose_sub_topic_code(topic_code, sub_name)
                sub_keywords = list(subtheme.get("keywords", []) or [])
                sub_topics.append({
                    "topic_code": topic_code,
                    "sub_topic_code": sub_code,
                    "sub_topic_name": sub_name,
                    "description": subtheme.get("description", ""),
                    "sort_order": sub_index,
                    "keywords": sub_keywords,
                })

                for doc_index, doc in enumerate(subtheme.get("documents", []), start=1):
                    file_name = doc.get("filename", "")
                    if not file_name:
                        continue
                    file_path = base_path / theme_dir / file_name
                    if not file_path.exists():
                        continue
                    rel_path = file_path.relative_to(base_path).as_posix()
                    rag_path = f"rag-skill/knowledge/{rel_path}"
                    ext = file_path.suffix.lower().lstrip(".") or "txt"
                    title = doc.get("title") or file_path.stem
                    doc_keywords = []
                    for kw in (doc.get("keywords", []) or []):
                        if kw and kw not in doc_keywords:
                            doc_keywords.append(kw)
                    for kw in (doc.get("aliases", []) or []):
                        if kw and kw not in doc_keywords:
                            doc_keywords.append(kw)
                    for kw in topic_keywords + sub_keywords:
                        if kw and kw not in doc_keywords:
                            doc_keywords.append(kw)
                    for kw in doc_keywords:
                        keyword_counts[kw] = keyword_counts.get(kw, 0) + 1

                    documents.append({
                        "title": title,
                        "topic_code": topic_code,
                        "sub_topic_code": sub_code,
                        "keywords": doc_keywords[:30],
                        "description": doc.get("summary", "") or subtheme.get("description", "") or theme.get("description", ""),
                        "format": ext,
                        "file_name": file_name,
                        "file_path": rag_path,
                        "file_size": file_path.stat().st_size,
                        "size_display": self._format_size(file_path.stat().st_size),
                        "topic_name": topic_name,
                        "sub_topic_name": sub_name,
                        "source": doc.get("source", ""),
                        "audience": doc.get("audience", ""),
                        "sort_order": doc_index,
                    })

        keywords = []
        for sort_order, (keyword, count) in enumerate(sorted(keyword_counts.items(), key=lambda x: (-x[1], x[0])), start=1):
            keywords.append({
                "keyword": keyword,
                "category": "local_knowledge",
                "color_class": "blue",
                "is_hot": count >= 2,
                "usage_count": count,
                "sort_order": sort_order,
            })

        return {"topics": topics, "sub_topics": sub_topics, "documents": documents, "keywords": keywords}

    def _extract_keywords_from_title(self, title: str) -> List[str]:
        words = re.findall(r"[\u4e00-\u9fa5A-Za-z0-9\-]+", title)
        return [w for w in words if len(w) >= 2][:10]

    def _build_local_bundle_from_scan(self, base_path: Path) -> Dict[str, Any]:
        topics: List[Dict[str, Any]] = []
        sub_topics: List[Dict[str, Any]] = []
        documents: List[Dict[str, Any]] = []
        keywords_counter: Dict[str, int] = {}
        topic_seen = set()
        sub_seen = set()

        for theme_index, theme_dir in enumerate(sorted([p for p in base_path.iterdir() if p.is_dir()]), start=1):
            topic_name = theme_dir.name
            topic_code = self._slugify(topic_name, "topic")
            if topic_code not in topic_seen:
                topics.append({
                    "topic_code": topic_code,
                    "topic_name": topic_name,
                    "description": "",
                    "sort_order": theme_index,
                    "keywords": [],
                })
                topic_seen.add(topic_code)

            files = [p for p in theme_dir.iterdir() if p.is_file() and p.name != "data_structure.md"]
            if files:
                sub_name = "未细分子主题"
                sub_code = f"{topic_code}__uncategorized"
                if sub_code not in sub_seen:
                    sub_topics.append({
                        "topic_code": topic_code,
                        "sub_topic_code": sub_code,
                        "sub_topic_name": sub_name,
                        "description": "",
                        "sort_order": 1,
                        "keywords": [],
                    })
                    sub_seen.add(sub_code)
                for file in files:
                    rel_path = file.relative_to(base_path).as_posix()
                    keywords = self._extract_keywords_from_title(file.stem)
                    for kw in keywords:
                        keywords_counter[kw] = keywords_counter.get(kw, 0) + 1
                    documents.append({
                        "title": file.stem,
                        "topic_code": topic_code,
                        "sub_topic_code": sub_code,
                        "keywords": keywords,
                        "description": "",
                        "format": file.suffix.lower().lstrip(".") or "txt",
                        "file_name": file.name,
                        "file_path": f"rag-skill/knowledge/{rel_path}",
                        "file_size": file.stat().st_size,
                        "size_display": self._format_size(file.stat().st_size),
                        "topic_name": topic_name,
                        "sub_topic_name": sub_name,
                        "source": "",
                        "audience": "",
                        "sort_order": 1,
                    })

            for sub_index, sub_dir in enumerate(sorted([p for p in theme_dir.iterdir() if p.is_dir()]), start=1):
                sub_name = sub_dir.name
                sub_code = self._compose_sub_topic_code(topic_code, sub_name)
                if sub_code not in sub_seen:
                    sub_topics.append({
                        "topic_code": topic_code,
                        "sub_topic_code": sub_code,
                        "sub_topic_name": sub_name,
                        "description": "",
                        "sort_order": sub_index,
                        "keywords": [],
                    })
                    sub_seen.add(sub_code)
                for file in sorted([p for p in sub_dir.rglob("*") if p.is_file() and p.name != "data_structure.md"]):
                    rel_path = file.relative_to(base_path).as_posix()
                    keywords = self._extract_keywords_from_title(file.stem)
                    for kw in keywords:
                        keywords_counter[kw] = keywords_counter.get(kw, 0) + 1
                    documents.append({
                        "title": file.stem,
                        "topic_code": topic_code,
                        "sub_topic_code": sub_code,
                        "keywords": keywords,
                        "description": "",
                        "format": file.suffix.lower().lstrip(".") or "txt",
                        "file_name": file.name,
                        "file_path": f"rag-skill/knowledge/{rel_path}",
                        "file_size": file.stat().st_size,
                        "size_display": self._format_size(file.stat().st_size),
                        "topic_name": topic_name,
                        "sub_topic_name": sub_name,
                        "source": "",
                        "audience": "",
                        "sort_order": sub_index,
                    })

        keywords = []
        for sort_order, (keyword, count) in enumerate(sorted(keywords_counter.items(), key=lambda x: (-x[1], x[0])), start=1):
            keywords.append({
                "keyword": keyword,
                "category": "local_knowledge",
                "color_class": "blue",
                "is_hot": count >= 2,
                "usage_count": count,
                "sort_order": sort_order,
            })

        return {"topics": topics, "sub_topics": sub_topics, "documents": documents, "keywords": keywords}

    async def _upsert_topic(self, cursor, topic: Dict[str, Any]) -> int:
        await cursor.execute(
            """SELECT id FROM knowledge_topics WHERE topic_code = %s LIMIT 1""",
            (topic["topic_code"],)
        )
        existing = await cursor.fetchone()
        if existing:
            topic_id = existing["id"]
            await cursor.execute(
                """UPDATE knowledge_topics
                   SET topic_name = %s, description = %s, sort_order = %s, is_active = TRUE
                   WHERE id = %s""",
                (topic["topic_name"], topic["description"], topic["sort_order"], topic_id)
            )
            return topic_id

        await cursor.execute(
            """INSERT INTO knowledge_topics
               (topic_name, topic_code, description, icon, color, sort_order, is_active)
               VALUES (%s, %s, %s, %s, %s, %s, TRUE)""",
            (topic["topic_name"], topic["topic_code"], topic["description"], "FolderTree", "blue", topic["sort_order"])
        )
        return cursor.lastrowid

    async def _upsert_sub_topic(self, cursor, sub_topic: Dict[str, Any], topic_id: int) -> int:
        await cursor.execute(
            """SELECT id FROM knowledge_sub_topics WHERE sub_topic_code = %s LIMIT 1""",
            (sub_topic["sub_topic_code"],)
        )
        existing = await cursor.fetchone()
        if existing:
            sub_topic_id = existing["id"]
            await cursor.execute(
                """UPDATE knowledge_sub_topics
                   SET topic_id = %s, sub_topic_name = %s, description = %s, sort_order = %s, is_active = TRUE
                   WHERE id = %s""",
                (topic_id, sub_topic["sub_topic_name"], sub_topic["description"], sub_topic["sort_order"], sub_topic_id)
            )
            return sub_topic_id

        await cursor.execute(
            """INSERT INTO knowledge_sub_topics
               (topic_id, sub_topic_name, sub_topic_code, description, sort_order, is_active)
               VALUES (%s, %s, %s, %s, %s, TRUE)""",
            (topic_id, sub_topic["sub_topic_name"], sub_topic["sub_topic_code"], sub_topic["description"], sub_topic["sort_order"])
        )
        return cursor.lastrowid

    async def _upsert_document(self, cursor, doc: Dict[str, Any], topic_id: int, sub_topic_id: Optional[int]) -> int:
        legacy_file_path = f"/{doc['file_path'].lstrip('/')}"
        await cursor.execute(
            """SELECT id FROM knowledge_documents
               WHERE (file_path = %s OR file_path = %s) AND is_deleted = FALSE
               LIMIT 1""",
            (doc["file_path"], legacy_file_path)
        )
        existing = await cursor.fetchone()
        keywords_json = json.dumps(doc["keywords"], ensure_ascii=False)
        if existing:
            doc_id = existing["id"]
            await cursor.execute(
                """UPDATE knowledge_documents
                   SET title = %s, topic_id = %s, sub_topic_id = %s, keywords = %s,
                       format = %s, file_name = %s, file_path = %s, file_size = %s, size_display = %s,
                       description = %s, upload_status = 'uploaded', is_deleted = FALSE
                   WHERE id = %s""",
                (
                    doc["title"], topic_id, sub_topic_id, keywords_json, doc["format"], doc["file_name"], doc["file_path"],
                    doc["file_size"], doc["size_display"], doc["description"], doc_id
                )
            )
            return doc_id

        await cursor.execute(
            """INSERT INTO knowledge_documents
               (title, topic_id, sub_topic_id, keywords, format, file_name, file_path,
                file_size, size_display, description, upload_status, uploaded_at, uploaded_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'uploaded', NOW(), %s)""",
            (
                doc["title"], topic_id, sub_topic_id, keywords_json, doc["format"], doc["file_name"],
                doc["file_path"], doc["file_size"], doc["size_display"], doc["description"], "local_sync"
            )
        )
        return cursor.lastrowid

    async def _upsert_keyword(self, cursor, keyword: Dict[str, Any]) -> None:
        await cursor.execute(
            """SELECT id FROM knowledge_keywords WHERE keyword = %s LIMIT 1""",
            (keyword["keyword"],)
        )
        existing = await cursor.fetchone()
        if existing:
            await cursor.execute(
                """UPDATE knowledge_keywords
                   SET category = %s, color_class = %s, is_hot = %s, usage_count = %s,
                       sort_order = %s, is_active = TRUE
                   WHERE id = %s""",
                (
                    keyword["category"], keyword["color_class"], keyword["is_hot"], keyword["usage_count"],
                    keyword["sort_order"], existing["id"]
                )
            )
            return

        await cursor.execute(
            """INSERT INTO knowledge_keywords
               (keyword, category, color_class, is_hot, usage_count, sort_order, is_active)
               VALUES (%s, %s, %s, %s, %s, %s, TRUE)""",
            (
                keyword["keyword"], keyword["category"], keyword["color_class"], keyword["is_hot"],
                keyword["usage_count"], keyword["sort_order"]
            )
        )

    async def sync_local_knowledge_to_db(self, force: bool = False) -> Dict[str, Any]:
        base_path = self._knowledge_root()
        if not base_path.exists():
            return {"success": False, "message": f"知识库目录不存在: {base_path}", "imported": 0, "topics": 0, "sub_topics": 0, "keywords": 0}

        signature = self._compute_local_signature(base_path)
        if not force and self._sync_signature == signature and self._sync_result is not None:
            return self._sync_result

        async with self._sync_lock:
            signature = self._compute_local_signature(base_path)
            if not force and self._sync_signature == signature and self._sync_result is not None:
                return self._sync_result

            if self._catalog_path().exists():
                bundle = self._build_local_bundle_from_catalog(base_path)
            else:
                bundle = self._build_local_bundle_from_scan(base_path)

            imported = 0
            active_file_paths = [doc["file_path"] for doc in bundle["documents"]]
            active_topic_codes = [topic["topic_code"] for topic in bundle["topics"]]
            active_sub_codes = [sub["sub_topic_code"] for sub in bundle["sub_topics"]]
            active_keywords = [kw["keyword"] for kw in bundle["keywords"]]

            async with self.mysql_pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cursor:
                    await cursor.execute("SET NAMES utf8mb4")

                    topic_id_map: Dict[str, int] = {}
                    for topic in bundle["topics"]:
                        topic_id_map[topic["topic_code"]] = await self._upsert_topic(cursor, topic)

                    sub_id_map: Dict[str, int] = {}
                    for sub_topic in bundle["sub_topics"]:
                        topic_id = topic_id_map[sub_topic["topic_code"]]
                        sub_id_map[sub_topic["sub_topic_code"]] = await self._upsert_sub_topic(cursor, sub_topic, topic_id)

                    for doc in bundle["documents"]:
                        topic_id = topic_id_map[doc["topic_code"]]
                        sub_topic_id = sub_id_map.get(doc["sub_topic_code"])
                        await self._upsert_document(cursor, doc, topic_id, sub_topic_id)
                        imported += 1

                    for keyword in bundle["keywords"]:
                        await self._upsert_keyword(cursor, keyword)

                    if active_file_paths:
                        placeholders = ",".join(["%s"] * len(active_file_paths))
                        await cursor.execute(
                            f"""UPDATE knowledge_documents
                                SET is_deleted = TRUE, deleted_at = NOW()
                                WHERE (file_path LIKE 'rag-skill/knowledge/%%'
                                   OR file_path LIKE '/rag-skill/knowledge/%%')
                                  AND file_path NOT IN ({placeholders})""",
                            active_file_paths
                        )
                    else:
                        await cursor.execute(
                            """UPDATE knowledge_documents
                               SET is_deleted = TRUE, deleted_at = NOW()
                               WHERE file_path LIKE 'rag-skill/knowledge/%'
                                  OR file_path LIKE '/rag-skill/knowledge/%'"""
                        )

                    if active_topic_codes:
                        placeholders = ",".join(["%s"] * len(active_topic_codes))
                        await cursor.execute(
                            f"""UPDATE knowledge_topics SET is_active = FALSE
                                WHERE topic_code NOT IN ({placeholders})""",
                            active_topic_codes
                        )
                    if active_sub_codes:
                        placeholders = ",".join(["%s"] * len(active_sub_codes))
                        await cursor.execute(
                            f"""UPDATE knowledge_sub_topics SET is_active = FALSE
                                WHERE sub_topic_code NOT IN ({placeholders})""",
                            active_sub_codes
                        )
                    if active_keywords:
                        placeholders = ",".join(["%s"] * len(active_keywords))
                        await cursor.execute(
                            f"""UPDATE knowledge_keywords SET is_active = FALSE
                                WHERE keyword NOT IN ({placeholders})""",
                            active_keywords
                        )
                    else:
                        await cursor.execute("""UPDATE knowledge_keywords SET is_active = FALSE""")

                    await conn.commit()

            self._clear_all_caches()
            self._sync_signature = signature
            self._sync_result = {
                "success": True,
                "message": "本地知识库元信息已同步到数据库",
                "imported": imported,
                "topics": len(bundle["topics"]),
                "sub_topics": len(bundle["sub_topics"]),
                "keywords": len(bundle["keywords"]),
                "documents": bundle["documents"],
            }
            return self._sync_result

    def _clear_topics_cache(self):
        """清除主题缓存"""
        self._topics_cache = None
        self._topics_cache_time = 0

    async def get_topics(self, is_active: bool = True) -> List[Dict[str, Any]]:
        """获取知识主题列表（优化：单次查询 + 5分钟缓存）"""
        await self.sync_local_knowledge_to_db(force=False)
        # 检查缓存是否有效
        cache_key = f"topics_{is_active}"
        current_time = time.time()
        if self._topics_cache is not None:
            if current_time - self._topics_cache_time < self._topics_cache_ttl:
                return self._topics_cache

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                # 使用子查询一次性获取主题及其文档数量，避免 N+1 查询
                await cursor.execute(
                    """SELECT t.id, t.topic_name, t.topic_code, t.description,
                              t.icon, t.color, t.sort_order, t.is_active,
                              (SELECT COUNT(*) FROM knowledge_documents d
                               WHERE d.topic_id = t.id AND d.is_deleted = FALSE) as document_count
                       FROM knowledge_topics t
                       WHERE t.is_active = %s
                       ORDER BY t.sort_order, t.id""",
                    (is_active,)
                )
                rows = await cursor.fetchall()

        # 直接返回结果，无需额外查询
        result = []
        for row in rows:
            topic = dict(row)
            topic["id"] = str(topic["id"])
            result.append(topic)

        # 更新缓存
        self._topics_cache = result
        self._topics_cache_time = current_time

        return result

    async def get_topic_by_code(self, topic_code: str) -> Optional[Dict[str, Any]]:
        """根据代码获取主题详情"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT * FROM knowledge_topics WHERE topic_code = %s""",
                    (topic_code,)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        topic = dict(row)
        topic["id"] = str(topic["id"])
        return topic

    async def get_documents(
        self,
        topic_id: Optional[int] = None,
        sub_topic_id: Optional[int] = None,
        keyword: Optional[str] = None,
        format: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 10,
        is_deleted: bool = False
    ) -> Dict[str, Any]:
        """获取文档列表（支持分页、筛选）

        优化：仅对无筛选条件的第一页请求进行1分钟缓存，减少数据库压力。
        """
        await self.sync_local_knowledge_to_db(force=False)
        # 仅缓存无筛选条件的第一页（最常用场景）
        use_cache = (
            page == 1 and
            topic_id is None and
            sub_topic_id is None and
            keyword is None and
            format is None and
            status is None and
            not is_deleted
        )

        current_time = time.time()
        if use_cache and self._docs_cache is not None:
            if current_time - self._docs_cache_time < self._docs_cache_ttl:
                return self._docs_cache

        # 构建条件的两个版本（COUNT用原表名，JOIN用别名d）
        count_conditions = ["is_deleted = %s"]
        params_count = [is_deleted]

        if topic_id:
            count_conditions.append("topic_id = %s")
            params_count.append(topic_id)
        if sub_topic_id:
            count_conditions.append("sub_topic_id = %s")
            params_count.append(sub_topic_id)
        if keyword:
            count_conditions.append("(title LIKE %s OR description LIKE %s)")
            params_count.append(f"%{keyword}%")
            params_count.append(f"%{keyword}%")
        if format:
            count_conditions.append("format = %s")
            params_count.append(format)
        if status:
            count_conditions.append("upload_status = %s")
            params_count.append(status)

        count_where = " AND ".join(count_conditions)
        # 使用边界匹配确保只替换完整的列名，避免 topic_id 被重复替换
        import re
        join_where = count_where
        join_where = re.sub(r'\bsub_topic_id\b', 'd.sub_topic_id', join_where)
        join_where = re.sub(r'\btopic_id\b', 'd.topic_id', join_where)

        # 获取总数
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"SELECT COUNT(*) as total FROM knowledge_documents WHERE {count_where}",
                    params_count
                )
                total_row = await cursor.fetchone()
                total = total_row[0] if total_row else 0

        # 获取分页数据（带 topic/sub_topic 名称 JOIN）
        offset = (page - 1) * page_size
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""SELECT d.id, d.title, d.topic_id, d.sub_topic_id, d.keywords,
                              d.format, d.file_name, d.file_path, d.file_size, d.size_display,
                              d.description, d.upload_status, d.progress, d.is_indexed,
                              d.usage_count, d.uploaded_at, d.created_at,
                              t.topic_name as topic,
                              st.sub_topic_name as sub_topic
                       FROM knowledge_documents d
                       LEFT JOIN knowledge_topics t ON d.topic_id = t.id
                       LEFT JOIN knowledge_sub_topics st ON d.sub_topic_id = st.id
                       WHERE {join_where}
                       ORDER BY d.uploaded_at DESC
                       LIMIT %s OFFSET %s""",
                    params_count + [page_size, offset]
                )
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            doc = dict(row)
            doc["id"] = str(doc["id"])
            # 解析 JSON 字段
            if doc.get("keywords") and isinstance(doc["keywords"], str):
                try:
                    doc["keywords"] = json.loads(doc["keywords"])
                except:
                    doc["keywords"] = []
            result.append(doc)

        final_result = {
            "documents": result,
            "total": total,
            "page": page,
            "page_size": page_size
        }

        # 缓存无筛选条件的第一页
        if use_cache:
            self._docs_cache = final_result
            self._docs_cache_time = current_time

        return final_result

    async def get_document_by_id(self, doc_id: int) -> Optional[Dict[str, Any]]:
        """根据 ID 获取文档详情"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT d.*, t.topic_name, st.sub_topic_name
                       FROM knowledge_documents d
                       LEFT JOIN knowledge_topics t ON d.topic_id = t.id
                       LEFT JOIN knowledge_sub_topics st ON d.sub_topic_id = st.id
                       WHERE d.id = %s AND d.is_deleted = FALSE""",
                    (doc_id,)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        doc = dict(row)
        doc["id"] = str(doc["id"])
        if doc.get("keywords") and isinstance(doc["keywords"], str):
            try:
                doc["keywords"] = json.loads(doc["keywords"])
            except:
                doc["keywords"] = []

        # 增加使用次数
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """UPDATE knowledge_documents SET usage_count = usage_count + 1 WHERE id = %s""",
                    (doc_id,)
                )
                await conn.commit()

        return doc

    async def get_document_by_title(self, title: str) -> Optional[Dict[str, Any]]:
        """根据标题或文件名模糊查找文档（用于 RAG 引用场景）"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                # 优先精确匹配 title，其次精确匹配 file_name，最后模糊匹配
                await cursor.execute(
                    """SELECT d.*, t.topic_name, st.sub_topic_name
                       FROM knowledge_documents d
                       LEFT JOIN knowledge_topics t ON d.topic_id = t.id
                       LEFT JOIN knowledge_sub_topics st ON d.sub_topic_id = st.id
                       WHERE d.is_deleted = FALSE
                         AND (d.title = %s OR d.file_name = %s)
                       LIMIT 1""",
                    (title, title)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        doc = dict(row)
        doc["id"] = str(doc["id"])
        if doc.get("keywords") and isinstance(doc["keywords"], str):
            try:
                doc["keywords"] = json.loads(doc["keywords"])
            except:
                doc["keywords"] = []

        return doc

    async def resolve_document_id(self, doc_id_str: str) -> Optional[int]:
        """将字符串 doc_id 转换为整数 ID。

        如果是纯数字字符串，尝试转换为整数 ID；
        如果是标题/文件名，先查找对应文档再返回其整数 ID。
        用于预览等需要整数 ID 的场景。
        """
        # 尝试直接按整数 ID 查找
        try:
            int_id = int(doc_id_str)
            doc = await self.get_document_by_id(int_id)
            if doc:
                return int_id
        except ValueError:
            pass

        # 按标题/文件名查找
        doc = await self.get_document_by_title(doc_id_str)
        if doc:
            return int(doc["id"])

        return None

    async def create_document(self, doc_data: Dict[str, Any]) -> int:
        """创建新文档记录"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    """INSERT INTO knowledge_documents
                       (title, topic_id, sub_topic_id, keywords, format,
                        file_name, file_path, file_size, description, upload_status)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        doc_data.get("title"),
                        doc_data.get("topic_id"),
                        doc_data.get("sub_topic_id"),
                        json.dumps(doc_data.get("keywords", []), ensure_ascii=False),
                        doc_data.get("format"),
                        doc_data.get("file_name"),
                        doc_data.get("file_path"),
                        doc_data.get("file_size", 0),
                        doc_data.get("description"),
                        doc_data.get("upload_status", "uploading")
                    )
                )
                await conn.commit()
                return cursor.lastrowid

    async def update_document_status(
        self,
        doc_id: int,
        status: str,
        progress: Optional[int] = None
    ) -> bool:
        """更新文档上传状态"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                if progress is not None:
                    await cursor.execute(
                        """UPDATE knowledge_documents
                           SET upload_status = %s, progress = %s
                           WHERE id = %s""",
                        (status, progress, doc_id)
                    )
                else:
                    await cursor.execute(
                        """UPDATE knowledge_documents SET upload_status = %s WHERE id = %s""",
                        (status, doc_id)
                    )
                await conn.commit()
                return cursor.rowcount > 0

    async def search_documents(
        self,
        query: str,
        top_k: int = 5,
        topic_ids: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """搜索文档（模拟向量检索，实际应使用 Milvus）"""
        conditions = ["is_deleted = FALSE"]
        params = []

        if topic_ids:
            placeholders = ",".join(["%s"] * len(topic_ids))
            conditions.append(f"topic_id IN ({placeholders})")
            params.extend(topic_ids)

        where_clause = " AND ".join(conditions)

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""SELECT id, title, topic_id, keywords, description
                       FROM knowledge_documents
                       WHERE {where_clause}
                       LIMIT %s""",
                    params + [top_k * 2]
                )
                rows = await cursor.fetchall()

        # 简单关键词匹配评分
        query_keywords = set(query.lower())
        scored_docs = []

        for row in rows:
            doc = dict(row)
            doc["id"] = str(doc["id"])

            if doc.get("keywords") and isinstance(doc["keywords"], str):
                try:
                    doc["keywords"] = json.loads(doc["keywords"])
                except:
                    doc["keywords"] = []

            score = 0.0
            keywords = set("".join(doc.get("keywords", [])).lower())

            # 标题匹配
            if any(kw in doc.get("title", "").lower() for kw in query_keywords if len(kw) > 1):
                score += 0.5

            # 关键词匹配
            keyword_overlap = len(query_keywords & keywords)
            score += keyword_overlap * 0.2

            # 描述匹配
            for kw in query_keywords:
                if len(kw) > 1 and kw in doc.get("description", "").lower():
                    score += 0.1

            if score > 0:
                scored_docs.append((score, doc))

        # 排序并返回 top_k
        scored_docs.sort(key=lambda x: x[0], reverse=True)
        return [doc for _, doc in scored_docs[:top_k]]

    async def get_sub_topics(
        self,
        topic_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """获取子主题列表（支持按 topic_id 筛选）"""
        await self.sync_local_knowledge_to_db(force=False)
        conditions = []
        params = []

        if topic_id:
            conditions.append("topic_id = %s")
            params.append(topic_id)

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""SELECT id, topic_id, sub_topic_name, sub_topic_code,
                              description, sort_order
                       FROM knowledge_sub_topics
                       WHERE {where_clause}
                       ORDER BY sort_order, id""",
                    params
                )
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            sub = dict(row)
            sub["id"] = str(sub["id"])
            sub["topicId"] = sub["topic_id"]
            sub["subTopicName"] = sub["sub_topic_name"]
            sub["subTopicCode"] = sub["sub_topic_code"]
            result.append(sub)

        return result

    async def get_document_preview(self, doc_id: int, max_length: int = 500) -> Optional[Dict[str, Any]]:
        """获取文档预览内容。

        优先从本地文件读取内容（直接从 rag-skill/knowledge 目录）；
        仅在文件读取失败时使用数据库 description 字段。
        支持 .txt / .md 文件的直接读取；PDF/DOCX 等二进制格式返回占位提示。
        """
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT id, title, description, format,
                              file_path, file_name, file_size,
                              uploaded_at, created_at
                       FROM knowledge_documents
                       WHERE id = %s AND is_deleted = FALSE""",
                    (doc_id,)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        # 优先从本地文件读取内容
        preview_text = ""
        file_path = row.get("file_path", "")
        doc_format = row.get("format", "")

        if file_path and doc_format in ("txt", "md"):
            # 获取 backend 目录作为基础路径
            # __file__ = .../backend/src/services/knowledge_service.py
            # dirname(__file__) = .../backend/src/services
            # dirname(dirname(__file__)) = .../backend/src
            # dirname(dirname(dirname(__file__))) = .../backend
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

            # 规范化路径分隔符
            normalized_path = file_path.replace("\\", "/").lstrip("/")

            # rag-skill/knowledge 路径转换
            if normalized_path.startswith("rag-skill/knowledge/"):
                relative_path = normalized_path[len("rag-skill/knowledge/"):]
                actual_path = os.path.normpath(os.path.join(backend_dir, "SuiAgent-main", "rag-skill", "knowledge", relative_path))
            elif "/rag-skill/knowledge/" in normalized_path:
                relative_path = normalized_path.split("/rag-skill/knowledge/")[-1]
                actual_path = os.path.normpath(os.path.join(backend_dir, "SuiAgent-main", "rag-skill", "knowledge", relative_path))
            else:
                actual_path = os.path.normpath(os.path.join(backend_dir, normalized_path))

            if os.path.isfile(actual_path):
                try:
                    with open(actual_path, "r", encoding="utf-8", errors="ignore") as f:
                        preview_text = f.read()
                except Exception:
                    pass

        # 如果文件读取失败，使用数据库中的简短描述
        if not preview_text:
            preview_text = row.get("description") or ""

        # 追加文件信息
        content_snippet = preview_text[:max_length]
        if len(preview_text) > max_length:
            content_snippet += "\n\n... [内容已截断，仅显示前 {} 字符] ...".format(max_length)

        uploaded_at = row.get("uploaded_at") or row.get("created_at")

        # 二进制格式提示
        binary_formats = {"pdf", "docx", "doc", "pptx", "ppt", "xlsx"}
        if row.get("format", "") in binary_formats:
            file_size = row.get("file_size", 0) or 0
            if file_size < 1024:
                size_str = f"{file_size} B"
            elif file_size < 1024 * 1024:
                size_str = f"{file_size / 1024:.1f} KB"
            else:
                size_str = f"{file_size / 1024 / 1024:.2f} MB"

            content_snippet = (
                f"【{row.get('format', '').upper()} 文档】\n"
                f"文件名：{row.get('file_name', '未知')}\n"
                f"文件大小：{size_str}\n"
                f"文件路径：{row.get('file_path', '未知')}\n\n"
                f"此为二进制格式文档，无法直接预览内容。\n"
                f"如需查看完整内容，请在知识库文档列表页下载该文件。"
            )
            content_snippet = content_snippet[:max_length]

        return {
            "id": row["id"],
            "title": row.get("title", ""),
            "summary": row.get("description", ""),  # 数据库中的简短描述
            "preview": content_snippet,
            "content": preview_text,  # 完整文件内容
            "format": row.get("format", "txt"),
            "filePath": row.get("file_path", ""),
            "fileName": row.get("file_name", ""),
            "fileSize": row.get("file_size", 0),
            "isTruncated": len(preview_text) > max_length,
            "totalLength": len(preview_text),
            "uploadedAt": uploaded_at.isoformat() if uploaded_at else None,
        }

    async def upload_document(
        self,
        title: str,
        content: str,
        topic_id: int,
        summary: str,
        file_name: str,
        file_size: int = 0,
        sub_topic_id: Optional[int] = None,
        keywords: Optional[List[str]] = None,
        doc_format: str = "txt",
        file_path: str = "",
        size_display: str = "",
        uploaded_by: str = "",
    ) -> Dict[str, Any]:
        """创建知识文档记录"""
        # 计算文件大小
        if file_size == 0:
            file_size = len(content.encode("utf-8"))

        # 计算显示大小
        if not size_display:
            if file_size < 1024:
                size_display = f"{file_size} B"
            elif file_size < 1024 * 1024:
                size_display = f"{file_size / 1024:.1f} KB"
            else:
                size_display = f"{file_size / 1024 / 1024:.2f} MB"

        # 处理关键词
        processed_keywords = keywords or []
        if not processed_keywords and content:
            # 从内容中自动提取关键词
            words = re.findall(r"[\u4e00-\u9fa5a-zA-Z0-9]+", content)
            word_freq: dict = {}
            stop_words = {"的", "了", "和", "是", "在", "我", "有", "个", "上", "也", "就", "不", "人", "都", "一", "中", "大", "为", "与", "或", "the", "a", "an", "is", "are", "was", "were", "and", "or", "but", "in", "on", "at", "to", "for"}
            for w in words:
                w_lower = w.lower()
                if len(w_lower) >= 2 and w_lower not in stop_words:
                    word_freq[w_lower] = word_freq.get(w_lower, 0) + 1
            sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
            processed_keywords = [w for w, _ in sorted_words[:20]]

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """INSERT INTO knowledge_documents
                       (title, topic_id, sub_topic_id, keywords, format,
                        file_name, file_path, file_size, size_display, description,
                        upload_status, uploaded_at, uploaded_by)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)""",
                    (
                        title,
                        topic_id,
                        sub_topic_id,
                        json.dumps(processed_keywords, ensure_ascii=False),
                        doc_format,
                        file_name,
                        file_path,
                        file_size,
                        size_display,
                        summary,
                        "uploaded",
                        uploaded_by,
                    ),
                )
                await conn.commit()
                doc_id = cursor.lastrowid

        return {
            "id": doc_id,
            "title": title,
            "topicId": topic_id,
            "subTopicId": sub_topic_id,
            "keywords": processed_keywords,
            "format": doc_format,
            "fileName": file_name,
            "filePath": file_path,
            "fileSize": file_size,
            "sizeDisplay": size_display,
            "description": summary,
            "uploadStatus": "uploaded",
        }

    async def delete_document(self, doc_id: int) -> bool:
        """软删除文档"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """UPDATE knowledge_documents
                       SET is_deleted = TRUE, deleted_at = NOW()
                       WHERE id = %s""",
                    (doc_id,)
                )
                await conn.commit()
                return cursor.rowcount > 0

    async def update_document(
        self,
        doc_id: int,
        title: Optional[str] = None,
        topic_id: Optional[int] = None,
        sub_topic_id: Optional[int] = None,
        keywords: Optional[List[str]] = None,
        description: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """更新文档信息"""
        # 先获取现有文档
        existing = await self.get_document_by_id(doc_id)
        if not existing:
            return None

        # 构建更新字段
        update_fields = []
        update_values = []

        if title is not None:
            update_fields.append("title = %s")
            update_values.append(title)
        if topic_id is not None:
            update_fields.append("topic_id = %s")
            update_values.append(topic_id)
        if sub_topic_id is not None:
            update_fields.append("sub_topic_id = %s")
            update_values.append(sub_topic_id)
        if description is not None:
            update_fields.append("description = %s")
            update_values.append(description)
        if keywords is not None:
            update_fields.append("keywords = %s")
            update_values.append(json.dumps(keywords, ensure_ascii=False))

        if not update_fields:
            return existing

        update_values.append(doc_id)

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""UPDATE knowledge_documents
                       SET {', '.join(update_fields)}
                       WHERE id = %s""",
                    update_values
                )
                await conn.commit()

        # 返回更新后的文档
        return await self.get_document_by_id(doc_id)

    async def create_document_record(
        self,
        title: str,
        topic_id: int,
        sub_topic_id: Optional[int] = None,
        keywords: Optional[List[str]] = None,
        description: Optional[str] = None,
        doc_format: str = "md",
        file_path: str = "",
        file_name: str = "",
        file_size: int = 0,
        uploaded_by: str = "",
    ) -> Dict[str, Any]:
        """创建文档记录（手动创建，不上传文件）"""
        # 计算显示大小
        size_display = ""
        if file_size > 0:
            if file_size < 1024:
                size_display = f"{file_size} B"
            elif file_size < 1024 * 1024:
                size_display = f"{file_size / 1024:.1f} KB"
            else:
                size_display = f"{file_size / 1024 / 1024:.2f} MB"
        else:
            size_display = "0 B"

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """INSERT INTO knowledge_documents
                       (title, topic_id, sub_topic_id, keywords, format,
                        file_name, file_path, file_size, size_display, description,
                        upload_status, uploaded_at, uploaded_by)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)""",
                    (
                        title,
                        topic_id,
                        sub_topic_id,
                        json.dumps(keywords or [], ensure_ascii=False),
                        doc_format,
                        file_name or title,
                        file_path,
                        file_size,
                        size_display,
                        description or "",
                        "uploaded",
                        uploaded_by,
                    ),
                )
                await conn.commit()
                doc_id = cursor.lastrowid

        return {
            "id": doc_id,
            "title": title,
            "topicId": topic_id,
            "subTopicId": sub_topic_id,
            "keywords": keywords or [],
            "format": doc_format,
            "fileName": file_name or title,
            "filePath": file_path,
            "fileSize": file_size,
            "sizeDisplay": size_display,
            "description": description or "",
            "uploadStatus": "uploaded",
        }

    async def get_topic_code_map(self) -> Dict[str, int]:
        """获取 topic_code -> topic_id 映射"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT id, topic_code FROM knowledge_topics WHERE is_active = TRUE"""
                )
                rows = await cursor.fetchall()

        return {row["topic_code"]: row["id"] for row in rows}

    async def get_sub_topic_code_map(self) -> Dict[str, int]:
        """获取 sub_topic_code -> sub_topic_id 映射"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT id, sub_topic_code, topic_id FROM knowledge_sub_topics WHERE is_active = TRUE"""
                )
                rows = await cursor.fetchall()

        return {row["sub_topic_code"]: row["id"] for row in rows}

    async def import_documents_from_directory(
        self,
        base_path: str,
        topic_code_map: Dict[str, int],
        sub_topic_code_map: Dict[str, int],
    ) -> Dict[str, Any]:
        """扫描 rag-skill/knowledge 目录并导入文档到数据库。

        目录结构：
        knowledge/
        ├── 自杀与自伤/              <- topic（一级目录）
        │   ├── 自杀预防与教育/      <- sub_topic（二级目录 = 子主题名）
        │   │   ├── 高危信号识别.md
        │   │   └── WHO_LIVE_LIFE自杀预防.txt
        │   ├── 自伤与自残/
        │   │   └── 自伤行为识别与干预.md
        │   └── ...
        ├── 抑郁/
        │   ├── 抑郁症状与评估/
        │   └── ...

        导入策略：
        - path_parts[0] = 一级目录名 -> topic_name -> topic_id
        - path_parts[1] = 二级目录名 -> sub_topic_name -> sub_topic_id
        - path_parts[2+] = 子级目录（忽略，文档直接在二级目录下）
        - path_parts[-1] = 文件名（不含扩展名） -> title
        """
        import os
        import re

        results = {
            "imported": 0,
            "skipped": 0,
            "errors": [],
            "documents": [],
        }

        # ----- 步骤1：构建 topic_name -> topic_id 映射 -----
        # 直接用中文目录名匹配 topic_name
        topic_name_to_id: Dict[str, int] = {}
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "SELECT id, topic_name, topic_code FROM knowledge_topics WHERE is_active = TRUE"
                )
                for row in await cursor.fetchall():
                    topic_name_to_id[row["topic_name"]] = row["id"]
                    # 也用 topic_code 作为备选键
                    topic_name_to_id[row["topic_code"]] = row["id"]

        # ----- 步骤2：构建 sub_topic_name -> sub_topic_id 映射 -----
        sub_topic_name_to_id: Dict[str, int] = {}
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "SELECT id, sub_topic_name, sub_topic_code, topic_id FROM knowledge_sub_topics WHERE is_active = TRUE"
                )
                for row in await cursor.fetchall():
                    sub_topic_name_to_id[row["sub_topic_name"]] = row["id"]
                    sub_topic_name_to_id[row["sub_topic_code"]] = row["id"]

        # ----- 步骤3：遍历目录 -----
        for root, dirs, files in os.walk(base_path):
            # 跳过 data_structure.md 和非内容文件
            # 支持：.md, .txt, .docx, .pdf
            content_files = [
                f for f in files
                if f.lower() != "data_structure.md"
                and f.endswith((".md", ".txt", ".docx", ".pdf"))
            ]
            if not content_files:
                continue

            # 计算相对路径
            rel_path = os.path.relpath(root, base_path)
            path_parts = rel_path.split(os.sep) if rel_path != "." else []

            # 确定主题（第一级目录）
            topic_name = path_parts[0] if len(path_parts) >= 1 else ""
            topic_id = topic_name_to_id.get(topic_name)
            if not topic_id:
                # 尝试用 topic_code 匹配
                topic_id = topic_name_to_id.get(topic_name)
                if not topic_id:
                    results["errors"].append(
                        f"[跳过] 未找到主题目录 '{topic_name}' 对应的 topic_id"
                    )
                    continue

            # 确定子主题
            # - 如果有二级目录：用二级目录名匹配 sub_topic_name
            # - 如果文档直接在 topic 目录下：sub_topic_id = None
            sub_topic_name = ""
            sub_topic_id: Optional[int] = None
            if len(path_parts) >= 2:
                sub_topic_name = path_parts[1]
                sub_topic_id = sub_topic_name_to_id.get(sub_topic_name)
                # 如果子主题不在映射表中，尝试从数据库查询
                if not sub_topic_id:
                    async with self.mysql_pool.acquire() as conn:
                        async with conn.cursor(aiomysql.DictCursor) as cursor:
                            await cursor.execute(
                                "SELECT id FROM knowledge_sub_topics WHERE sub_topic_name = %s AND topic_id = %s AND is_active = TRUE",
                                (sub_topic_name, topic_id),
                            )
                            row = await cursor.fetchone()
                            if row:
                                sub_topic_id = row["id"]
                                sub_topic_name_to_id[sub_topic_name] = sub_topic_id

            # ----- 处理每个文档文件 -----
            for file in content_files:
                file_abs_path = os.path.join(root, file)
                try:
                    # 标题 = 文件名（不含扩展名）
                    title = os.path.splitext(file)[0]

                    # 推断格式
                    ext = os.path.splitext(file)[1].lower().lstrip(".")
                    format_map = {"txt": "txt", "md": "md", "docx": "docx", "pdf": "pdf"}
                    doc_format = format_map.get(ext, "txt")

                    # 从内容中提取关键词（前 20 个高频词）
                    # 二进制格式（.docx, .pdf）无法直接读取文本，设置空关键词
                    content = ""
                    if ext in ("txt", "md"):
                        with open(file_abs_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        keywords = self._extract_keywords_from_content(content)
                    else:
                        # .docx 和 .pdf 等二进制格式，设置默认关键词
                        keywords = []
                        # 尝试从文件名推断关键词
                        import re
                        words = re.findall(r"[\u4e00-\u9fa5a-zA-Z0-9]+", title)
                        keywords = [w for w in words if len(w) >= 2][:10]

                    # 计算文件大小（二进制格式直接读取文件）
                    if ext in ("txt", "md"):
                        file_size = len(content.encode("utf-8"))
                    else:
                        file_size = os.path.getsize(file_abs_path)

                    # 相对路径 -> rag_path（统一使用正斜杠，跨平台兼容）
                    rel_file_path = os.path.relpath(file_abs_path, base_path)
                    rag_path = "/rag-skill/knowledge/" + rel_file_path.replace(os.sep, "/")

                    # 检查是否已存在（按标题 + topic_id 查重）
                    existing = await self._check_document_exists(title, topic_id)
                    if existing:
                        results["skipped"] += 1
                        continue

                    # 创建文档记录
                    doc = await self.create_document_record(
                        title=title,
                        topic_id=topic_id,
                        sub_topic_id=sub_topic_id,
                        keywords=keywords[:20],
                        description=self._generate_summary(content) if content else f"{doc_format.upper()} 文档，请下载查看完整内容",
                        doc_format=doc_format,
                        file_path=rag_path,
                        file_name=file,
                        file_size=file_size,
                    )
                    results["documents"].append({
                        "title": title,
                        "topic_name": topic_name,
                        "sub_topic_name": sub_topic_name,
                        "topic_id": topic_id,
                        "sub_topic_id": sub_topic_id,
                    })
                    results["imported"] += 1

                except Exception as e:
                    results["errors"].append(f"{file}: {str(e)}")

        return results

    def _chinese_to_pinyin(self, text: str) -> str:
        """简单的中文转拼音（仅支持常见词）"""
        pinyin_map = {
            "自杀": "suicide", "自伤": "self_harm",
            "抑郁": "depression", "焦虑": "anxiety",
            "危机": "crisis", "干预": "intervention",
            "情绪": "emotion", "睡眠": "sleep",
            "生理": "physiology", "量表": "scale",
            "筛查": "screening", "资源": "resources",
            "心理": "mental_health", "健康": "health",
            "素养": "literacy", "求助": "help",
        }
        result = []
        for char in text:
            for py_word, pinyin in pinyin_map.items():
                if char in py_word:
                    result.append(pinyin)
                    break
        return "_".join(result) if result else text

    def _extract_keywords_from_content(self, content: str, max_keywords: int = 20) -> List[str]:
        """从内容中提取关键词"""
        import re
        words = re.findall(r"[\u4e00-\u9fa5a-zA-Z0-9]+", content)
        word_freq: dict = {}
        stop_words = {
            "的", "了", "和", "是", "在", "我", "有", "个", "上", "也", "就", "不", "人", "都", "一", "中", "大", "为", "与", "或",
            "这", "那", "他", "她", "它", "们", "时", "来", "对", "会", "可", "能", "要", "以", "作", "到", "说", "而", "被", "但",
            "the", "a", "an", "is", "are", "was", "were", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
        }
        for w in words:
            w_lower = w.lower()
            if len(w_lower) >= 2 and w_lower not in stop_words:
                word_freq[w_lower] = word_freq.get(w_lower, 0) + 1
        sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
        return [w for w, _ in sorted_words[:max_keywords]]

    def _generate_summary(self, content: str, max_length: int = 200) -> str:
        """从内容生成摘要"""
        # 去掉 markdown 标题符号
        import re
        content = re.sub(r"^#+\s*", "", content, flags=re.MULTILINE)
        content = re.sub(r"\[.*?\]\(.*?\)", "", content)  # 去掉链接
        content = re.sub(r"[*_`~]", "", content)  # 去掉格式符号
        content = content.strip()
        if len(content) <= max_length:
            return content
        return content[:max_length] + "..."

    def _is_compact_keyword(self, keyword: str, usage_count: int) -> bool:
        """筛选适合前端展示的高信号关键词，避免筛选区过于臃肿。"""
        kw = (keyword or "").strip()
        if not kw:
            return False

        if usage_count < 2:
            return False

        noise_keywords = {
            "情绪障碍", "干预与求助资源", "心理健康数据", "趋势报告",
            "自杀与自伤", "自杀风险预防", "危机预防", "儿童心理健康",
        }
        if kw in noise_keywords:
            return False

        if len(kw) > 12 and not re.fullmatch(r"[A-Za-z0-9\-\+/]{1,12}", kw):
            return False

        if kw.count(" ") >= 2:
            return False

        if re.fullmatch(r"[A-Za-z][A-Za-z0-9 _\-\+/]{14,}", kw):
            return False

        return True

    def _compact_keywords(self, rows: List[Dict[str, Any]], limit: int = 36) -> List[Dict[str, Any]]:
        """压缩关键词集合，只保留适合筛选区展示的高频标签。"""
        normalized = []
        seen = set()
        for row in rows:
            keyword = (row.get("keyword") or "").strip()
            usage_count = int(row.get("usage_count") or row.get("weight") or 0)
            if keyword in seen:
                continue
            seen.add(keyword)
            if not self._is_compact_keyword(keyword, usage_count):
                continue
            normalized.append({
                **row,
                "keyword": keyword,
                "usage_count": usage_count,
            })

        normalized.sort(key=lambda item: (-int(item.get("usage_count") or 0), len(item.get("keyword") or ""), item.get("keyword") or ""))
        return normalized[:limit]

    async def _check_document_exists(self, title: str, topic_id: int) -> Optional[Dict[str, Any]]:
        """检查文档是否已存在"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT id, title FROM knowledge_documents
                       WHERE title = %s AND topic_id = %s AND is_deleted = FALSE""",
                    (title, topic_id)
                )
                return await cursor.fetchone()

    async def get_keywords(self, topic_id: Optional[int] = None, is_hot: bool = False) -> List[Dict[str, Any]]:
        """获取关键词列表（优先从 knowledge_keywords 表获取预定义关键词）"""
        await self.sync_local_knowledge_to_db(force=False)
        # 首先尝试从预定义的 knowledge_keywords 表获取
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")

                # 优先使用预定义的关键词表
                query = """
                    SELECT keyword, category, color_class, is_hot, usage_count, sort_order
                    FROM knowledge_keywords
                    WHERE is_active = TRUE
                """
                params = []

                if is_hot:
                    query += " AND is_hot = TRUE"

                query += " ORDER BY sort_order, keyword LIMIT 100"

                if topic_id:
                    # 如果指定了主题，尝试筛选相关关键词（基于主题名称匹配）
                    # 注意：knowledge_keywords 表没有 topic_id 字段，所以暂时返回全部
                    pass

                await cursor.execute(query, params)
                rows = await cursor.fetchall()

        if rows:
            compact_rows = self._compact_keywords([dict(row) for row in rows], limit=18 if is_hot else 36)
            if compact_rows:
                return compact_rows
            return [dict(row) for row in rows[:18 if is_hot else 36]]

        # 如果预定义关键词表为空，回退到从文档关键词聚合（不推荐）
        conditions = ["d.is_deleted = FALSE"]
        params = []

        if topic_id:
            conditions.append("d.topic_id = %s")
            params.append(topic_id)

        where_clause = " AND ".join(conditions)

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""SELECT keywords FROM knowledge_documents
                       WHERE {where_clause} AND keywords IS NOT NULL""",
                    params
                )

                all_keywords = []
                for row in await cursor.fetchall():
                    kw_str = row.get("keywords", "")
                    if isinstance(kw_str, str):
                        try:
                            kw_list = json.loads(kw_str)
                        except:
                            kw_list = [kw_str]
                    else:
                        kw_list = kw_str or []
                    all_keywords.extend(kw_list)

                # 统计频率
                from collections import Counter
                keyword_counts = Counter(all_keywords)
                result = [
                    {"keyword": kw, "weight": count, "category": ""}
                    for kw, count in keyword_counts.most_common(100)
                ]
                compact_rows = self._compact_keywords(result, limit=18 if is_hot else 36)
                return compact_rows or result[:18 if is_hot else 36]
