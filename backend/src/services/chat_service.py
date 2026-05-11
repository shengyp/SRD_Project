# 智能问答服务：从 chat_sessions 和 chat_messages 表获取数据
import aiomysql
from typing import List, Dict, Any, Optional
import json
import uuid
from datetime import datetime

DEFAULT_RECOMMENDED_QUESTIONS = {
    "deep_think": [
        {"question": "如何缓解焦虑情绪？请先帮我判断我现在更像压力反应、焦虑还是抑郁倾向。", "category": "情绪梳理"},
        {"question": "如果一个人连续两周情绪低落、失眠、注意力下降，应该如何系统判断严重程度？", "category": "严重程度判断"},
        {"question": "抑郁和焦虑经常同时出现时，日常最先该处理的三个问题是什么？", "category": "共病处理"},
        {"question": "当我说不清自己为什么难受时，你可以用提问的方式一步步帮我梳理吗？", "category": "引导式支持"},
    ],
    "risk_assessment": [
        {"question": "请帮我识别这段表达里是否存在自伤或自杀风险信号，并说明判断依据。", "category": "风险识别"},
        {"question": "如果一个人说“活着没什么意思，但我不会真的去做”，风险等级通常怎么判断？", "category": "风险分级"},
        {"question": "评估危机风险时，最关键要核实的危险细节有哪些？", "category": "风险核查"},
        {"question": "请给我一套适合辅导员或家长使用的风险识别提问清单。", "category": "提问清单"},
    ],
    "intervention": [
        {"question": "如果对方今晚情绪非常差，我现在最优先该做哪三步干预？", "category": "即时干预"},
        {"question": "请给我一份“接下来1小时、今晚、24小时内”的陪伴与干预清单。", "category": "行动清单"},
        {"question": "当对方拒绝沟通、又让我担心安全时，现实中应该怎样升级处置？", "category": "升级处置"},
        {"question": "如果需要联系家属、老师或医院，沟通时该怎么说更稳妥？", "category": "沟通支持"},
    ],
    "scale_interpret": [
        {"question": "量表分数出来后，应该怎样结合最近状态做解释，而不是只看高低？", "category": "结果解释"},
        {"question": "PHQ-9 或 GAD-7 分数偏高时，通常意味着什么，还需要结合哪些信息？", "category": "结果解释"},
        {"question": "请帮我把量表结果翻译成家长、老师也能听懂的说明。", "category": "对外说明"},
        {"question": "量表提示有风险时，后续适合补做哪些问题核查或支持动作？", "category": "后续行动"},
    ],
}


