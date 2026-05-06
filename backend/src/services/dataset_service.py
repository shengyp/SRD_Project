# 数据集业务：配置缓存、列表、对比、上传
import re
import csv
import io
import json
from datetime import datetime
from typing import Dict, Tuple, List, Any, Optional
import aiomysql

from src.core.constants import TABLE_DATASET_ANALYSIS, TABLE_CUSTOM_DATASET_META


def _sanitize_col(name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fff]", "_", name.strip())
    if not name or name[0].isdigit():
        name = "col_" + name
    return name[:64]


def _sanitize_table(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", name.strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned[:30] or "dataset"


class DatasetService:
    """数据集相关业务，依赖 MySQL 连接池。"""

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool

    async def ensure_custom_dataset_meta_table(self) -> None:
        """确保 custom_dataset_meta 表存在（无则创建）。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute("""
                    CREATE TABLE IF NOT EXISTS custom_dataset_meta (
                        id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL COMMENT '数据集名称',
                        table_name VARCHAR(100) NOT NULL COMMENT '存储表名',
                        mode_type VARCHAR(50) DEFAULT 'all' COMMENT '模式类型',
                        row_count INT DEFAULT 0 COMMENT '记录数',
                        columns_info JSON COMMENT '字段映射信息',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """)
                await conn.commit()

    async def get_datasets(self) -> List[dict]:
        """获取数据集列表。直接从 dataset_profile 表读取。"""
        result = []
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                # 从 dataset_profile 表读取数据集信息
                await cursor.execute(
                    """
                    SELECT 
                        dataset_key,
                        display_name,
                        description,
                        icon,
                        color,
                        bg_color,
                        text_color,
                        language,
                        class_system,
                        class_count,
                        fine_labels,
                        coarse_risk_mapping,
                        total_users,
                        total_posts,
                        total_archives,
                        is_builtin,
                        is_active,
                        sort_order
                    FROM dataset_profile
                    ORDER BY sort_order ASC
                    """
                )
                async for row in cursor:
                    (
                        dataset_key, display_name, description, icon, color, 
                        bg_color, text_color, language, class_system, class_count,
                        fine_labels, coarse_risk_mapping, total_users, total_posts,
                        total_archives, is_builtin, is_active, sort_order
                    ) = row
                    
                    # 解析 JSON 字段
                    fine_labels_dict = {}
                    coarse_risk_map = {}
                    
                    if fine_labels:
                        try:
                            if isinstance(fine_labels, str):
                                fine_labels_dict = json.loads(fine_labels)
                            else:
                                fine_labels_dict = fine_labels
                        except:
                            pass
                    
                    if coarse_risk_mapping:
                        try:
                            if isinstance(coarse_risk_mapping, str):
                                coarse_risk_map = json.loads(coarse_risk_mapping)
                            else:
                                coarse_risk_map = coarse_risk_mapping
                        except:
                            pass
                    
                    # 计算总档案数（优先用统计字段，否则用用户数）
                    total_archives = total_archives or total_users or 0
                    
                    result.append({
                        "id": str(sort_order or 0),
                        "datasetKey": dataset_key,
                        "displayName": display_name,
                        "description": description or "",
                        "icon": icon,
                        "color": color,
                        "bgColor": bg_color,
                        "textColor": text_color,
                        "language": language,
                        "classSystem": class_system,
                        "classCount": class_count or 2,
                        "fineLabels": fine_labels_dict,
                        "coarseRiskMapping": coarse_risk_map,
                        "totalUsers": total_users or 0,
                        "totalPosts": total_posts or 0,
                        "totalArchives": total_archives,
                        "isBuiltin": bool(is_builtin),
                        "isActive": bool(is_active) if is_active is not None else True,
                        "sortOrder": sort_order or 0,
                    })
        return result

    async def has_dataset_data(self, dataset_key: str) -> bool:
        """检查数据集是否已经同步到 MySQL 主表。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "SELECT 1 FROM psychological_archives WHERE dataset_source = %s LIMIT 1",
                    (dataset_key,),
                )
                return await cursor.fetchone() is not None

    async def sync_builtin_datasets(self, csv_svc, dataset_keys: Optional[List[str]] = None) -> dict:
        """将内置数据集同步到 MySQL，作为统一主存储。"""
        target_keys = dataset_keys or list(csv_svc.DATASET_CONFIG.keys())
        summary = {"synced": [], "skipped": [], "failed": []}

        dataset_ui_meta = {
            "reddit": {"icon": "database", "color": "#2F6BFF", "bg_color": "bg-blue-100", "text_color": "text-blue-700", "sort_order": 1},
            "bigdata": {"icon": "database-zap", "color": "#0F6CBD", "bg_color": "bg-cyan-100", "text_color": "text-cyan-700", "sort_order": 2},
            "sigir": {"icon": "flask-conical", "color": "#7C3AED", "bg_color": "bg-violet-100", "text_color": "text-violet-700", "sort_order": 3},
            "weibo": {"icon": "messages-square", "color": "#EA580C", "bg_color": "bg-orange-100", "text_color": "text-orange-700", "sort_order": 4},
        }

        for dataset_key in target_keys:
            payload = csv_svc.build_dataset_import_payload(dataset_key)
            if not payload:
                summary["failed"].append({"datasetKey": dataset_key, "reason": "无法从 CSV 构建导入载荷"})
                continue

            dataset_meta = payload["dataset"]
            archives = payload["archives"]
            ui_meta = dataset_ui_meta.get(dataset_key, {})
            batch_code = f"builtin_sync_{dataset_key}"

            try:
                async with self.mysql_pool.acquire() as conn:
                    async with conn.cursor(aiomysql.DictCursor) as cursor:
                        await cursor.execute("SET NAMES utf8mb4")

                        await cursor.execute(
                            """
                            INSERT INTO dataset_profile (
                                dataset_key, display_name, description, icon, color, bg_color, text_color,
                                language, class_system, class_count, fine_labels, coarse_risk_mapping,
                                total_users, total_posts, total_archives, is_builtin, is_active, sort_order
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, 1, %s)
                            ON DUPLICATE KEY UPDATE
                                display_name = VALUES(display_name),
                                description = VALUES(description),
                                icon = VALUES(icon),
                                color = VALUES(color),
                                bg_color = VALUES(bg_color),
                                text_color = VALUES(text_color),
                                language = VALUES(language),
                                class_system = VALUES(class_system),
                                class_count = VALUES(class_count),
                                fine_labels = VALUES(fine_labels),
                                coarse_risk_mapping = VALUES(coarse_risk_mapping),
                                total_users = VALUES(total_users),
                                total_posts = VALUES(total_posts),
                                total_archives = VALUES(total_archives),
                                is_builtin = 1,
                                is_active = 1,
                                sort_order = VALUES(sort_order)
                            """,
                            (
                                dataset_meta["dataset_key"],
                                dataset_meta["display_name"],
                                dataset_meta["description"],
                                ui_meta.get("icon", "database"),
                                ui_meta.get("color", "#C19A83"),
                                ui_meta.get("bg_color", "bg-orange-100"),
                                ui_meta.get("text_color", "text-orange-700"),
                                dataset_meta["language"],
                                dataset_meta["class_system"],
                                dataset_meta["class_count"],
                                json.dumps(dataset_meta["fine_labels"], ensure_ascii=False),
                                json.dumps(dataset_meta["coarse_risk_mapping"], ensure_ascii=False),
                                dataset_meta["total_users"],
                                dataset_meta["total_posts"],
                                dataset_meta["total_archives"],
                                ui_meta.get("sort_order", 99),
                            ),
                        )

                        fine_distribution: Dict[str, int] = {}
                        coarse_distribution: Dict[str, int] = {"low": 0, "medium": 0, "high": 0}
                        has_timestamp = False
                        has_emojis = False
                        for archive in archives:
                            fine_key = str(archive["risk_value"])
                            fine_distribution[fine_key] = fine_distribution.get(fine_key, 0) + 1
                            coarse_distribution[archive["risk_level"]] = coarse_distribution.get(archive["risk_level"], 0) + 1
                            has_timestamp = has_timestamp or archive["has_timestamp"]
                            has_emojis = has_emojis or archive["has_emojis"]

                        await cursor.execute(
                            """
                            INSERT INTO archive_import_batch (
                                batch_code, dataset_key, original_filename, file_format, total_rows, unique_users,
                                unique_posts, fine_risk_distribution, fine_class_count, fine_labels,
                                coarse_risk_mapping, coarse_risk_distribution, post_count, is_manual_annotation,
                                has_timestamp, has_emojis, accepted_rows, rejected_rows, status, committed_at
                            ) VALUES (%s, %s, %s, 'csv', %s, %s, %s, %s, %s, %s, %s, %s, 1, 0, %s, %s, %s, 0, 'committed', NOW())
                            ON DUPLICATE KEY UPDATE
                                total_rows = VALUES(total_rows),
                                unique_users = VALUES(unique_users),
                                unique_posts = VALUES(unique_posts),
                                fine_risk_distribution = VALUES(fine_risk_distribution),
                                fine_class_count = VALUES(fine_class_count),
                                fine_labels = VALUES(fine_labels),
                                coarse_risk_mapping = VALUES(coarse_risk_mapping),
                                coarse_risk_distribution = VALUES(coarse_risk_distribution),
                                has_timestamp = VALUES(has_timestamp),
                                has_emojis = VALUES(has_emojis),
                                accepted_rows = VALUES(accepted_rows),
                                rejected_rows = 0,
                                status = 'committed',
                                committed_at = NOW(),
                                updated_at = NOW()
                            """,
                            (
                                batch_code,
                                dataset_key,
                                csv_svc.DATASET_CONFIG[dataset_key]["csv_path"],
                                len(archives),
                                dataset_meta["total_users"],
                                dataset_meta["total_posts"],
                                json.dumps(fine_distribution, ensure_ascii=False),
                                dataset_meta["class_count"],
                                json.dumps(dataset_meta["fine_labels"], ensure_ascii=False),
                                json.dumps(dataset_meta["coarse_risk_mapping"], ensure_ascii=False),
                                json.dumps(coarse_distribution, ensure_ascii=False),
                                1 if has_timestamp else 0,
                                1 if has_emojis else 0,
                                len(archives),
                            ),
                        )
                        await cursor.execute("SELECT id FROM archive_import_batch WHERE batch_code = %s", (batch_code,))
                        batch_row = await cursor.fetchone()
                        batch_id = batch_row["id"]

                        await cursor.execute(
                            """
                            DELETE up FROM user_posts up
                            INNER JOIN psychological_archives pa ON up.archive_id = pa.id
                            WHERE pa.dataset_source = %s
                            """,
                            (dataset_key,),
                        )
                        await cursor.execute("DELETE FROM psychological_archives WHERE dataset_source = %s", (dataset_key,))

                        archive_rows = [
                            (
                                archive["user_hash"],
                                dataset_key,
                                archive["post_count"],
                                archive["risk_level"],
                                archive["risk_value"],
                                archive["label"],
                                1 if archive["has_timestamp"] else 0,
                                archive["post_timestamp_start"],
                                archive["post_timestamp_end"],
                                1 if archive["has_emojis"] else 0,
                                batch_id,
                                archive["import_timestamp"],
                                None,
                                archive["high_importance_count"],
                                archive["medium_importance_count"],
                                archive["low_importance_count"],
                                archive["avg_importance_score"],
                                json.dumps(archive["top_posts_summary"], ensure_ascii=False),
                                "ready",
                            )
                            for archive in archives
                        ]
                        await cursor.executemany(
                            """
                            INSERT INTO psychological_archives (
                                user_id, dataset_source, post_count, risk_level, risk_value, label, has_timestamp,
                                post_timestamp_start, post_timestamp_end, has_emojis, import_batch_id, import_timestamp,
                                frequent_words, high_importance_count, medium_importance_count, low_importance_count,
                                avg_importance_score, top_posts_summary, status
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            archive_rows,
                        )

                        await cursor.execute(
                            "SELECT id, user_id FROM psychological_archives WHERE dataset_source = %s",
                            (dataset_key,),
                        )
                        archive_id_map = {row["user_id"]: row["id"] for row in await cursor.fetchall()}

                        post_rows = []
                        for archive in archives:
                            archive_id = archive_id_map.get(archive["user_hash"])
                            if not archive_id:
                                continue
                            for post in archive["posts"]:
                                post_rows.append(
                                    (
                                        archive_id,
                                        archive["user_hash"],
                                        post["post_index"],
                                        post["content"],
                                        None,
                                        post["importance_score"],
                                        post["importance_level"],
                                        None,
                                        post["timestamp"],
                                        post["emoji_count"],
                                        post["emoji_sequence"],
                                        post["fine_risk_value"],
                                        "accepted",
                                    )
                                )

                        if post_rows:
                            await cursor.executemany(
                                """
                                INSERT INTO user_posts (
                                    archive_id, user_id, post_index, content, sentiment_score, importance_score,
                                    importance_level, micro_expressions, post_timestamp, emoji_count,
                                    emoji_sequence, fine_risk_value, review_status
                                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                """,
                                post_rows,
                            )
                        await conn.commit()

                summary["synced"].append({
                    "datasetKey": dataset_key,
                    "archives": len(archives),
                    "posts": dataset_meta["total_posts"],
                })
            except Exception as exc:
                summary["failed"].append({"datasetKey": dataset_key, "reason": str(exc)})

        return summary

    async def get_db_archives_page(
        self,
        dataset_key: str,
        risk_level: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """从 MySQL 获取档案分页。"""
        offset = (page - 1) * page_size
        params: List[Any] = [dataset_key]
        where_sql = "WHERE dataset_source = %s"
        if risk_level:
            where_sql += " AND risk_level = %s"
            params.append(risk_level)

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"SELECT COUNT(*) AS cnt FROM psychological_archives {where_sql}",
                    params,
                )
                total_row = await cursor.fetchone()
                total = total_row["cnt"] if total_row else 0
                await cursor.execute(
                    f"""
                    SELECT user_id, dataset_source, post_count, risk_level, risk_value, has_timestamp, has_emojis,
                           import_timestamp, status
                    FROM psychological_archives
                    {where_sql}
                    ORDER BY import_timestamp DESC, id DESC
                    LIMIT %s OFFSET %s
                    """,
                    params + [page_size, offset],
                )
                rows = await cursor.fetchall()

        archives = [
            {
                "id": row["user_id"],
                "userId": row["user_id"],
                "userHash": row["user_id"],
                "datasetSource": row["dataset_source"],
                "postCount": row["post_count"],
                "riskLevel": row["risk_level"],
                "riskValue": row["risk_value"],
                "hasTimestamp": bool(row["has_timestamp"]),
                "hasEmojis": bool(row["has_emojis"]),
                "importTime": row["import_timestamp"].isoformat() if row["import_timestamp"] else None,
                "source": "db",
                "status": row["status"],
            }
            for row in rows
        ]
        return {
            "archives": archives,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "totalPages": (total + page_size - 1) // page_size if total else 1,
        }

    async def get_db_user_posts(
        self,
        dataset_key: str,
        user_hash: str,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        """从 MySQL 获取用户帖子分页。"""
        offset = (page - 1) * page_size
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM user_posts up
                    INNER JOIN psychological_archives pa ON up.archive_id = pa.id
                    WHERE pa.dataset_source = %s AND pa.user_id = %s
                    """,
                    (dataset_key, user_hash),
                )
                total_row = await cursor.fetchone()
                total = total_row["cnt"] if total_row else 0
                await cursor.execute(
                    """
                    SELECT up.user_id, up.post_index, up.content, up.importance_score, up.importance_level,
                           up.post_timestamp, up.emoji_sequence, up.fine_risk_value, pa.risk_level
                    FROM user_posts up
                    INNER JOIN psychological_archives pa ON up.archive_id = pa.id
                    WHERE pa.dataset_source = %s AND pa.user_id = %s
                    ORDER BY up.post_index ASC
                    LIMIT %s OFFSET %s
                    """,
                    (dataset_key, user_hash, page_size, offset),
                )
                rows = await cursor.fetchall()

        posts = [
            {
                "id": f"{row['user_id']}_{row['post_index']}",
                "userId": row["user_id"],
                "postIndex": row["post_index"],
                "content": row["content"],
                "riskLevel": row["risk_level"],
                "riskValue": row["fine_risk_value"],
                "sentimentScore": None,
                "importanceScore": float(row["importance_score"]) if row["importance_score"] is not None else None,
                "timestamp": row["post_timestamp"].isoformat(sep=" ") if row["post_timestamp"] else None,
                "hasTimestamp": bool(row["post_timestamp"]),
                "hasEmojis": bool(row["emoji_sequence"]),
                "emojiSequence": row["emoji_sequence"],
            }
            for row in rows
        ]
        return {"posts": posts, "total": total, "page": page, "pageSize": page_size}

    async def get_db_user_keywords(self, dataset_key: str, user_hash: str, top_n: int = 8) -> List[dict]:
        posts_result = await self.get_db_user_posts(dataset_key=dataset_key, user_hash=user_hash, page=1, page_size=500)
        texts = [post["content"] for post in posts_result["posts"] if post.get("content")]
        if not texts:
            return []

        words = re.findall(r"[\u4e00-\u9fff]+", " ".join(texts))
        freq: Dict[str, int] = {}
        for word in words:
            key = word.strip().lower()
            if len(key) < 2:
                continue
            freq[key] = freq.get(key, 0) + 1
        return [{"word": word, "count": count} for word, count in sorted(freq.items(), key=lambda item: item[1], reverse=True)[:top_n]]

    async def get_dataset_by_key(self, dataset_key: str) -> Optional[dict]:
        """根据 dataset_key 获取单个数据集。"""
        datasets = await self.get_datasets()
        for ds in datasets:
            if ds["datasetKey"] == dataset_key:
                return ds
        return None

    async def get_external_datasets(self) -> List[dict]:
        """获取外部导入的数据集（从 custom_dataset_meta 表）。"""
        result = []
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """
                    SELECT id, name, table_name, mode_type, row_count, columns_info, created_at 
                    FROM custom_dataset_meta ORDER BY created_at DESC
                    """
                )
                rows = await cursor.fetchall()
                for r in rows:
                    result.append({
                        "id": f"ext_{r[0]}",
                        "meta_id": r[0],
                        "name": r[1],
                        "table_name": r[2],
                        "mode_type": r[3],
                        "row_count": r[4],
                        "columns_info": r[5],
                        "created_at": r[6].isoformat() if r[6] else None,
                    })
        return result


    async def get_dataset_config(self, force_refresh: bool = False) -> dict:
        """获取数据集配置信息。

        返回格式：
        {
            'REDDIT': {'csv_path': 'reddit/reddit_500.csv', 'language': 'en', ...},
            ...
        }

        注意：内置数据集数据从 datasets/ CSV 文件读取。
        该方法已不再被 UserService 使用，仅保留兼容。
        """
        from src.services.dataset_csv_service import DatasetCSVService
        csv_svc = DatasetCSVService()
        datasets = csv_svc.list_dataset_csvs()
        config = {}
        for ds in datasets:
            ds_key = ds.get("datasetKey", "").upper()
            config[ds_key] = ds
        return config

    async def get_datasets_compare(self) -> List[dict]:
        """获取数据集对比数据。直接从 dataset_profile 表读取。"""
        result = []
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """
                    SELECT 
                        dataset_key,
                        display_name,
                        language,
                        class_system,
                        class_count,
                        total_users,
                        total_archives,
                        sort_order
                    FROM dataset_profile
                    ORDER BY sort_order ASC
                    """
                )
                async for row in cursor:
                    (dataset_key, display_name, language, class_system, 
                     class_count, total_users, total_archives, sort_order) = row
                    
                    total = total_users or 0
                    balance_ratio = 0.5
                    
                    result.append({
                        "id": dataset_key,
                        "name": display_name,
                        "type": "builtin",
                        "total": total,
                        "user_count": total,
                        "timestamp": True,
                        "language": language,
                        "structure": "social_media",
                        "balance": "balanced" if balance_ratio >= 0.3 else "imbalanced",
                        "balance_ratio": balance_ratio,
                        "task": "risk_detection",
                        "task_type": class_system,
                        "class_count": class_count or 2,
                    })
        return result

    async def import_dataset(
        self,
        name: str,
        fieldnames: List[str],
        reader,
        mode_type: str = "all",
        label_field: Optional[str] = None,
        timestamp_field: Optional[str] = None,
        post_field: Optional[str] = None,
    ) -> dict:
        """导入数据集。"""
        safe_name = _sanitize_table(name)
        ts = datetime.now().strftime("%Y%m%d%H%M")
        table_name = f"ext_{safe_name}_{ts}"
        col_map = {f: _sanitize_col(f) for f in fieldnames}
        safe_cols = list(col_map.values())
        rows = list(reader)

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                cols_ddl = ", ".join(f"`{c}` TEXT" for c in safe_cols)
                await cursor.execute(
                    f"CREATE TABLE IF NOT EXISTS `{table_name}` "
                    f"(id INT PRIMARY KEY AUTO_INCREMENT, {cols_ddl}) "
                    f"ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                )
                placeholders = ", ".join(["%s"] * len(safe_cols))
                insert_sql = (
                    f"INSERT INTO `{table_name}` ({', '.join(f'`{c}`' for c in safe_cols)}) "
                    f"VALUES ({placeholders})"
                )
                for row in rows:
                    vals = [row.get(f) for f in fieldnames]
                    await cursor.execute(insert_sql, vals)

                columns_info = json.dumps(
                    {old: new for old, new in zip(fieldnames, safe_cols)},
                    ensure_ascii=False,
                )
                await cursor.execute(
                    """INSERT INTO custom_dataset_meta (name, table_name, mode_type, row_count, columns_info)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (name, table_name, mode_type, len(rows), columns_info),
                )
                await conn.commit()

                if label_field:
                    try:
                        await cursor.execute(f"SELECT COUNT(*) FROM `{table_name}`")
                        sample_count = (await cursor.fetchone())[0]
                        await cursor.execute(
                            f"SELECT COUNT(DISTINCT user_id) FROM `{table_name}`"
                        )
                        uc = await cursor.fetchone()
                        user_count = uc[0] if uc and uc[0] else sample_count
                        await cursor.execute(
                            f"SELECT DISTINCT {label_field} FROM `{table_name}`"
                        )
                        classes = await cursor.fetchall()
                        class_count = len(classes)
                    except Exception:
                        sample_count = len(rows)
                        user_count = sample_count
                        class_count = 2
                else:
                    sample_count = len(rows)
                    user_count = sample_count
                    class_count = 2

                await cursor.execute(
                    "SELECT id FROM custom_dataset_meta WHERE table_name = %s",
                    (table_name,),
                )
                row_meta = await cursor.fetchone()
                new_id = row_meta[0] if row_meta else None

        return {
            "id": new_id,
            "name": name,
            "table_name": table_name,
            "row_count": len(rows),
            "columns": safe_cols,
            "mode_type": mode_type,
        }
