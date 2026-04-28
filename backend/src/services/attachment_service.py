# -*- coding: utf-8 -*-
"""
附件服务 - 简化版
仅保留文件上传功能，文件解析由 LLM 原生处理（MiniMax 多模态支持）。
不再需要 OCR、PDF 解析等依赖库。
"""
import os
import re
import uuid
from pathlib import Path
from typing import Optional, Dict, Any, List


# ============================================================
# 路径配置
# ============================================================
_backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOADS_DIR = os.path.join(_backend_root, "uploads")


# ============================================================
# 工具函数
# ============================================================

def ensure_uploads_dir() -> str:
    """确保 uploads 目录存在，返回路径"""
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    return UPLOADS_DIR


def get_file_ext(filename: str) -> str:
    """获取文件扩展名（小写，不含点）"""
    ext = os.path.splitext(filename)[1]
    return ext.lstrip('.').lower()


def sanitize_filename(filename: str) -> str:
    """清理文件名，去除危险字符"""
    filename = filename.replace('/', '_').replace('\\', '_')
    filename = re.sub(r'[<>:"|?*]', '_', filename)
    return filename


def resolve_attachment_path(saved_name: str) -> Optional[str]:
    """
    根据 saved_name 解析 uploads 目录中的完整文件路径。

    Args:
        saved_name: 后端保存的文件名（唯一标识）

    Returns:
        完整文件路径，如果文件不存在则返回 None
    """
    if not saved_name:
        return None
    path = os.path.join(UPLOADS_DIR, saved_name)
    if os.path.isfile(path):
        return path
    return None


def list_uploaded_files() -> List[Dict[str, Any]]:
    """列出所有已上传的文件"""
    ensure_uploads_dir()
    files = []
    for filename in os.listdir(UPLOADS_DIR):
        filepath = os.path.join(UPLOADS_DIR, filename)
        if os.path.isfile(filepath):
            stat = os.stat(filepath)
            files.append({
                "name": filename,
                "path": filepath,
                "size": stat.st_size,
                "created": stat.st_ctime,
            })
    return files


def delete_uploaded_file(saved_name: str) -> bool:
    """删除指定的已上传文件"""
    path = resolve_attachment_path(saved_name)
    if path and os.path.isfile(path):
        try:
            os.remove(path)
            return True
        except Exception:
            return False
    return False


def get_mime_type(filename: str) -> str:
    """根据文件扩展名返回 MIME 类型"""
    ext = get_file_ext(filename)
    mime_types = {
        "pdf": "application/pdf",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls": "application/vnd.ms-excel",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "txt": "text/plain",
        "md": "text/markdown",
        "json": "application/json",
    }
    return mime_types.get(ext, "application/octet-stream")


def is_allowed_file(filename: str) -> bool:
    """检查文件类型是否允许上传"""
    ext = get_file_ext(filename)
    allowed_extensions = {
        # 图片
        "png", "jpg", "jpeg", "gif", "webp", "bmp",
        # 文档
        "pdf", "doc", "docx",
        # 表格
        "xls", "xlsx",
        # 文本
        "txt", "md",
    }
    return ext in allowed_extensions


# ============================================================
# 附件上下文构建（供聊天使用）
# ============================================================

def extract_attachment(file_path: str) -> Dict[str, Any]:
    """
    从附件路径提取内容（简化版）

    由于不再使用 PDF 解析库，图片和文档直接返回路径供 LLM 原生处理。
    文本文件（txt, md）直接读取内容。

    Args:
        file_path: 文件路径

    Returns:
        附件内容字典
    """
    result = {
        "type": "unknown",
        "content": None,
        "error": None,
    }

    if not os.path.exists(file_path):
        result["error"] = "文件不存在"
        return result

    ext = os.path.splitext(file_path)[1].lower()
    mime = get_mime_type(file_path)

    # 文本文件直接读取
    if ext in [".txt", ".md"]:
        result["type"] = "text"
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                result["content"] = f.read()[:50000]  # 限制长度
        except Exception as e:
            result["error"] = str(e)
    # 图片返回路径
    elif ext in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]:
        result["type"] = "image"
        result["content"] = file_path
    # 文档/PDF 返回路径
    elif ext in [".pdf", ".doc", ".docx", ".xls", ".xlsx"]:
        result["type"] = "document"
        result["content"] = file_path
    else:
        result["error"] = f"不支持的文件类型: {ext}"

    return result


