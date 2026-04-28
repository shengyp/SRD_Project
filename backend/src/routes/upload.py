# -*- coding: utf-8 -*-
"""
聊天附件上传路由
支持上传图片和文档到 backend/uploads 目录
"""
import os
import re
import uuid
import shutil
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/chat", tags=["chat-upload"])

# 上传目录（backend/uploads）
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOADS_DIR = os.path.join(_BACKEND_ROOT, "uploads")

# 允许的文件类型
ALLOWED_EXTENSIONS = {
    'pdf', 'docx', 'doc', 'txt', 'md',
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
    'xlsx', 'xls', 'xlsm',
}

# 单文件最大 50MB
MAX_FILE_SIZE = 50 * 1024 * 1024

# 创建上传目录
os.makedirs(UPLOADS_DIR, exist_ok=True)


def get_file_ext(filename: str) -> str:
    """获取文件扩展名（小写，不含点）"""
    ext = os.path.splitext(filename)[1]
    return ext.lstrip('.').lower()


def sanitize_filename(filename: str) -> str:
    """清理文件名，去除危险字符"""
    filename = filename.replace('/', '_').replace('\\', '_')
    filename = re.sub(r'[<>:"|?*]', '_', filename)
    # 限制长度
    if len(filename) > 200:
        name, ext = os.path.splitext(filename)
        filename = name[:200 - len(ext)] + ext
    return filename


def guess_content_type(ext: str) -> str:
    """根据扩展名猜测 MIME 类型"""
    mime_map = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel',
        'xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
    }
    return mime_map.get(ext, 'application/octet-stream')


@router.post("/upload")
async def upload_attachment(
    file: UploadFile = File(..., description="上传的文件（图片/PDF/Word/TXT/Markdown/Excel）")
):
    """
    上传单个附件到 backend/uploads 目录

    支持类型: PDF, DOCX, DOC, TXT, MD, JPG, JPEG, PNG, GIF, WEBP, BMP, XLSX, XLS

    返回:
    {
        "success": true,
        "data": {
            "id": "uuid",
            "filename": "原文件名",
            "saved_name": "保存的文件名（uuid前缀）",
            "url": "/uploads/保存的文件名",
            "file_type": "pdf/docx/image/...",
            "size": 12345,
        }
    }
    """
    # 检查扩展名
    ext = get_file_ext(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: .{ext}，仅支持 {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # 生成唯一文件名
    original_name = sanitize_filename(file.filename or f"unknown.{ext}")
    unique_id = str(uuid.uuid4())[:8]
    saved_name = f"{unique_id}_{original_name}"
    saved_path = os.path.join(UPLOADS_DIR, saved_name)

    # 写入文件
    try:
        with open(saved_path, 'wb') as buffer:
            # 分块写入，避免大文件内存问题
            chunk_size = 1024 * 1024  # 1MB
            written = 0
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_FILE_SIZE:
                    buffer.close()
                    os.remove(saved_path)
                    raise HTTPException(status_code=413, detail=f"文件大小超过 {MAX_FILE_SIZE // (1024*1024)}MB 限制")
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")

    file_size = os.path.getsize(saved_path)

    return {
        "success": True,
        "data": {
            "id": unique_id,
            "filename": original_name,
            "saved_name": saved_name,
            "url": f"/uploads/{saved_name}",
            "file_type": ext,
            "size": file_size,
            "content_type": guess_content_type(ext),
        }
    }


@router.post("/upload-multiple")
async def upload_multiple_attachments(
    files: List[UploadFile] = File(..., description="批量上传多个文件")
):
    """
    批量上传多个附件

    返回:
    {
        "success": true,
        "data": {
            "uploaded": [/* 每个文件的上传结果 */],
            "failed": [/* 失败文件信息 */],
        }
    }
    """
    uploaded = []
    failed = []

    for file in files:
        ext = get_file_ext(file.filename or "")
        if ext not in ALLOWED_EXTENSIONS:
            failed.append({
                "filename": file.filename,
                "error": f"不支持的文件类型: .{ext}"
            })
            continue

        original_name = sanitize_filename(file.filename or f"unknown.{ext}")
        unique_id = str(uuid.uuid4())[:8]
        saved_name = f"{unique_id}_{original_name}"
        saved_path = os.path.join(UPLOADS_DIR, saved_name)

        try:
            with open(saved_path, 'wb') as buffer:
                chunk_size = 1024 * 1024
                written = 0
                while True:
                    chunk = await file.read(chunk_size)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_FILE_SIZE:
                        buffer.close()
                        os.remove(saved_path)
                        failed.append({
                            "filename": file.filename,
                            "error": f"文件大小超过 {MAX_FILE_SIZE // (1024*1024)}MB 限制"
                        })
                        break
                    buffer.write(chunk)
                else:
                    file_size = os.path.getsize(saved_path)
                    uploaded.append({
                        "id": unique_id,
                        "filename": original_name,
                        "saved_name": saved_name,
                        "url": f"/uploads/{saved_name}",
                        "file_type": ext,
                        "size": file_size,
                        "content_type": guess_content_type(ext),
                    })
                    continue
        except Exception as e:
            failed.append({
                "filename": file.filename,
                "error": str(e)
            })
        # 如果 break 了需要跳过 continue
        if not (ext in ALLOWED_EXTENSIONS):
            continue

    return {
        "success": True,
        "data": {
            "uploaded": uploaded,
            "failed": failed,
        }
    }


@router.delete("/files/{saved_name}")
async def delete_attachment(saved_name: str):
    """删除已上传的附件"""
    # 防止路径遍历攻击
    if '..' in saved_name or '/' in saved_name or '\\' in saved_name:
        raise HTTPException(status_code=400, detail="无效的文件名")

    file_path = os.path.join(UPLOADS_DIR, saved_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    try:
        os.remove(file_path)
        return {"success": True, "message": "文件已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@router.get("/files")
async def list_uploads():
    """列出 uploads 目录下的所有文件"""
    if not os.path.exists(UPLOADS_DIR):
        return {"success": True, "data": []}

    files = []
    for fname in os.listdir(UPLOADS_DIR):
        fpath = os.path.join(UPLOADS_DIR, fname)
        if os.path.isfile(fpath):
            ext = get_file_ext(fname)
            files.append({
                "saved_name": fname,
                "file_type": ext,
                "size": os.path.getsize(fpath),
                "url": f"/uploads/{fname}",
            })

    return {"success": True, "data": files}
