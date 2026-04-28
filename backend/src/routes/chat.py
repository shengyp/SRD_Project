# 智能问答路由：LLM 对话咨询，从 MySQL 数据库查询
from fastapi import APIRouter, Query, HTTPException, Request, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, AsyncIterator, Tuple, Any, Dict, Union
from datetime import datetime

import sys
import os
import json
import asyncio
import time
from collections import OrderedDict

current_dir = os.path.dirname(os.path.abspath(__file__))
_backend_root = os.path.dirname(os.path.dirname(current_dir))
_sui_agent_root = os.path.join(_backend_root, "SuiAgent-main")
_uploads_dir = os.path.join(_backend_root, "uploads")
sys.path.insert(0, _sui_agent_root)
from agent import SuicideAgent

# 导入附件服务（仅用于文件上传，解析由 LLM 原生处理）
_service_dir = os.path.dirname(os.path.abspath(__file__))  # backend/src/routes/
_src_dir = os.path.dirname(_service_dir)                    # backend/src/
_backend_root = os.path.dirname(_src_dir)                   # backend/
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)
try:
    from src.services.attachment_service import resolve_attachment_path
except ImportError:
    # 降级：附件功能不可用
    def resolve_attachment_path(saved_name: str) -> Optional[str]:
        return None

router = APIRouter(prefix="", tags=["chat"])


# ============================================================
# Agent 实例池：按 session_id 复用 SuicideAgent，避免每次请求重建
# ============================================================
_agent_pool: OrderedDict = OrderedDict()  # type: ignore[var-annotated]
_MAX_POOL_SIZE = 50  # 最多缓存 50 个会话的 Agent
_POOLD_TTL_SECONDS = 600  # 10 分钟无活动则释放


def _get_agent(session_id: str, preset_intent: str) -> Any:
    """从池中获取或创建 Agent 实例。"""
    now = time.time()
    # 清理过期项
    expired = [k for k, (_, last_used) in _agent_pool.items() if now - last_used > _POOLD_TTL_SECONDS]
    for k in expired:
        del _agent_pool[k]
    # 保持池大小
    while len(_agent_pool) >= _MAX_POOL_SIZE and _agent_pool:
        _agent_pool.popitem(last=False)

    if session_id in _agent_pool:
        agent, _ = _agent_pool[session_id]
        _agent_pool[session_id] = (agent, now)
        return agent

    agent = SuicideAgent(
        session_id=session_id,
        knowledge_base_path=_sui_knowledge_path(),
        preset_intent=preset_intent,
    )
    _agent_pool[session_id] = (agent, now)
    return agent


def _evict_agent(session_id: str) -> None:
    """会话结束时从池中移除 Agent。"""
    _agent_pool.pop(session_id, None)


def _warmup_agent_pool(count: int = 3) -> None:
    """启动时预热 Agent 池，提前加载模型，减少首次请求延迟（同步版本）。"""
    # 获取知识库路径（使用相对路径避免 Windows 中文路径编码问题）
    knowledge_path = (
        os.getenv("SUIAGENT_KNOWLEDGE_PATH", "").strip()
        or os.getenv("SUIIAGENT_KNOWLEDGE_PATH", "").strip()
        or "SuiAgent-main/rag-skill/knowledge"
    )

    print(f"🔄 正在预热 Agent 池（{count} 个实例）...")
    for i in range(count):
        warmup_session_id = f"__warmup_{i}__"
        try:
            agent = SuicideAgent(
                session_id=warmup_session_id,
                knowledge_base_path=knowledge_path,
                preset_intent="",
            )
            _agent_pool[warmup_session_id] = (agent, time.time())
            print(f"  ✅ Agent #{i+1} 预热完成")
        except Exception as e:
            print(f"  ⚠️ Agent #{i+1} 预热失败: {str(e)}")
    print(f"✅ Agent 池预热完成（共 {len(_agent_pool)} 个实例）")