class ChatService:
    """智能问答服务，依赖 MySQL 连接池。"""

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool

    async def ensure_chat_session_title_column(self) -> None:
        """为历史数据库补齐会话标题字段，避免手工迁移。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'chat_sessions'
                      AND COLUMN_NAME = 'title'
                    """
                )
                row = await cursor.fetchone()
                exists = bool(row and row[0])
                if not exists:
                    await cursor.execute(
                        """
                        ALTER TABLE chat_sessions
                        ADD COLUMN title varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '会话标题'
                        AFTER user_hash
                        """
                    )
                    await conn.commit()

    async def get_sessions(
            self,
            user_hash: Optional[str] = None,
            status: str = "active",
            page: int = 1,
            page_size: int = 20,
            order_by: str = "last_message_at",
            include_archived: bool = True
    ) -> Dict[str, Any]:
        """获取会话列表
        
        Args:
            status: 默认查询的会话状态
            include_archived: 是否同时查询 archived 会话（解决历史会话不显示问题）
        """
        # 支持同时查询 active 和 archived 状态的会话
        if include_archived:
            conditions = ["status IN ('active', 'archived')"]
        else:
            conditions = ["status = %s"]
        params: List[Any] = [] if include_archived else [status]

        if user_hash:
            conditions.append("user_hash = %s")
            params.append(user_hash)

        where_clause = " AND ".join(conditions)

        # 获取总数
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"SELECT COUNT(*) as total FROM chat_sessions WHERE {where_clause}",
                    params
                )
                total_row = await cursor.fetchone()
                total = total_row[0] if total_row else 0

        # 获取分页数据
        offset = (page - 1) * page_size
        order_field = "last_message_at" if order_by == "last_message_at" else "created_at"

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"""SELECT id, session_code, user_id, user_hash, title, archive_id,
                              data_source, ai_mode, context_type, message_count,
                              total_tokens, status, is_pinned, last_message_at,
                              last_ai_response_at, created_at, updated_at
                       FROM chat_sessions
                       WHERE {where_clause}
                       ORDER BY is_pinned DESC, {order_field} DESC
                       LIMIT %s OFFSET %s""",
                    params + [page_size, offset]
                )
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            session = dict(row)
            session["id"] = str(session["id"])
            # 解析 JSON 字段
            if session.get("knowledge_sources"):
                try:
                    session["knowledge_sources"] = json.loads(session["knowledge_sources"])
                except:
                    session["knowledge_sources"] = []
            if session.get("rag_keywords"):
                try:
                    session["rag_keywords"] = json.loads(session["rag_keywords"])
                except:
                    session["rag_keywords"] = []
            result.append(session)

        return {
            "sessions": result,
            "total": total,
            "page": page,
            "page_size": page_size
        }

    async def get_session_by_id(self, session_id: int) -> Optional[Dict[str, Any]]:
        """根据 ID 获取会话详情"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT * FROM chat_sessions WHERE id = %s""",
                    (session_id,)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        session = dict(row)
        session["id"] = str(session["id"])
        if session.get("knowledge_sources"):
            try:
                session["knowledge_sources"] = json.loads(session["knowledge_sources"])
            except:
                session["knowledge_sources"] = []
        if session.get("rag_keywords"):
            try:
                session["rag_keywords"] = json.loads(session["rag_keywords"])
            except:
                session["rag_keywords"] = []

        return session

    async def create_session(self, session_data: Dict[str, Any]) -> int:
        """创建新会话"""
        session_code = f"chat_{uuid.uuid4().hex[:12]}"

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """INSERT INTO chat_sessions
                       (session_code, user_id, user_hash, title, archive_id, data_source,
                        ai_mode, context_type, knowledge_sources, rag_keywords)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        session_code,
                        session_data.get("user_id"),
                        session_data.get("user_hash"),
                        session_data.get("title"),
                        session_data.get("archive_id"),
                        session_data.get("data_source"),
                        session_data.get("ai_mode", "deep_think"),
                        session_data.get("context_type", "general"),
                        json.dumps(session_data.get("knowledge_sources", []), ensure_ascii=False),
                        json.dumps(session_data.get("rag_keywords", []), ensure_ascii=False)
                    )
                )
                await conn.commit()
                return cursor.lastrowid

    async def update_session(
        self,
        session_id: int,
        update_data: Dict[str, Any],
        message_count_delta: int = 0,
    ) -> bool:
        """更新会话；message_count_delta 用于一次问答产生多条消息时累计计数。"""
        set_clauses = []
        params = []

        for key, value in update_data.items():
            if key in ["ai_mode", "context_type", "status", "is_pinned", "title"]:
                set_clauses.append(f"{key} = %s")
                params.append(value)
            elif key in ["knowledge_sources", "rag_keywords"]:
                set_clauses.append(f"{key} = %s")
                params.append(json.dumps(value, ensure_ascii=False) if value else None)

        if message_count_delta > 0:
            set_clauses.append("message_count = message_count + %s")
            params.append(message_count_delta)

        if set_clauses:
            set_clauses.append("last_message_at = NOW()")

            async with self.mysql_pool.acquire() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute("SET NAMES utf8mb4")
                    await cursor.execute(
                        f"""UPDATE chat_sessions SET {', '.join(set_clauses)} WHERE id = %s""",
                        params + [session_id]
                    )
                    await conn.commit()
                    return cursor.rowcount > 0
        return False

    async def delete_session(self, session_id: int) -> bool:
        """删除会话（软删除）"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """UPDATE chat_sessions SET status = 'deleted', archived_at = NOW() WHERE id = %s""",
                    (session_id,)
                )
                await conn.commit()
                return cursor.rowcount > 0

    async def get_messages(
            self,
            session_id: int,
            page: int = 1,
            page_size: int = 50
    ) -> Dict[str, Any]:
        """获取会话消息列表"""
        # 获取总数
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "SELECT COUNT(*) as total FROM chat_messages WHERE session_id = %s",
                    (session_id,)
                )
                total_row = await cursor.fetchone()
                total = total_row[0] if total_row else 0

        # 获取分页数据
        offset = (page - 1) * page_size
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT id, session_id, role, content, content_type,
                              attachments, has_image, has_file, ai_model, ai_mode,
                              tokens_used, processing_time_ms, rag_context,
                              retrieval_sources, is_generating, is_error,
                              error_message, references_json, parent_message_id,
                              created_at
                       FROM chat_messages
                       WHERE session_id = %s
                       ORDER BY id ASC
                       LIMIT %s OFFSET %s""",
                    (session_id, page_size, offset)
                )
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            msg = dict(row)
            msg["id"] = str(msg["id"])
            msg["session_id"] = str(msg["session_id"])
            # 解析 JSON 字段
            for json_field in ["attachments", "rag_context", "retrieval_sources", "references_json"]:
                if msg.get(json_field) and isinstance(msg[json_field], str):
                    try:
                        msg[json_field] = json.loads(msg[json_field])
                    except:
                        msg[json_field] = None
            # 添加 camelCase 别名（供前端直接访问）
            msg["references"] = msg.get("references_json")
            msg["retrievalSources"] = msg.get("retrieval_sources")
            msg["ragContext"] = msg.get("rag_context")
            result.append(msg)

        return {
            "messages": result,
            "total": total,
            "page": page,
            "page_size": page_size
        }

    async def create_message(self, message_data: Dict[str, Any]) -> int:
        """创建新消息"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """INSERT INTO chat_messages
                       (session_id, role, content, content_type, attachments,
                        has_image, has_file, ai_model, ai_mode, tokens_used,
                        processing_time_ms, rag_context, retrieval_sources,
                        is_generating, is_error, error_message, references_json,
                        parent_message_id)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        message_data.get("session_id"),
                        message_data.get("role"),
                        message_data.get("content"),
                        message_data.get("content_type", "text"),
                        json.dumps(message_data.get("attachments", []), ensure_ascii=False),
                        message_data.get("has_image", False),
                        message_data.get("has_file", False),
                        message_data.get("ai_model"),
                        message_data.get("ai_mode"),
                        message_data.get("tokens_used"),
                        message_data.get("processing_time_ms"),
                        json.dumps(message_data.get("rag_context"), ensure_ascii=False) if message_data.get(
                            "rag_context") else None,
                        json.dumps(message_data.get("retrieval_sources", []), ensure_ascii=False) if message_data.get(
                            "retrieval_sources") else None,
                        message_data.get("is_generating", False),
                        message_data.get("is_error", False),
                        message_data.get("error_message"),
                        json.dumps(message_data.get("references_json"), ensure_ascii=False) if message_data.get(
                            "references_json") else None,
                        message_data.get("parent_message_id")
                    )
                )
                await conn.commit()
                return cursor.lastrowid

    async def update_message(self, message_id: int, update_data: Dict[str, Any]) -> bool:
        """更新消息"""
        set_clauses = []
        params = []

        for key, value in update_data.items():
            if key in ["content", "content_type", "is_generating", "is_streaming",
                       "is_error", "error_message", "tokens_used", "processing_time_ms"]:
                set_clauses.append(f"{key} = %s")
                params.append(value)
            elif key in ["rag_context", "retrieval_sources", "references_json"]:
                set_clauses.append(f"{key} = %s")
                params.append(json.dumps(value, ensure_ascii=False) if value else None)

        if set_clauses:
            async with self.mysql_pool.acquire() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute("SET NAMES utf8mb4")
                    await cursor.execute(
                        f"""UPDATE chat_messages SET {', '.join(set_clauses)} WHERE id = %s""",
                        params + [message_id]
                    )
                    await conn.commit()
                    return cursor.rowcount > 0
        return False

    async def get_recommended_questions(
            self,
            ai_mode: str = "all",
            limit: int = 8
    ) -> List[Dict[str, Any]]:
        """获取推荐问题列表。

        规则：
        1. 指定 ai_mode 时优先返回该模式专属问题；
        2. 不足 limit 时，再用 ai_mode='all' 的通用问题补齐；
        3. 按 question 文本去重，避免历史重复种子数据把结果占满。
        """
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                if ai_mode == "all":
                    await cursor.execute(
                        """SELECT id, question, ai_mode, category, keywords, sort_order, usage_count
                           FROM chat_recommended_questions
                           WHERE is_active = TRUE
                           ORDER BY sort_order ASC, usage_count DESC
                           LIMIT %s""",
                        (limit,)
                    )
                    rows = await cursor.fetchall()
                else:
                    await cursor.execute(
                        """SELECT id, question, ai_mode, category, keywords, sort_order, usage_count
                           FROM chat_recommended_questions
                           WHERE is_active = TRUE AND ai_mode = %s
                           ORDER BY sort_order ASC, usage_count DESC
                           LIMIT %s""",
                        (ai_mode, limit)
                    )
                    mode_rows = await cursor.fetchall()

                    rows = list(mode_rows)
                    if len(rows) < limit:
                        await cursor.execute(
                            """SELECT id, question, ai_mode, category, keywords, sort_order, usage_count
                               FROM chat_recommended_questions
                               WHERE is_active = TRUE AND ai_mode = 'all'
                               ORDER BY sort_order ASC, usage_count DESC
                               LIMIT %s""",
                            (max(limit * 2, 16),)
                        )
                        rows.extend(await cursor.fetchall())

        result = []
        seen_questions = set()
        for row in rows:
            q = dict(row)
            question = (q.get("question") or "").strip()
            if not question or question in seen_questions:
                continue
            seen_questions.add(question)
            q["id"] = str(q["id"])
            if q.get("keywords") and isinstance(q["keywords"], str):
                try:
                    q["keywords"] = json.loads(q["keywords"])
                except:
                    q["keywords"] = []
            result.append(q)
            if len(result) >= limit:
                break

        if ai_mode != "all":
            prioritized_result = []
            prioritized_seen = set()

            for row in result:
                question = (row.get("question") or "").strip()
                if not question or question in prioritized_seen:
                    continue
                if row.get("ai_mode") == ai_mode:
                    prioritized_result.append(row)
                    prioritized_seen.add(question)

            for index, item in enumerate(DEFAULT_RECOMMENDED_QUESTIONS.get(ai_mode, []), start=1):
                question = item["question"].strip()
                if not question or question in prioritized_seen:
                    continue
                prioritized_result.append({
                    "id": f"default-{ai_mode}-{index}",
                    "question": question,
                    "ai_mode": ai_mode,
                    "category": item["category"],
                    "keywords": [],
                    "sort_order": 10_000 + index,
                    "usage_count": 0,
                })
                prioritized_seen.add(question)
                if len(prioritized_result) >= limit:
                    break

            if len(prioritized_result) < limit:
                for row in result:
                    question = (row.get("question") or "").strip()
                    if not question or question in prioritized_seen:
                        continue
                    prioritized_result.append(row)
                    prioritized_seen.add(question)
                    if len(prioritized_result) >= limit:
                        break

            result = prioritized_result

        return result
