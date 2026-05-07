# 量表任务服务：仅管理任务 CRUD，不管理量表数据（量表数据由前端本地加载）
from typing import List, Dict, Any, Optional
import aiomysql
import json
from datetime import datetime


class ScaleService:
    """量表任务服务，依赖 MySQL 连接池。"""

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool

    async def get_tasks(
        self,
        status: Optional[str] = None,
        user_hash: Optional[str] = None,
        archive_id: Optional[int] = None,
        data_source: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        """获取量表任务列表（支持分页、筛选）"""
        conditions = []
        params = []

        if status:
            conditions.append("st.status = %s")
            params.append(status)
        if user_hash:
            conditions.append("st.user_hash = %s")
            params.append(user_hash)
        if archive_id:
            conditions.append("st.archive_id = %s")
            params.append(archive_id)
        if data_source:
            conditions.append("st.data_source = %s")
            params.append(data_source)

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        # 获取总数
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                count_sql = f"SELECT COUNT(*) as total FROM scale_tasks st WHERE {where_clause}"
                await cursor.execute(count_sql, params)
                total_row = await cursor.fetchone()
                total = total_row[0] if total_row else 0

        # 统计各状态数量
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                stats_sql = f"SELECT status, COUNT(*) as count FROM scale_tasks st WHERE {where_clause} GROUP BY status"
                await cursor.execute(stats_sql, params)
                stats_rows = await cursor.fetchall()
                stats = {"total": total, "pending": 0, "inProgress": 0, "completed": 0}
                for s_row in stats_rows:
                    s, c = s_row
                    if s == "pending":
                        stats["pending"] = c
                    elif s == "in_progress":
                        stats["inProgress"] = c
                    elif s == "completed":
                        stats["completed"] = c

        # 获取分页数据
        offset = (page - 1) * page_size
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                # scale_name/scale_code 等字段已冗余存储在 scale_tasks 表中，不再 JOIN
                await cursor.execute(
                    f"""SELECT st.*, pa.risk_level AS archive_risk_level
                       FROM scale_tasks st
                       LEFT JOIN psychological_archives pa ON pa.id = st.archive_id
                       WHERE {where_clause}
                       ORDER BY st.created_at DESC
                       LIMIT %s OFFSET %s""",
                    params + [page_size, offset]
                )
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            task = dict(row)
            task["id"] = int(task["id"])
            if task.get("answers") and isinstance(task["answers"], str):
                try:
                    task["answers"] = json.loads(task["answers"])
                except:
                    task["answers"] = []
            result.append(task)

        return {"tasks": result, "stats": stats}

    async def get_task_by_id(self, task_id: int) -> Optional[Dict[str, Any]]:
        """根据 ID 获取任务详情"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                # scale_name 等字段已冗余存储在 scale_tasks 表中，不再 JOIN
                await cursor.execute(
                    """SELECT st.*, pa.risk_level AS archive_risk_level
                       FROM scale_tasks st
                       LEFT JOIN psychological_archives pa ON pa.id = st.archive_id
                       WHERE st.id = %s""",
                    (task_id,)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        task = dict(row)
        task["id"] = int(task["id"])
        if task.get("answers") and isinstance(task["answers"], str):
            try:
                task["answers"] = json.loads(task["answers"])
            except:
                task["answers"] = []
        if task.get("assessment_result") and isinstance(task["assessment_result"], str):
            try:
                task["assessment_result"] = json.loads(task["assessment_result"])
            except:
                pass
        return task

    async def find_archive_user(
        self,
        user_hash: str,
        archive_id: Optional[int] = None,
        data_source: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        conditions = ["user_id = %s"]
        params: List[Any] = [user_hash]
        if archive_id is not None:
            conditions.append("id = %s")
            params.append(archive_id)
        if data_source:
            conditions.append("dataset_source = %s")
            params.append(data_source)

        where_clause = " AND ".join(conditions)
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""SELECT pa.id, pa.user_id, pa.dataset_source, pa.risk_level,
                               dp.display_name AS dataset_display_name
                        FROM psychological_archives pa
                        LEFT JOIN dataset_profile dp ON dp.dataset_key = pa.dataset_source
                        WHERE {where_clause}
                        ORDER BY pa.import_timestamp DESC, pa.id DESC
                        LIMIT 1""",
                    params,
                )
                row = await cursor.fetchone()
        return dict(row) if row else None

    async def create_task(self, task_data: Dict[str, Any]) -> int:
        """创建量表评估任务"""
        now = datetime.now()

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """INSERT INTO scale_tasks
                       (task_name, user_id, user_hash, user_alias, archive_id,
                        data_source, data_source_label, scale_id, scale_code,
                        scale_name, scale_full_name, scale_category,
                        scale_color, scale_bg_color, status, progress,
                        total_questions, answered_questions, answers,
                        total_score, risk_level, started_at, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                               'pending', 0, %s, 0, NULL, NULL, NULL, NULL, %s)""",
                    (
                        task_data.get("task_name", "量表评估任务"),
                        task_data.get("user_id"),
                        task_data.get("user_hash"),
                        task_data.get("user_alias"),
                        task_data.get("archive_id"),
                        task_data.get("data_source"),
                        task_data.get("data_source_label"),
                        task_data.get("scale_id"),
                        task_data.get("scale_code"),
                        task_data.get("scale_name"),
                        task_data.get("scale_full_name"),
                        task_data.get("scale_category"),
                        task_data.get("scale_color"),
                        task_data.get("scale_bg_color"),
                        task_data.get("total_questions", 0),
                        now
                    )
                )
                await conn.commit()
                return cursor.lastrowid

    async def submit_task(
        self,
        task_id: int,
        answers: List[Dict[str, Any]],
        total_score: int,
        risk_level: str,
        assessment_result: Any
    ) -> bool:
        """提交量表答案并更新任务"""
        answered = len(answers)
        now = datetime.now()

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "SELECT total_questions FROM scale_tasks WHERE id = %s",
                    (task_id,)
                )
                row = await cursor.fetchone()

        if not row:
            return False

        question_count = row[0] or 0
        progress = min(100, int(answered / question_count * 100)) if question_count > 0 else 0

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """UPDATE scale_tasks SET
                           answers = %s, total_score = %s, risk_level = %s,
                           assessment_result = %s, answered_questions = %s,
                           progress = %s, status = 'completed',
                           started_at = COALESCE(started_at, %s),
                           completed_at = %s
                       WHERE id = %s""",
                    (
                        json.dumps(answers, ensure_ascii=False),
                        total_score,
                        risk_level,
                        json.dumps(assessment_result, ensure_ascii=False),
                        answered,
                        progress,
                        now,
                        now,
                        task_id
                    )
                )
                await conn.commit()
                return cursor.rowcount > 0

    async def delete_task(self, task_id: int) -> bool:
        """删除任务"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "DELETE FROM scale_tasks WHERE id = %s",
                    (task_id,)
                )
                await conn.commit()
                return cursor.rowcount > 0

    async def get_knowledge_keywords(self, is_active: bool = True, is_hot: bool = None) -> List[Dict[str, Any]]:
        """获取知识库关键词配置"""
        conditions = []
        params = []

        if is_active:
            conditions.append("is_active = %s")
            params.append(True)
        if is_hot is not None:
            conditions.append("is_hot = %s")
            params.append(is_hot)

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""SELECT * FROM knowledge_keywords
                       WHERE {where_clause}
                       ORDER BY is_hot DESC, sort_order ASC, id ASC""",
                    params
                )
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            item = dict(row)
            item["id"] = int(item["id"])
            item["is_hot"] = bool(item["is_hot"])
            item["is_active"] = bool(item["is_active"])
            result.append(item)
        return result