async def _warmup_agent_pool_async(count: int = 1) -> None:
    """后台异步预热 Agent 池，不阻塞后端启动。"""
    # 获取知识库路径（使用相对路径避免 Windows 中文路径编码问题）
    knowledge_path = (
        os.getenv("SUIAGENT_KNOWLEDGE_PATH", "").strip()
        or os.getenv("SUIIAGENT_KNOWLEDGE_PATH", "").strip()
        or "SuiAgent-main/rag-skill/knowledge"
    )

    print(f"🔄 [后台] 正在异步预热 Agent 池（{count} 个实例）...")
    for i in range(count):
        warmup_session_id = f"__warmup_{i}__"
        try:
            agent = SuicideAgent(
                session_id=warmup_session_id,
                knowledge_base_path=knowledge_path,
                preset_intent="",
            )
            _agent_pool[warmup_session_id] = (agent, time.time())
            print(f"  ✅ [后台] Agent #{i+1} 预热完成")
        except Exception as e:
            print(f"  ⚠️ [后台] Agent #{i+1} 预热失败: {str(e)}")
    print(f"✅ [后台] Agent 池预热完成（共 {len(_agent_pool)} 个实例）")

# 前端中文标签 -> 数据库存储的 ai_mode
_UI_AI_MODE_MAP = {
    "深度思考": "deep_think",
    "风险评估": "risk_assessment",
    "干预建议": "intervention",
    "量表解读": "scale_interpret",
}


def _normalize_ai_mode(mode: Optional[str]) -> str:
    if not mode:
        return "deep_think"
    if mode in _UI_AI_MODE_MAP:
        return _UI_AI_MODE_MAP[mode]
    if mode in ("deep_think", "risk_assessment", "intervention", "scale_interpret"):
        return mode
    return "deep_think"


def _ai_mode_to_preset_intent(ai_mode: str) -> str:
    """与 SuiAgent SuicideAgent.process_message 的 preset_intent 语义对齐。"""
    if ai_mode == "deep_think":
        return ""
    if ai_mode == "risk_assessment":
        return "emotional_support"
    if ai_mode in ("intervention", "scale_interpret"):
        return "professional_query"
    return ""


