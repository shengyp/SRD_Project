from typing import Dict, List, Optional, Any
import aiomysql
from src.core.constants import RISK_LEVEL_LOW, RISK_LEVEL_MEDIUM, RISK_LEVEL_HIGH

# 与 DatasetCSVService.DATASET_CONFIG / FeaLearner 内置源一致
_BUILTIN_ARCHIVE_SOURCES = frozenset({"reddit", "weibo", "bigdata", "sigir"})


class UserService:
    """用户与心理档案业务，仅依赖 MySQL。"""

    def __init__(self, mysql_pool, get_dataset_config_fn):
        self.mysql_pool = mysql_pool
        self.get_dataset_config = get_dataset_config_fn

    @staticmethod
    def _pack_archive_rows(rows: List[Any]) -> List[dict]:
        out = []
        for a in rows:
            ts = a.get("import_timestamp")
            if ts is None:
                import_time = ""
            elif hasattr(ts, "isoformat"):
                import_time = ts.isoformat()
            else:
                import_time = str(ts)
            out.append({
                "id": a["user_id"],
                "userId": a["user_id"],
                "datasetSource": a["dataset_source"],
                "postCount": a["post_count"],
                "riskValue": a["risk_value"],
                "riskLevel": a["risk_level"],
                "riskScore": 0.9 if a["risk_level"] == RISK_LEVEL_HIGH else 0.6 if a["risk_level"] == RISK_LEVEL_MEDIUM else 0.1,
                "importTime": import_time,
                "status": a.get("status") or "ready",
                "hasTimestamp": bool(a["has_timestamp"]),
                "hasEmojis": bool(a["has_emojis"]),
            })
        return out

    def _fallback_users_from_builtin_csv(
        self,
        dataset: str,
        risk_level: Optional[str],
        keyword: Optional[str],
        status: Optional[str],
        page: int,
        page_size: int,
    ) -> Optional[dict]:
        """MySQL 无该数据源档案时，从内建 CSV 读取（未跑 sync 也能选人）。"""
        if status and status != "ready":
            return None
        from src.services.dataset_csv_service import DatasetCSVService

        csv_svc = DatasetCSVService()
        infos, csv_total = csv_svc.get_builtin_csv_archives_page(
            dataset_key=dataset,
            risk_level=risk_level,
            keyword=keyword,
            page=page,
            page_size=page_size,
        )
        if not csv_total:
            return None
        rows = []
        for info in infos:
            rows.append({
                "user_id": info.user_id,
                "dataset_source": info.dataset_key,
                "post_count": info.post_count,
                "risk_value": info.risk_value,
                "risk_level": info.risk_level,
                "import_timestamp": info.import_timestamp,
                "status": "ready",
                "has_timestamp": info.has_timestamp,
                "has_emojis": info.has_emojis,
            })
        archives = self._pack_archive_rows(rows)
        return {
            "archives": archives,
            "total": csv_total,
            "page": page,
            "pageSize": page_size,
            "totalPages": (csv_total + page_size - 1) // page_size,
        }

    async def get_users(
        self,
        dataset: Optional[str] = None,
        risk_level: Optional[str] = None,
        keyword: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """分页获取用户列表：优先 MySQL；该数据源无同步记录时回退到内建 CSV。"""
        ds_key = dataset.strip().lower() if dataset else None
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                query = """
                    SELECT id, user_id, dataset_source, post_count, risk_value, import_timestamp,
                           risk_level, status, has_timestamp, has_emojis
                    FROM psychological_archives
                    WHERE 1=1
                """
                count_query = "SELECT COUNT(*) AS cnt FROM psychological_archives WHERE 1=1"
                params = []
                if dataset:
                    query += " AND dataset_source = %s"
                    count_query += " AND dataset_source = %s"
                    params.append(dataset)
                if risk_level:
                    query += " AND risk_level = %s"
                    count_query += " AND risk_level = %s"
                    params.append(risk_level)
                if keyword:
                    query += " AND user_id LIKE %s"
                    count_query += " AND user_id LIKE %s"
                    params.append(f"%{keyword}%")
                if status:
                    query += " AND status = %s"
                    count_query += " AND status = %s"
                    params.append(status)

                await cursor.execute(count_query, params)
                count_row = await cursor.fetchone()
                total = count_row["cnt"] if count_row else 0
                if total:
                    query += " ORDER BY import_timestamp DESC, id DESC LIMIT %s OFFSET %s"
                    await cursor.execute(query, params + [page_size, (page - 1) * page_size])
                    rows = await cursor.fetchall()
                    archives = self._pack_archive_rows(rows)
                    return {
                        "archives": archives,
                        "total": total,
                        "page": page,
                        "pageSize": page_size,
                        "totalPages": (total + page_size - 1) // page_size,
                    }

        if ds_key and ds_key in _BUILTIN_ARCHIVE_SOURCES:
            fb = self._fallback_users_from_builtin_csv(
                ds_key, risk_level, keyword, status, page, page_size
            )
            if fb:
                return fb

        return {"archives": [], "total": 0, "page": page, "pageSize": page_size, "totalPages": 0}

    async def get_user_detail(self, user_hash: str) -> dict:
        """获取单个用户心理档案详情（含帖子列表），仅从 MySQL。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """
                    SELECT user_id, dataset_source, post_count, risk_value, risk_level, import_timestamp
                    FROM psychological_archives
                    WHERE user_id = %s
                    LIMIT 1
                    """,
                    (user_hash,),
                )
                archive = await cursor.fetchone()
                if archive:
                    await cursor.execute(
                        """
                        SELECT post_index, content, fine_risk_value, post_timestamp
                        FROM user_posts
                        WHERE user_id = %s
                        ORDER BY post_index ASC
                        LIMIT 20
                        """,
                        (user_hash,),
                    )
                    posts_rows = await cursor.fetchall()
                    return {
                        "userId": archive["user_id"],
                        "source": archive["dataset_source"],
                        "postCount": archive["post_count"],
                        "avgLabel": float(archive["risk_value"]),
                        "maxLabel": archive["risk_value"],
                        "riskLevel": archive["risk_level"],
                        "riskScore": 0.9 if archive["risk_level"] == RISK_LEVEL_HIGH else 0.6 if archive["risk_level"] == RISK_LEVEL_MEDIUM else 0.1,
                        "posts": [
                            {
                                "id": f"{user_hash}_{p['post_index']}",
                                "text": (p["content"][:200] + "...") if p["content"] and len(p["content"]) > 200 else p["content"],
                                "label": p["fine_risk_value"],
                                "timestamp": p["post_timestamp"].isoformat(sep=" ") if p["post_timestamp"] else None,
                            }
                            for p in posts_rows
                        ],
                        "assessmentTime": archive["import_timestamp"].isoformat() if archive["import_timestamp"] else "",
                    }

        raise ValueError("用户不存在")

    async def delete_user(self, user_hash: str) -> int:
        """删除单个用户档案及关联贴文。"""
        return await self.delete_users([user_hash])

    async def delete_users(self, user_hashes: List[str]) -> int:
        """批量删除用户档案及关联贴文。"""
        normalized_hashes = [item for item in dict.fromkeys(user_hashes) if item]
        if not normalized_hashes:
            return 0

        placeholders = ",".join(["%s"] * len(normalized_hashes))

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"SELECT COUNT(*) AS cnt FROM psychological_archives WHERE user_id IN ({placeholders})",
                    normalized_hashes,
                )
                row = await cursor.fetchone()
                deleted_count = int(row["cnt"]) if row else 0

                if deleted_count == 0:
                    return 0

                await cursor.execute(
                    f"DELETE FROM user_posts WHERE user_id IN ({placeholders})",
                    normalized_hashes,
                )
                await cursor.execute(
                    f"DELETE FROM psychological_archives WHERE user_id IN ({placeholders})",
                    normalized_hashes,
                )
                await conn.commit()

        return deleted_count
