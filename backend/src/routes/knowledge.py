# 知识库路由：RAG 知识检索，从 MySQL 数据库查询
from fastapi import APIRouter, Query, HTTPException, Request, Body, UploadFile, File, Form, Depends
from pydantic import BaseModel
from typing import List, Optional
from fastapi.responses import FileResponse
import os
import json

from src.core.security import get_current_admin_user

router = APIRouter(prefix="", tags=["knowledge"])


# ========================
# Pydantic Models
# ========================
class DocumentQuery(BaseModel):
    query: str
    top_k: int = 5


class DocumentUpdateRequest(BaseModel):
    """更新文档请求模型"""
    title: Optional[str] = None
    topic_id: Optional[int] = None
    sub_topic_id: Optional[int] = None
    keywords: Optional[List[str]] = None
    description: Optional[str] = None


class DocumentCreateRequest(BaseModel):
    """创建文档请求模型"""
    title: str
    topic_id: int
    sub_topic_id: Optional[int] = None
    keywords: Optional[List[str]] = None
    description: Optional[str] = None
    format: str = "md"
    file_path: str = ""


# ========================
# 辅助函数
# ========================
def _get_knowledge_service(request: Request):
    return request.app.state.knowledge_service


def _resolve_knowledge_file_path(file_path: str) -> str:
    """将数据库中的知识库相对路径解析为本地绝对路径。"""
    if not file_path:
        return ""

    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    project_root = os.path.dirname(backend_dir)
    normalized_path = file_path.replace("\\", "/").lstrip("/")

    if normalized_path.startswith("rag-skill/knowledge/"):
        relative_path = normalized_path[len("rag-skill/knowledge/"):]
        return os.path.normpath(
            os.path.join(backend_dir, "SuiAgent-main", "rag-skill", "knowledge", relative_path)
        )

    if "/rag-skill/knowledge/" in normalized_path:
        relative_path = normalized_path.split("/rag-skill/knowledge/")[-1]
        return os.path.normpath(
            os.path.join(backend_dir, "SuiAgent-main", "rag-skill", "knowledge", relative_path)
        )

    if normalized_path.startswith("uploads/"):
        project_upload_path = os.path.normpath(os.path.join(project_root, normalized_path))
        backend_upload_path = os.path.normpath(os.path.join(backend_dir, normalized_path))
        if os.path.exists(project_upload_path):
            return project_upload_path
        if os.path.exists(backend_upload_path):
            return backend_upload_path
        return backend_upload_path

    return os.path.normpath(os.path.join(backend_dir, normalized_path))


def _topic_row_to_response(row: dict) -> dict:
    """将数据库主题行转换为前端期望的格式"""
    return {
        "id": str(row.get("id")),
        "topicId": row.get("id"),
        "topicName": row.get("topic_name"),
        "topicCode": row.get("topic_code"),
        "name": row.get("topic_name"),
        "description": row.get("description") or "",
        "icon": row.get("icon"),
        "color": row.get("color"),
        "documentCount": row.get("document_count", 0),
        "sortOrder": row.get("sort_order", 0),
        "isActive": row.get("is_active", True),
    }


def _doc_row_to_response(row: dict) -> dict:
    """将数据库文档行转换为前端期望的格式"""
    keywords = row.get("keywords", [])
    if isinstance(keywords, str):
        try:
            keywords = json.loads(keywords)
        except Exception:
            keywords = []

    # 处理 topic_name 和 sub_topic_name 来自 JOIN 查询的情况
    topic_name = row.get("topic") or row.get("topic_name") or row.get("topicName") or ""
    sub_topic_name = row.get("sub_topic") or row.get("sub_topic_name") or row.get("subTopicName") or ""

    return {
        "id": str(row.get("id")),
        "topicId": row.get("topic_id"),
        "subTopicId": row.get("sub_topic_id"),
        "title": row.get("title"),
        "description": row.get("description") or row.get("summary") or "",
        "summary": row.get("description") or row.get("summary") or "",
        "keywords": keywords,
        "format": row.get("format"),
        "fileName": row.get("file_name"),
        "filePath": row.get("file_path"),
        "fileSize": row.get("file_size", 0),
        "sizeDisplay": row.get("size_display"),
        "uploadStatus": row.get("upload_status"),
        "progress": row.get("progress", 0),
        "isIndexed": row.get("is_indexed", False),
        "usageCount": row.get("usage_count", 0),
        "uploadedAt": row.get("uploaded_at"),
        "createdAt": row.get("created_at"),
        "ragPath": row.get("rag_path"),
        "topic": {"topicName": topic_name} if topic_name else None,
        "subTopic": {"subTopicName": sub_topic_name} if sub_topic_name else None,
    }