def _parse_references_row(row: dict):
    raw = row.get("references_json")
    if raw is None:
        return None
    if isinstance(raw, (list, dict)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return None
    return None


# ========================
# Pydantic Models
# ========================
class ChatSessionCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    user_hash: Optional[str] = Field(None, alias="userHash")
    title: Optional[str] = None
    context: Optional[dict] = None
    ai_mode: Optional[str] = Field("deep_think", alias="aiMode")
    context_type: Optional[str] = Field("general", alias="contextType")


class ChatMessageSend(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    content: str
    session_id: Optional[str] = None
    ai_mode: Optional[str] = Field(None, alias="aiMode")


class AttachmentInfo(BaseModel):
    """附件信息（从前端发送的结构）"""
    id: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    url: Optional[str] = None
    saved_name: Optional[str] = None  # 后端保存的文件名（核心字段）


class PostSessionMessageBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    content: str
    attachments: Optional[List[AttachmentInfo]] = None
    ai_mode: Optional[str] = Field(None, alias="aiMode")


# ========================
# 辅助函数
# ========================
def _get_chat_service(request: Request):
    return request.app.state.chat_service


def _sui_knowledge_path() -> str:
    """返回知识库相对路径，避免 Windows 中文路径导致的编码问题。"""
    override = (
        os.getenv("SUIAGENT_KNOWLEDGE_PATH", "").strip()
        or os.getenv("SUIIAGENT_KNOWLEDGE_PATH", "").strip()
    )
    if override:
        return override
    # 使用相对路径，避免 Windows 中文路径编码问题
    return "SuiAgent-main/rag-skill/knowledge"


def _persisted_llm_model_name() -> str:
    name = os.getenv("LLM_MODEL", "deepseek-chat").strip()
    return name or "deepseek-chat"


def _resolve_attachment_file_path(saved_name: Optional[str]) -> Optional[str]:
    """根据 saved_name 解析 uploads 目录中的完整文件路径"""
    if not saved_name:
        return None
    path = os.path.join(_uploads_dir, saved_name)
    if os.path.isfile(path):
        return path
    return None


def _build_attachments_for_llm(attachments: Optional[List[AttachmentInfo]]) -> List[Dict]:
    """
    构建附件列表，用于直接传给 LLM 的多模态接口。
    仅返回文件路径，文件内容由 LLM.py 读取并编码。
    """
    if not attachments:
        return []

    result = []
    for att in attachments:
        saved_name = att.saved_name
        if not saved_name:
            continue

        file_path = _resolve_attachment_file_path(saved_name)
        if not file_path:
            continue

        result.append({
            "path": file_path,
            "name": att.name or saved_name,
            "type": att.type or "file"
        })

    return result


def _enrich_user_content_with_attachments(user_content: str, attachments: Optional[List[AttachmentInfo]]) -> str:
    """
    简化版：将附件信息以提示形式添加到用户消息中。
    注意：实际文件内容由 LLM.py 的多模态接口直接处理，这里仅添加说明文本。
    """
    if not attachments:
        return user_content

    attachment_descs = []
    for att in attachments:
        saved_name = att.saved_name
        if not saved_name:
            continue

        file_path = _resolve_attachment_file_path(saved_name)
        if not file_path:
            continue

        # 根据文件类型生成描述
        ext = os.path.splitext(file_path)[1].lower()
        if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
            desc = f"[用户上传了一张图片: {att.name or saved_name}]"
        elif ext in [".pdf", ".doc", ".docx"]:
            desc = f"[用户上传了一个文档: {att.name or saved_name}]"
        elif ext in [".xls", ".xlsx"]:
            desc = f"[用户上传了一个表格: {att.name or saved_name}]"
        else:
            desc = f"[用户上传了文件: {att.name or saved_name}]"

        attachment_descs.append(desc)

    if attachment_descs:
        return f"{user_content}\n\n{'；'.join(attachment_descs)}"
    return user_content


async def _run_suicide_agent_reply(
    session_id_str: str, user_content: str, preset_intent: str,
    attachments: Optional[List[AttachmentInfo]] = None
) -> str:
    """使用 Agent 池复用实例，提升响应速度。"""
    enriched_content = _enrich_user_content_with_attachments(user_content, attachments)
    # 构建附件列表用于传给 Agent（支持多模态）
    attachments_for_llm = _build_attachments_for_llm(attachments)
    agent = _get_agent(session_id_str, preset_intent)
    res = await agent.process_message(enriched_content, attachments=attachments_for_llm)
    return res["LLM_ans"]


async def _stream_suicide_agent_reply(
    session_id_str: str, user_content: str, preset_intent: str,
    attachments: Optional[List[AttachmentInfo]] = None
) -> AsyncIterator[str]:
    """流式调用 Agent，实时 yield LLM 输出片段（支持 SSE）。"""
    enriched_content = _enrich_user_content_with_attachments(user_content, attachments)
    # 构建附件列表用于传给 Agent（支持多模态）
    attachments_for_llm = _build_attachments_for_llm(attachments)
    try:
        agent = _get_agent(session_id_str, preset_intent)
        print(f"[_stream_suicide_agent_reply] 开始流式处理会话 {session_id_str}")
        chunk_count = 0
        async for chunk in agent.stream_process_message(enriched_content, attachments=attachments_for_llm):
            chunk_count += 1
            yield chunk
        print(f"[_stream_suicide_agent_reply] 流式处理完成，共 {chunk_count} 个 chunk")
    except Exception as e:
        import traceback
        print(f"[Agent Stream Error] {str(e)}")
        print(f"[Agent Stream Error] Traceback: {traceback.format_exc()}")
        # 返回错误消息
        yield json.dumps({"type": "error", "message": f"Agent 处理失败: {str(e)}"}, ensure_ascii=False)


def _msg_row_to_response(row: dict) -> dict:
    """将数据库消息行转换为前端期望的格式"""
    return {
        "id": str(row.get("id")),
        "sessionId": str(row.get("session_id")),
        "role": row.get("role"),
        "content": row.get("content"),
        "contentType": row.get("content_type"),
        "attachments": row.get("attachments"),
        "hasImage": row.get("has_image"),
        "hasFile": row.get("has_file"),
        "aiModel": row.get("ai_model"),
        "aiMode": row.get("ai_mode"),
        "tokensUsed": row.get("tokens_used"),
        "processingTimeMs": row.get("processing_time_ms"),
        "ragContext": row.get("rag_context"),
        "retrievalSources": row.get("retrieval_sources"),
        "isGenerating": row.get("is_generating"),
        "isStreaming": row.get("is_streaming"),
        "isError": row.get("is_error"),
        "errorMessage": row.get("error_message"),
        "referencesJson": row.get("references_json"),
        "references": _parse_references_row(row),
        "parentMessageId": str(row.get("parent_message_id")) if row.get("parent_message_id") else None,
        "createdAt": str(row.get("created_at")) if row.get("created_at") else None,
    }


def _session_row_to_response(row: dict) -> dict:
    """将数据库会话行转换为前端期望的格式"""
    return {
        "id": str(row.get("id")),
        "sessionCode": row.get("session_code"),
        "userId": str(row.get("user_id")) if row.get("user_id") else None,
        "userHash": row.get("user_hash"),
        "archiveId": str(row.get("archive_id")) if row.get("archive_id") else None,
        "dataSource": row.get("data_source"),
        "aiMode": row.get("ai_mode"),
        "contextType": row.get("context_type"),
        "knowledgeSources": row.get("knowledge_sources"),
        "ragKeywords": row.get("rag_keywords"),
        "messageCount": row.get("message_count", 0),
        "totalTokens": row.get("total_tokens", 0),
        "status": row.get("status"),
        "isPinned": row.get("is_pinned", False),
        "lastMessageAt": str(row.get("last_message_at")) if row.get("last_message_at") else None,
        "lastAiResponseAt": str(row.get("last_ai_response_at")) if row.get("last_ai_response_at") else None,
        "createdAt": str(row.get("created_at")) if row.get("created_at") else None,
        "updatedAt": str(row.get("updated_at")) if row.get("updated_at") else None,
    }


# ========================
# Routes
# ========================
@router.get("/api/chat/sessions")
async def get_chat_sessions(
    request: Request,
    user_hash: Optional[str] = Query(None, description="用户哈希"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    include_archived: bool = Query(True, description="是否包含已归档会话"),
):
    """获取聊天会话列表（默认包含 active 和 archived 会话）"""
    chat_svc = _get_chat_service(request)

    result = await chat_svc.get_sessions(
        user_hash=user_hash,
        page=page,
        page_size=page_size,
        include_archived=include_archived,
    )

    return {
        "success": True,
        "data": {
            "sessions": [_session_row_to_response(s) for s in result.get("sessions", [])],
            "total": result.get("total", 0),
            "page": result.get("page", page),
            "page_size": result.get("page_size", page_size)
        }
    }


@router.post("/api/chat/sessions")
async def create_chat_session(session: ChatSessionCreate = Body(...), request: Request = None):
    """创建新的聊天会话"""
    chat_svc = _get_chat_service(request)

    norm_mode = _normalize_ai_mode(session.ai_mode)
    session_data = {
        "user_hash": session.user_hash,
        "data_source": None,
        "ai_mode": norm_mode,
        "context_type": session.context_type or "general",
    }

    session_id = await chat_svc.create_session(session_data)
    created = await chat_svc.get_session_by_id(session_id)

    return {"success": True, "data": _session_row_to_response(created)}


@router.get("/api/chat/sessions/{session_id}")
async def get_chat_session_detail(session_id: str, request: Request):
    """获取会话详情（含消息）"""
    chat_svc = _get_chat_service(request)

    try:
        session_int = int(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = await chat_svc.get_session_by_id(session_int)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 获取消息
    msgs_result = await chat_svc.get_messages(session_int, page=1, page_size=100)
    session["messages"] = [_msg_row_to_response(m) for m in msgs_result.get("messages", [])]

    return {"success": True, "data": _session_row_to_response(session)}


@router.delete("/api/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str, request: Request):
    """删除聊天会话"""
    chat_svc = _get_chat_service(request)

    try:
        session_int = int(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="会话不存在")

    deleted = await chat_svc.delete_session(session_int)
    if not deleted:
        raise HTTPException(status_code=404, detail="会话不存在")

    return {"success": True, "message": "会话已删除"}


@router.post("/api/chat/send")
async def send_chat_message(message: ChatMessageSend = Body(...), request: Request = None):
    """发送消息并获取 LLM 响应"""
    user_content = message.content.strip()
    if not user_content:
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    chat_svc = _get_chat_service(request)
    session_id_int: Optional[int] = None

    # 确定会话
    if message.session_id:
        try:
            session_id_int = int(message.session_id)
        except ValueError:
            raise HTTPException(status_code=404, detail="会话不存在")

        session = await chat_svc.get_session_by_id(session_id_int)
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
    else:
        norm_mode = _normalize_ai_mode(message.ai_mode)
        session_data = {
            "user_hash": None,
            "data_source": None,
            "ai_mode": norm_mode,
            "context_type": "general",
        }
        session_id_int = await chat_svc.create_session(session_data)
        session = await chat_svc.get_session_by_id(session_id_int)

    ai_mode = _normalize_ai_mode(message.ai_mode or (session.get("ai_mode") if session else None))
    preset_intent = _ai_mode_to_preset_intent(ai_mode)

    # 保存用户消息
    user_msg_data = {
        "session_id": session_id_int,
        "role": "user",
        "content": user_content,
        "content_type": "text",
    }
    user_msg_id = await chat_svc.create_message(user_msg_data)

    try:
        assistant_content = await _run_suicide_agent_reply(
            str(session_id_int), user_content, preset_intent
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"消息处理失败：{str(e)}")

    # 保存助手消息
    assistant_msg_data = {
        "session_id": session_id_int,
        "role": "ai",
        "content": assistant_content,
        "content_type": "text",
        "ai_model": _persisted_llm_model_name(),
        "ai_mode": ai_mode,
    }
    assistant_msg_id = await chat_svc.create_message(assistant_msg_data)

    await chat_svc.update_session(session_id_int, {"status": "active"}, message_count_delta=2)

    # 获取保存的消息
    user_msg_row = await chat_svc.get_messages(session_id_int, page=1, page_size=100)
    all_msgs = user_msg_row.get("messages", [])
    user_msg = next((m for m in all_msgs if str(m.get("id")) == str(user_msg_id)), None)
    assistant_msg = next((m for m in all_msgs if str(m.get("id")) == str(assistant_msg_id)), None)

    return {
        "success": True,
        "data": {
            "session_id": str(session_id_int),
            "user_message": _msg_row_to_response(user_msg) if user_msg else None,
            "assistant_message": _msg_row_to_response(assistant_msg) if assistant_msg else None,
        }
    }


@router.get("/api/chat/messages/{session_id}")
async def get_chat_messages(
    session_id: str,
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    """获取会话消息列表"""
    chat_svc = _get_chat_service(request)

    try:
        session_int = int(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = await chat_svc.get_session_by_id(session_int)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    result = await chat_svc.get_messages(session_int, page=page, page_size=page_size)

    return {
        "success": True,
        "data": [_msg_row_to_response(m) for m in result.get("messages", [])],
    }


@router.get("/api/chat/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    """获取指定会话的消息列表（与前端 fetchChatMessages 匹配）"""
    chat_svc = _get_chat_service(request)

    try:
        session_int = int(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = await chat_svc.get_session_by_id(session_int)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    result = await chat_svc.get_messages(session_int, page=page, page_size=page_size)

    return {
        "success": True,
        "data": [_msg_row_to_response(m) for m in result.get("messages", [])],
    }


@router.post("/api/chat/sessions/{session_id}/messages/stream")
async def post_session_message_stream(
    session_id: str,
    request: Request,
    body: PostSessionMessageBody = Body(...),
):
    """
    流式发送消息：前端可实时看到 AI 输出（Server-Sent Events）。
    流结束后自动保存用户消息和助手回复到数据库。
    """
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    chat_svc = _get_chat_service(request)

    try:
        session_int = int(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = await chat_svc.get_session_by_id(session_int)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    ai_mode = _normalize_ai_mode(body.ai_mode or session.get("ai_mode"))
    preset_intent = _ai_mode_to_preset_intent(ai_mode)

    # 保存用户消息
    user_msg_data = {
        "session_id": session_int,
        "role": "user",
        "content": content,
        "content_type": "text",
    }
    user_msg_id = await chat_svc.create_message(user_msg_data)

    async def event_generator() -> AsyncIterator[bytes]:
        full_response = ""
        rag_sources_data = []
        rag_evidence_data = []
        context_sources_data = []
        references_json = None
        chunk_count = 0
        print(f"[event_generator] 开始处理会话 {session_int}")
        try:
            async for chunk in _stream_suicide_agent_reply(
                str(session_int), content, preset_intent, attachments=body.attachments
            ):
                chunk_count += 1
                if not isinstance(chunk, str):
                    print(f"[event_generator] 收到非字符串 chunk: {type(chunk)}")
                    continue
                # 尝试解析 JSON 特殊事件
                try:
                    parsed = json.loads(chunk)
                except json.JSONDecodeError:
                    # 无法解析为 JSON，当作普通文本
                    full_response += chunk
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk}, ensure_ascii=False)}\n\n".encode("utf-8")
                    continue

                if not isinstance(parsed, dict):
                    full_response += chunk
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk}, ensure_ascii=False)}\n\n".encode("utf-8")
                    continue

                event_type = parsed.get("type")
                # RAG 相关事件：立即 yield 给前端（实时显示），同时缓冲到变量（后续持久化）
                if event_type == "rag_sources":
                    sources = parsed.get("sources", [])
                    rag_sources_data = sources
                    print(f"[event_generator] 收到 rag_sources 事件，来源数: {len(sources)}")
                    yield f"data: {json.dumps({'type': 'rag_sources', 'sources': sources}, ensure_ascii=False)}\n\n".encode("utf-8")
                elif event_type == "mind_map":
                    print(f"[event_generator] 收到 mind_map 事件")
                    yield f"data: {json.dumps({'type': 'mind_map', 'mindMap': parsed.get('mindMap')}, ensure_ascii=False)}\n\n".encode("utf-8")
                elif event_type == "rag_evidence":
                    evidence = parsed.get("evidence", [])
                    rag_evidence_data = evidence
                    print(f"[event_generator] 收到 rag_evidence 事件，证据数: {len(evidence)}")
                    yield f"data: {json.dumps({'type': 'rag_evidence', 'evidence': evidence}, ensure_ascii=False)}\n\n".encode("utf-8")
                elif event_type == "pre_knowledge":
                    print(f"[event_generator] 收到 pre_knowledge 事件")
                    yield f"data: {json.dumps({'type': 'pre_knowledge', 'terms': parsed.get('terms', [])}, ensure_ascii=False)}\n\n".encode("utf-8")
                elif event_type == "context_sources":
                    sources = parsed.get("sources", [])
                    context_sources_data = sources
                    print(f"[event_generator] 收到 context_sources 事件")
                    yield f"data: {json.dumps({'type': 'context_sources', 'sources': sources}, ensure_ascii=False)}\n\n".encode("utf-8")
                elif event_type == "error":
                    print(f"[event_generator] 收到 error 事件: {parsed.get('message')}")
                    yield f"data: {json.dumps({'type': 'error', 'message': parsed.get('message')}, ensure_ascii=False)}\n\n".encode("utf-8")
                else:
                    # 未知类型，当作普通文本
                    full_response += chunk
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk}, ensure_ascii=False)}\n\n".encode("utf-8")
            
            print(f"[event_generator] 流式处理完成，共 {chunk_count} chunks，响应长度: {len(full_response)}")
        except Exception as e:
            import traceback
            error_msg = str(e)
            print(f"[Chat Stream Error] {error_msg}")
            print(f"[Chat Stream Error] Traceback: {traceback.format_exc()}")
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg}, ensure_ascii=False)}\n\n".encode("utf-8")
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n".encode("utf-8")
            # 异步保存错误消息（不阻塞）
            try:
                assistant_msg_data = {
                    "session_id": session_int,
                    "role": "ai",
                    "content": f"抱歉，发生了错误：{error_msg}",
                    "content_type": "text",
                    "ai_model": _persisted_llm_model_name(),
                    "ai_mode": ai_mode,
                    "is_error": True,
                    "error_message": error_msg,
                    "references_json": references_json,
                    "retrieval_sources": rag_sources_data if rag_sources_data else None,
                    "rag_context": json.dumps(rag_evidence_data, ensure_ascii=False) if rag_evidence_data else None,
                }
                await chat_svc.create_message(assistant_msg_data)
                await chat_svc.update_session(session_int, {"status": "active"}, message_count_delta=2)
            except Exception:
                pass
            return

        # 流正常结束：保存助手消息（异步，不阻塞）
        # 构建 references_json：将 rag_sources 转为标准引用格式
        if rag_sources_data:
            references_list = []
            for idx, src in enumerate(rag_sources_data):
                references_list.append({
                    "id": src.get("id", ""),
                    "title": src.get("title", ""),
                    "type": src.get("type", "md"),
                    "topic": src.get("topic", ""),
                    "subTopic": src.get("subTopic", ""),
                    "relevanceScore": 1.0 - (idx * 0.1) if idx < 10 else 0.5,
                })
            references_json = references_list

        # 构建 retrieval_sources：与 references_json 内容一致，作为备用字段
        retrieval_sources = rag_sources_data if rag_sources_data else None

        assistant_msg_data = {
            "session_id": session_int,
            "role": "ai",
            "content": full_response,
            "content_type": "text",
            "ai_model": _persisted_llm_model_name(),
            "ai_mode": ai_mode,
            "references_json": references_json,
            "retrieval_sources": retrieval_sources,
            "rag_context": json.dumps(rag_evidence_data, ensure_ascii=False) if rag_evidence_data else None,
        }
        await chat_svc.create_message(assistant_msg_data)
        await chat_svc.update_session(session_int, {"status": "active"}, message_count_delta=2)

        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n".encode("utf-8")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 Nginx 缓冲
        },
    )


@router.post("/api/chat/sessions/{session_id}/messages")
async def post_session_message(
    session_id: str,
    request: Request,
    body: PostSessionMessageBody = Body(...),
):
    """向指定会话发送消息（与前端 sendChatMessage 匹配）"""
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    chat_svc = _get_chat_service(request)

    try:
        session_int = int(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = await chat_svc.get_session_by_id(session_int)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    ai_mode = _normalize_ai_mode(body.ai_mode or session.get("ai_mode"))
    preset_intent = _ai_mode_to_preset_intent(ai_mode)

    # 保存用户消息
    user_msg_data = {
        "session_id": session_int,
        "role": "user",
        "content": content,
        "content_type": "text",
    }
    user_msg_id = await chat_svc.create_message(user_msg_data)

    try:
        assistant_content = await _run_suicide_agent_reply(
            str(session_int), content, preset_intent, attachments=body.attachments
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"消息处理失败：{str(e)}")

    # 保存助手消息
    assistant_msg_data = {
        "session_id": session_int,
        "role": "ai",
        "content": assistant_content,
        "content_type": "text",
        "ai_model": _persisted_llm_model_name(),
        "ai_mode": ai_mode,
    }
    assistant_msg_id = await chat_svc.create_message(assistant_msg_data)

    await chat_svc.update_session(session_int, {"status": "active"}, message_count_delta=2)

    # 获取保存的消息
    all_msgs_result = await chat_svc.get_messages(session_int, page=1, page_size=100)
    all_msgs = all_msgs_result.get("messages", [])
    user_msg = next((m for m in all_msgs if str(m.get("id")) == str(user_msg_id)), None)
    assistant_msg = next((m for m in all_msgs if str(m.get("id")) == str(assistant_msg_id)), None)

    return {
        "success": True,
        "data": _msg_row_to_response(assistant_msg) if assistant_msg else None,
    }


@router.post("/api/chat/quick-questions")
@router.get("/api/chat/quick-questions")
@router.post("/api/chat/recommended-questions")
@router.get("/api/chat/recommended-questions")
async def get_quick_questions(
    request: Request,
    ai_mode: Optional[str] = Query(None, description="AI 模式"),
):
    """获取快捷问题列表（同时支持 /quick-questions 和 /recommended-questions）"""
    chat_svc = _get_chat_service(request)

    # 转换前端中文模式到后端存储的英文模式
    norm_mode = _normalize_ai_mode(ai_mode) if ai_mode else "all"

    questions = await chat_svc.get_recommended_questions(ai_mode=norm_mode, limit=8)

    return {
        "success": True,
        "data": [
            {
                "id": q.get("id"),
                "question": q.get("question"),
                "category": q.get("category"),
                "aiMode": q.get("ai_mode"),
            }
            for q in questions
        ]
    }