def build_attachment_context(files: List[Dict[str, Any]]) -> str:
    """
    根据附件列表构建上下文字符串

    Args:
        files: 附件列表，每个元素包含 name, path 等信息

    Returns:
        上下文字符串，供 LLM 使用
    """
    if not files:
        return ""

    context_parts = ["\n\n## 上传的附件内容:\n"]

    for i, f in enumerate(files, 1):
        path = f.get("path", "")
        name = f.get("name", os.path.basename(path))

        context_parts.append(f"\n### 附件 {i}: {name}\n")

        # 尝试提取内容
        extracted = extract_attachment(path)

        if extracted["error"]:
            context_parts.append(f"[无法读取: {extracted['error']}]\n")
        elif extracted["type"] == "text" and extracted["content"]:
            # 截断过长内容
            content = extracted["content"]
            if len(content) > 10000:
                content = content[:10000] + f"\n... [内容过长，已截断，完整文件: {path}]"
            context_parts.append(content + "\n")
        elif extracted["type"] == "image":
            context_parts.append(f"[图片文件: {path}]\n")
        else:
            context_parts.append(f"[文档文件: {path}]\n")

    return "".join(context_parts)


# ============================================================
# 文件上传入口（供外部调用）
# ============================================================

def handle_upload(file_obj, original_filename: str) -> Dict[str, Any]:
    """
    处理文件上传（供 FastAPI upload endpoint 调用）

    Args:
        file_obj: FastAPI UploadFile 对象或文件字节
        original_filename: 原始文件名

    Returns:
        上传结果字典 {
            "success": bool,
            "saved_name": str,  # 后端保存的唯一文件名
            "filename": str,   # 原始文件名
            "url": str,        # 访问 URL
            "size": int,       # 文件大小
            "error": str | None
        }
    """
    ensure_uploads_dir()

    # 检查文件类型
    if not is_allowed_file(original_filename):
        return {
            "success": False,
            "saved_name": None,
            "filename": original_filename,
            "url": None,
            "size": 0,
            "error": f"不支持的文件类型。仅支持: png, jpg, pdf, docx, xlsx, txt 等。"
        }

    # 生成唯一文件名（保留原扩展名）
    ext = os.path.splitext(original_filename)[1] or ""
    unique_name = f"{uuid.uuid4().hex}{ext.lower()}"
    safe_filename = sanitize_filename(unique_name)
    save_path = os.path.join(UPLOADS_DIR, safe_filename)

    try:
        # 根据 file_obj 类型处理
        if hasattr(file_obj, 'read'):
            # FastAPI UploadFile 对象
            content = file_obj.read()
        elif isinstance(file_obj, (bytes, bytearray)):
            content = file_obj
        elif hasattr(file_obj, 'file'):
            # 某些框架的封装
            content = file_obj.file.read()
        else:
            return {
                "success": False,
                "saved_name": None,
                "filename": original_filename,
                "url": None,
                "size": 0,
                "error": "无法读取文件内容"
            }

        # 写入文件
        with open(save_path, 'wb') as f:
            f.write(content)

        file_size = os.path.getsize(save_path)

        return {
            "success": True,
            "saved_name": safe_filename,
            "filename": original_filename,
            "url": f"/uploads/{safe_filename}",
            "size": file_size,
            "error": None
        }

    except Exception as e:
        # 清理可能部分写入的文件
        if os.path.exists(save_path):
            try:
                os.remove(save_path)
            except Exception:
                pass
        return {
            "success": False,
            "saved_name": None,
            "filename": original_filename,
            "url": None,
            "size": 0,
            "error": str(e)
        }