# ========================
# Routes
# ========================
@router.get("/api/knowledge/topics")
async def get_knowledge_topics(request: Request):
    """获取知识库主题分类"""
    knowledge_svc = _get_knowledge_service(request)
    topics = await knowledge_svc.get_topics()
    return {
        "success": True,
        "data": {
            "topics": [_topic_row_to_response(t) for t in topics],
            "total": len(topics)
        }
    }


@router.get("/api/knowledge/topics/{topic_id}")
async def get_topic_detail(topic_id: str, request: Request):
    """获取主题详情及其文档列表"""
    knowledge_svc = _get_knowledge_service(request)

    # 先按 ID 查
    try:
        topic_int = int(topic_id)
    except ValueError:
        topic_int = None

    topics = await knowledge_svc.get_topics()
    topic = None
    for t in topics:
        if str(t.get("id")) == str(topic_id) or t.get("topic_code") == topic_id:
            topic = t
            break

    if not topic:
        raise HTTPException(status_code=404, detail="主题不存在")

    # 获取该主题下的文档
    docs_result = await knowledge_svc.get_documents(
        topic_id=int(topic_id) if topic_id.isdigit() else None,
        page=1,
        page_size=100,
    )
    docs = docs_result.get("documents", [])
    # 过滤 topic_id 匹配
    docs = [d for d in docs if str(d.get("topic_id", "")) == str(topic_id)]

    return {
        "success": True,
        "data": {
            **_topic_row_to_response(topic),
            "documents": [_doc_row_to_response(d) for d in docs],
        }
    }


@router.get("/api/knowledge/sub-topics")
async def get_knowledge_sub_topics(
    request: Request,
    topic_id: Optional[str] = Query(None, description="主题ID"),
):
    """获取知识库子主题分类（与前端 fetchKnowledgeSubTopics 匹配）"""
    knowledge_svc = _get_knowledge_service(request)

    topic_int = None
    if topic_id:
        try:
            topic_int = int(topic_id)
        except ValueError:
            topic_int = None

    sub_topics = await knowledge_svc.get_sub_topics(topic_id=topic_int)

    return {
        "success": True,
        "data": [
            {
                "id": int(st.get("id")) if st.get("id") else st.get("id"),
                "topicId": st.get("topic_id"),
                "subTopicName": st.get("sub_topic_name") or st.get("subTopicName", ""),
                "subTopicCode": st.get("sub_topic_code") or st.get("subTopicCode", ""),
                "description": st.get("description") or "",
                "sortOrder": st.get("sort_order", 0),
            }
            for st in sub_topics
        ]
    }


@router.get("/api/knowledge/documents")
async def get_documents(
    request: Request,
    topic_id: Optional[str] = Query(None, description="主题ID"),
    sub_topic_id: Optional[str] = Query(None, description="子主题ID"),
    keyword: Optional[str] = Query(None, description="关键词搜索"),
    format: Optional[str] = Query(None, description="文档格式"),
    status: Optional[str] = Query(None, description="上传状态"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """获取文档列表"""
    knowledge_svc = _get_knowledge_service(request)

    topic_int = None
    sub_topic_int = None
    if topic_id:
        try:
            topic_int = int(topic_id)
        except ValueError:
            topic_int = None
    if sub_topic_id:
        try:
            sub_topic_int = int(sub_topic_id)
        except ValueError:
            sub_topic_int = None

    result = await knowledge_svc.get_documents(
        topic_id=topic_int,
        sub_topic_id=sub_topic_int,
        keyword=keyword,
        format=format,
        status=status,
        page=page,
        page_size=page_size,
    )

    return {
        "success": True,
        "data": {
            "documents": [_doc_row_to_response(d) for d in result.get("documents", [])],
            "pagination": {
                "total": result.get("total", 0),
                "page": result.get("page", page),
                "page_size": result.get("page_size", page_size),
                "totalPages": (result.get("total", 0) + page_size - 1) // page_size,
            }
        }
    }


@router.delete("/api/knowledge/documents/{doc_id}")
async def delete_document(doc_id: int, request: Request, current_user: dict = Depends(get_current_admin_user)):
    """删除知识文档（仅管理员，软删除）"""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    knowledge_svc = _get_knowledge_service(request)

    success = await knowledge_svc.delete_document(doc_id)

    if not success:
        raise HTTPException(status_code=404, detail="文档不存在或已删除")

    return {"success": True, "message": "文档已删除"}


@router.get("/api/knowledge/documents/{doc_id}/download")
async def download_document(doc_id: str, request: Request):
    """下载文档文件（支持字符串 ID）"""
    knowledge_svc = _get_knowledge_service(request)

    resolved_id = await knowledge_svc.resolve_document_id(doc_id)
    if resolved_id is None:
        raise HTTPException(status_code=404, detail="文档不存在")

    doc = await knowledge_svc.get_document_by_id(resolved_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    file_path = doc.get("file_path", "")
    if not file_path:
        raise HTTPException(status_code=404, detail="文件路径不存在")

    actual_path = _resolve_knowledge_file_path(file_path)

    if not os.path.exists(actual_path):
        raise HTTPException(status_code=404, detail=f"文件不存在或已被删除: {actual_path}")

    # 根据文件格式设置正确的 MIME 类型和 Content-Disposition
    ext = os.path.splitext(actual_path)[1].lower()
    mime_types = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
    }
    media_type = mime_types.get(ext, "application/octet-stream")

    # PDF 和图片使用 inline 模式直接预览，其他类型默认下载
    content_disposition_type = "inline" if ext in (".pdf", ".png", ".jpg", ".jpeg", ".gif") else "attachment"

    return FileResponse(
        path=actual_path,
        filename=doc.get("file_name", "document"),
        media_type=media_type,
        content_disposition_type=content_disposition_type,
    )


@router.get("/api/knowledge/documents/{doc_id}/preview-stream")
async def get_document_preview_stream(
    doc_id: str,
    request: Request,
):
    """
    获取文档的流式预览数据（用于 PDF / DOCX 渲染）
    返回原始文件二进制流，前端根据格式决定渲染方式
    """
    knowledge_svc = _get_knowledge_service(request)

    # 支持字符串 ID（标题/文件名）
    resolved_id = await knowledge_svc.resolve_document_id(doc_id)
    if resolved_id is None:
        raise HTTPException(status_code=404, detail="文档不存在")

    doc = await knowledge_svc.get_document_by_id(resolved_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    file_path = doc.get("file_path", "")
    if not file_path:
        raise HTTPException(status_code=404, detail="文件路径不存在")

    actual_path = _resolve_knowledge_file_path(file_path)

    if not os.path.exists(actual_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    ext = os.path.splitext(actual_path)[1].lower()
    media_types = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
    }
    media_type = media_types.get(ext)
    if not media_type:
        raise HTTPException(status_code=400, detail="当前格式不支持流式预览")

    return FileResponse(
        path=actual_path,
        filename=doc.get("file_name", "document"),
        media_type=media_type,
        content_disposition_type="inline",
    )


@router.get("/api/knowledge/documents/{doc_id}/base64")
async def get_document_base64(doc_id: str, request: Request):
    """获取文档的 base64 编码（用于前端预览，支持字符串 ID）"""
    import base64

    knowledge_svc = _get_knowledge_service(request)

    resolved_id = await knowledge_svc.resolve_document_id(doc_id)
    if resolved_id is None:
        raise HTTPException(status_code=404, detail="文档不存在")

    doc = await knowledge_svc.get_document_by_id(resolved_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    file_path = doc.get("file_path", "")
    if not file_path:
        raise HTTPException(status_code=404, detail="文件路径不存在")

    actual_path = _resolve_knowledge_file_path(file_path)

    if not os.path.exists(actual_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    ext = os.path.splitext(actual_path)[1].lower()
    mime_types = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    media_type = mime_types.get(ext, "application/octet-stream")

    # 读取文件并转为 base64
    with open(actual_path, "rb") as f:
        file_data = f.read()
    base64_data = base64.b64encode(file_data).decode("utf-8")
    data_url = f"data:{media_type};base64,{base64_data}"

    return {
        "success": True,
        "data": {
            "base64": base64_data,
            "dataUrl": data_url,
            "mediaType": media_type,
            "fileName": doc.get("file_name", "document"),
            "size": len(file_data),
        }
    }


@router.get("/api/knowledge/documents/{doc_id}/preview")
async def get_document_preview(
    doc_id: str,
    request: Request,
    max_length: int = Query(500, ge=100, le=5000, description="预览最大字符数"),
):
    """获取文档预览内容（前 max_length 字符，支持字符串 ID）"""
    knowledge_svc = _get_knowledge_service(request)

    # 支持字符串 ID（标题/文件名）
    resolved_id = await knowledge_svc.resolve_document_id(doc_id)
    if resolved_id is None:
        raise HTTPException(status_code=404, detail="文档不存在")

    result = await knowledge_svc.get_document_preview(resolved_id, max_length)

    if result is None:
        raise HTTPException(status_code=404, detail="文档不存在")

    return {"success": True, "data": result}


@router.get("/api/knowledge/documents/{doc_id}")
async def get_document_detail(doc_id: str, request: Request):
    """获取文档详情（支持整数 ID 或标题/文件名字符串）"""
    knowledge_svc = _get_knowledge_service(request)

    # 优先按整数 ID 查找
    doc = None
    try:
        doc = await knowledge_svc.get_document_by_id(int(doc_id))
    except ValueError:
        pass

    # 如果不是有效整数 ID，或 ID 查不到，按标题/文件名查找
    if not doc:
        doc = await knowledge_svc.get_document_by_title(doc_id)

    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    return {"success": True, "data": _doc_row_to_response(doc)}


@router.post("/api/knowledge/search")
async def search_documents(query: DocumentQuery = Body(...), request: Request = None):
    """RAG 知识检索（向量搜索 + 关键词匹配）"""
    knowledge_svc = _get_knowledge_service(request)

    results = await knowledge_svc.search_documents(query.query, query.top_k)

    return {
        "success": True,
        "data": {
            "query": query.query,
            "results": [_doc_row_to_response(r) for r in results],
            "total": len(results)
        }
    }


@router.get("/api/knowledge/related")
async def get_related_knowledge(
    request: Request,
    user_hash: Optional[str] = Query(None, description="用户哈希"),
    risk_level: Optional[str] = Query(None, description="风险等级"),
):
    """根据用户风险等级推荐相关知识"""
    knowledge_svc = _get_knowledge_service(request)

    # 从知识主题中推荐
    topics = await knowledge_svc.get_topics()
    topic_map = {t.get("topic_code", ""): t for t in topics}

    recommendations = []

    if risk_level == "high":
        # 高风险：推荐自杀预防、危机干预相关
        for code in ["suicide_self_harm", "crisis_intervention", "depression"]:
            if code in topic_map:
                recommendations.append(_topic_row_to_response(topic_map[code]))
    elif risk_level == "medium":
        # 中风险：推荐抑郁、焦虑相关
        for code in ["depression", "anxiety", "emotion"]:
            if code in topic_map:
                recommendations.append(_topic_row_to_response(topic_map[code]))
    else:
        # 低风险：推荐心理健康基础
        for code in ["emotion", "sleep_physiology", "scale_screening"]:
            if code in topic_map:
                recommendations.append(_topic_row_to_response(topic_map[code]))

    # 同时推荐一些文档
    docs_result = await knowledge_svc.get_documents(page=1, page_size=6)
    docs = docs_result.get("documents", [])
    doc_recommendations = [_doc_row_to_response(d) for d in docs]

    return {
        "success": True,
        "data": {
            "risk_level": risk_level or "unknown",
            "recommendations": recommendations,
            "documentRecommendations": doc_recommendations,
        }
    }


@router.get("/api/knowledge/keywords")
async def get_knowledge_keywords(
    request: Request,
    topic_id: Optional[str] = Query(None, description="主题ID"),
    is_hot: bool = Query(False, description="是否仅返回热门关键词"),
):
    """获取知识库关键词列表（从文档关键词聚合）"""
    knowledge_svc = _get_knowledge_service(request)

    topic_int = None
    if topic_id:
        try:
            topic_int = int(topic_id)
        except ValueError:
            topic_int = None

    keywords = await knowledge_svc.get_keywords(topic_id=topic_int, is_hot=is_hot)

    return {
        "success": True,
        "data": [
            {
                "id": idx + 1,
                "keyword": kw.get("keyword", ""),
                "category": "",
                "colorClass": "bg-orange-100 text-orange-700",
                "isHot": is_hot or (kw.get("weight") or 1) > 5,
                "usageCount": int(kw.get("weight") or 1),
                "sortOrder": idx,
                "isActive": True,
            }
            for idx, kw in enumerate(keywords)
        ],
        "total": len(keywords),
    }


@router.post("/api/upload/knowledge")
async def upload_knowledge_document(
    request: Request,
    file: UploadFile = File(..., description="知识文档文件"),
    title: str = Form(..., description="文档标题"),
    topic_id: int = Form(..., description="主题 ID"),
    summary: Optional[str] = Form(None, description="文档摘要"),
    sub_topic_id: Optional[int] = Form(None, description="子主题 ID"),
    keywords: Optional[str] = Form(None, description="关键词（逗号分隔）"),
    format: Optional[str] = Form(None, description="文档格式"),
    current_user: dict = Depends(get_current_admin_user),
):
    """上传知识文档（支持 txt/md/pdf/docx），文件存储到本地，文档信息存入 MySQL"""
    MAX_SIZE = 10 * 1024 * 1024  # 10MB

    knowledge_svc = _get_knowledge_service(request)

    # 读取文件内容
    content_bytes = await file.read()
    if len(content_bytes) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="文件大小超过 10MB 限制")

    # 推断文件格式
    ext = os.path.splitext(file.filename or "unknown")[1].lower().lstrip(".")
    format_map = {"txt": "txt", "md": "md", "markdown": "md", "pdf": "pdf", "docx": "docx", "doc": "docx"}
    doc_format = format or format_map.get(ext, "txt")

    # 统一落到 backend/uploads/knowledge，避免上传与下载解析目录不一致
    upload_base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    upload_dir = os.path.join(upload_base, "uploads", "knowledge")
    os.makedirs(upload_dir, exist_ok=True)

    # 生成安全文件名（避免冲突）
    import uuid, time as time_module
    safe_filename = f"{int(time_module.time())}_{uuid.uuid4().hex[:8]}_{file.filename or 'document.' + ext}"
    file_path = os.path.join(upload_dir, safe_filename)
    relative_path = f"/uploads/knowledge/{safe_filename}"

    # 提取文本内容（用于预览和索引）
    content_text = ""
    if doc_format in ("txt", "md"):
        try:
            content_text = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            try:
                content_text = content_bytes.decode("gbk", errors="replace")
            except Exception:
                raise HTTPException(status_code=400, detail="文件编码不支持，请上传 UTF-8 编码的文件")
    elif doc_format == "pdf":
        try:
            import io
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(content_bytes))
            text_parts = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            content_text = "\n".join(text_parts)
        except ImportError:
            content_text = f"[PDF 文档，大小 {len(content_bytes)} 字节]"
        except Exception as e:
            content_text = f"[PDF 文档预览失败: {str(e)}]"
    elif doc_format == "docx":
        try:
            import io
            from docx import Document as DocxDocument
            doc = DocxDocument(io.BytesIO(content_bytes))
            text_parts = []
            for para in doc.paragraphs:
                if para.text.strip():
                    text_parts.append(para.text)
            content_text = "\n".join(text_parts)
        except ImportError:
            content_text = f"[DOCX 文档，大小 {len(content_bytes)} 字节]"
        except Exception as e:
            content_text = f"[DOCX 文档预览失败: {str(e)}]"

    # 处理关键词
    processed_keywords = []
    if keywords:
        # 支持逗号分隔的关键词
        processed_keywords = [kw.strip() for kw in keywords.split(",") if kw.strip()]
    else:
        # 从内容中自动提取关键词（前 20 个词）
        import re
        words = re.findall(r"[\u4e00-\u9fa5a-zA-Z0-9]+", content_text)
        word_freq: dict = {}
        stop_words = {"的", "了", "和", "是", "在", "我", "有", "个", "上", "也", "就", "不", "人", "都", "一", "中", "大", "为", "与", "或", "the", "a", "an", "is", "are", "was", "were", "and", "or", "but", "in", "on", "at", "to", "for"}
        for w in words:
            w_lower = w.lower()
            if len(w_lower) >= 2 and w_lower not in stop_words:
                word_freq[w_lower] = word_freq.get(w_lower, 0) + 1
        # 按频率排序，取前 20 个
        sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
        processed_keywords = [w for w, _ in sorted_words[:20]]

    # 存储文件到本地
    try:
        with open(file_path, "wb") as f:
            f.write(content_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")

    # 计算文件大小显示
    size_display = f"{len(content_bytes) / 1024:.1f} KB" if len(content_bytes) < 1024 * 1024 else f"{len(content_bytes) / 1024 / 1024:.2f} MB"

    result = await knowledge_svc.upload_document(
        title=title,
        content=content_text,
        topic_id=topic_id,
        sub_topic_id=sub_topic_id,
        summary=summary or "",
        keywords=processed_keywords,
        doc_format=doc_format,
        file_name=file.filename or "unknown",
        file_path=relative_path,
        file_size=len(content_bytes),
        size_display=size_display,
    )

    return {"success": True, "message": "上传成功", "data": result}


# ========================
# 管理员 API
# ========================

@router.put("/api/knowledge/documents/{doc_id}")
async def update_document(
    doc_id: int,
    body: DocumentUpdateRequest,
    request: Request,
    current_user: dict = Depends(get_current_admin_user),
):
    """更新文档信息（仅管理员）"""
    knowledge_svc = _get_knowledge_service(request)

    result = await knowledge_svc.update_document(
        doc_id=doc_id,
        title=body.title,
        topic_id=body.topic_id,
        sub_topic_id=body.sub_topic_id,
        keywords=body.keywords,
        description=body.description,
    )

    if not result:
        raise HTTPException(status_code=404, detail="文档不存在")

    return {"success": True, "message": "文档更新成功", "data": _doc_row_to_response(result)}


@router.post("/api/knowledge/documents")
async def create_document(
    body: DocumentCreateRequest,
    request: Request,
    current_user: dict = Depends(get_current_admin_user),
):
    """创建文档记录（仅管理员，手动创建不上传文件）"""
    knowledge_svc = _get_knowledge_service(request)

    result = await knowledge_svc.create_document_record(
        title=body.title,
        topic_id=body.topic_id,
        sub_topic_id=body.sub_topic_id,
        keywords=body.keywords,
        description=body.description,
        doc_format=body.format,
        file_path=body.file_path,
        file_name=body.title,
        uploaded_by=current_user.get("username", ""),
    )

    return {"success": True, "message": "文档创建成功", "data": result}


@router.post("/api/knowledge/import-from-directory")
async def import_documents_from_directory(
    request: Request,
    dry_run: bool = Query(False, description="仅扫描不写入数据库"),
):
    """从本地 rag-skill/knowledge 同步知识库元信息到数据库"""
    knowledge_svc = _get_knowledge_service(request)

    knowledge_root = knowledge_svc._knowledge_root()
    if not knowledge_root.exists():
        return {
            "success": False,
            "message": f"知识库目录不存在: {knowledge_root}",
            "data": {
                "imported": 0,
                "topics": 0,
                "sub_topics": 0,
                "keywords": 0,
                "documents": [],
            },
        }

    if dry_run:
        if knowledge_svc._catalog_path().exists():
            bundle = knowledge_svc._build_local_bundle_from_catalog(knowledge_root)
        else:
            bundle = knowledge_svc._build_local_bundle_from_scan(knowledge_root)
        results = {
            "success": True,
            "message": "知识库扫描完成（未写入数据库）",
            "imported": len(bundle["documents"]),
            "topics": len(bundle["topics"]),
            "sub_topics": len(bundle["sub_topics"]),
            "keywords": len(bundle["keywords"]),
            "documents": bundle["documents"],
        }
    else:
        results = await knowledge_svc.sync_local_knowledge_to_db(force=True)

    return {
        "success": bool(results.get("success", True)),
        "message": results.get("message") or (
            f"同步完成: 主题 {results.get('topics', 0)} / 子主题 {results.get('sub_topics', 0)} / "
            f"文档 {results.get('imported', 0)} / 关键词 {results.get('keywords', 0)}"
        ),
        "data": results,
    }
