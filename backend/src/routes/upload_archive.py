# -*- coding: utf-8 -*-
"""
心理档案数据导入路由
支持上传 CSV 文件到 uploads/archives/ 目录，并注册到系统
"""
import os
import csv
import uuid
import json
import hashlib
import re
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/upload", tags=["upload-archive"])

# 上传目录（backend/uploads/archives/）
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCHIVES_DIR = os.path.join(_BACKEND_ROOT, "uploads", "archives")

# 允许的文件类型
ALLOWED_EXTENSIONS = {'csv', 'txt', 'xlsx', 'xls'}

# 单文件最大 50MB
MAX_FILE_SIZE = 50 * 1024 * 1024

# 确保目录存在
os.makedirs(ARCHIVES_DIR, exist_ok=True)


def _get_mysql_pool(request: Request):
    """获取 MySQL 连接池"""
    if not hasattr(request.app.state, "mysql_db") or request.app.state.mysql_db is None:
        raise HTTPException(status_code=503, detail="数据库连接不可用")
    return request.app.state.mysql_db


@dataclass
class ParsedArchiveRecord:
    """解析后的单条档案记录"""
    user_id: str
    posts: List[str]
    label: int
    raw_row: dict


@dataclass
class ImportResult:
    """导入结果"""
    success: bool
    dataset_key: str
    file_path: str
    total_users: int
    total_posts: int
    risk_distribution: dict = field(default_factory=dict)
    error: Optional[str] = None


def get_file_ext(filename: str) -> str:
    """获取文件扩展名（小写，不含点）"""
    ext = os.path.splitext(filename)[1]
    return ext.lstrip('.').lower()


def sanitize_filename(filename: str) -> str:
    """清理文件名，去除危险字符"""
    import re
    filename = filename.replace('/', '_').replace('\\', '_')
    filename = re.sub(r'[<>:"|?*]', '_', filename)
    if len(filename) > 200:
        name, ext = os.path.splitext(filename)
        filename = name[:200 - len(ext)] + ext
    return filename


def parse_csv_file(file_path: str) -> Tuple[List[ParsedArchiveRecord], Dict[str, Any]]:
    """解析 CSV 文件，返回解析后的记录和元信息
    
    支持格式：
    - Reddit 格式：User, Post, Label
    - 带 emoji 格式：User, Post, Label, EmojiSequence
    
    Returns:
        (records, stats): 记录列表和统计信息
    """
    records: List[ParsedArchiveRecord] = []
    user_posts: dict = {}
    user_labels: dict = {}
    user_raw: dict = {}
    columns = []
    
    with open(file_path, 'r', encoding='utf-8-sig', errors='replace') as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames or []
        
        for row_index, row in enumerate(reader, start=1):
            # 规范化字段名
            row = {k.strip().lower(): v for k, v in row.items()}
            
            # 获取用户 ID
            user_id = row.get('user', row.get('user_id', ''))
            if not user_id:
                user_id = f'row_{row_index}'
            user_id = str(user_id).strip()
            
            # 获取帖子内容（支持多种字段名）
            post_content = row.get(
                'post',
                row.get('post_sequence', row.get('content', ''))
            )
            
            # 获取标签/风险值
            label_str = row.get('label', row.get('suicide_risk', '0'))
            try:
                label = int(float(label_str))
            except (ValueError, TypeError):
                label = 0
            
            # 解析帖子（可能是逗号分隔的多个帖子）
            posts = _parse_posts(post_content)
            
            if user_id not in user_posts:
                user_posts[user_id] = []
                user_labels[user_id] = label
                user_raw[user_id] = row
            user_posts[user_id].extend(posts)
            
            # 更新风险等级（取最高）
            if label > user_labels.get(user_id, 0):
                user_labels[user_id] = label
    
    # 转换为 ParsedArchiveRecord
    for user_id, posts in user_posts.items():
        records.append(ParsedArchiveRecord(
            user_id=user_id,
            posts=posts,
            label=user_labels[user_id],
            raw_row=user_raw[user_id]
        ))
    
    # 计算统计信息
    total_posts = sum(len(r.posts) for r in records)
    risk_dist = {}
    for r in records:
        label_name = _label_to_name(r.label)
        risk_dist[label_name] = risk_dist.get(label_name, 0) + 1
    
    stats = {
        'total_users': len(records),
        'total_posts': total_posts,
        'risk_distribution': risk_dist,
        'columns': columns,
    }
    
    return records, stats


def _parse_posts(post_str: str) -> List[str]:
    """解析贴文内容"""
    if not post_str:
        return []
    post_str = post_str.strip()
    
    # 检查是否是 Python list 格式 [...]
    if post_str.startswith('[') and post_str.endswith(']'):
        try:
            # 先处理转义引号：将 \" 替换为 "
            cleaned = post_str.replace('\\"', '"')
            import ast
            items = ast.literal_eval(cleaned)
            if isinstance(items, list):
                return [str(i).strip() for i in items if str(i).strip()]
        except Exception:
            pass
    
    # 检查换行分隔（weibo）
    if '\n' in post_str:
        parts = [p.strip() for p in post_str.split('\n') if p.strip()]
        if len(parts) > 1:
            return parts

    # 检查逗号分隔
    if ',' in post_str and not post_str.startswith('['):
        # 避免把普通长文本中的英文逗号切碎，仅在明显短片段结构下分割
        parts = [p.strip() for p in post_str.split(',') if p.strip()]
        if len(parts) > 1 and all(len(part) < 200 for part in parts):
            return parts
    
    return [post_str]


def _label_to_name(label: int) -> str:
    """标签转换为中文名称"""
    label_map = {
        0: '无风险',
        1: '极低风险',
        2: '低风险',
        3: '中风险',
        4: '高风险',
    }
    return label_map.get(label, f'风险{label}')


def _build_risk_schema(data_source: str, records: List[ParsedArchiveRecord]) -> Tuple[Dict[str, str], Dict[str, str], int]:
    """根据数据源和标签范围生成细粒度/粗粒度风险映射。"""
    max_label = max((r.label for r in records), default=0)
    source = (data_source or "").lower()

    if source in {"sigir", "weibo"} or max_label <= 1:
        fine_labels = {"0": "无风险", "1": "高风险"}
        coarse_risk_mapping = {"0": "low", "1": "high"}
        class_count = 2
    else:
        fine_labels = {"0": "无风险", "1": "极低风险", "2": "低风险", "3": "中风险", "4": "高风险"}
        coarse_risk_mapping = {"0": "low", "1": "low", "2": "low", "3": "medium", "4": "high"}
        class_count = 5

    return fine_labels, coarse_risk_mapping, class_count


def _detect_language(data_source: str) -> str:
    return "zh" if (data_source or "").lower() == "weibo" else "en"


def _detect_has_timestamp(records: List[ParsedArchiveRecord]) -> bool:
    if not records:
        return False
    sample_values = [str(r.raw_row.get("created_utc", "")).strip() for r in records[:5]]
    return any("timestamp(" in value.lower() or re.search(r"\d{4}-\d{2}-\d{2}", value) for value in sample_values if value)


def _detect_has_emojis(file_path: str, data_source: str) -> bool:
    source = (data_source or "").lower()
    builtin_pairs = {
        "reddit": Path(_BACKEND_ROOT).parent / "datasets" / "reddit" / "reddit_500_emoji_batch.csv",
        "bigdata": Path(_BACKEND_ROOT).parent / "datasets" / "bigdata" / "bigdata_emoji_batch.csv",
        "sigir": Path(_BACKEND_ROOT).parent / "datasets" / "sigir" / "sigir_emojis.csv",
        "weibo": Path(_BACKEND_ROOT).parent / "datasets" / "weibo" / "weibo_1000_emoji_batch.csv",
    }
    if source in builtin_pairs:
        return builtin_pairs[source].exists()
    return False


def generate_dataset_key(filename: str) -> str:
    """根据文件名生成数据集标识"""
    # 移除扩展名和特殊字符
    name = os.path.splitext(filename)[0]
    name = ''.join(c if c.isalnum() else '_' for c in name)
    # 添加时间戳后缀避免重复
    ts = hashlib.md5(str(uuid.uuid4()).encode()).hexdigest()[:6]
    return f"custom_{name}_{ts}"


@router.post("/archive")
async def upload_archive(
    request: Request,
    file: UploadFile = File(..., description="上传的档案数据文件（CSV/TXT）"),
    data_source: str = Form("custom", description="数据来源标识"),
):
    """
    上传心理档案数据文件并解析
    
    支持格式：
    - Reddit 格式：User, Post, Label
    - 自定义格式：user_id, posts, label
    
    返回:
    {
        "success": true,
        "data": {
            "datasetKey": "custom_reddit_xxx",
            "filePath": "uploads/archives/xxx.csv",
            "totalUsers": 500,
            "totalPosts": 5000,
            "riskDistribution": {"无风险": 100, "高风险": 50, ...},
            "preview": [...]  # 前10条预览数据
        }
    }
    """
    # 检查文件类型
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
    saved_path = os.path.join(ARCHIVES_DIR, saved_name)
    
    # 写入文件
    try:
        with open(saved_path, 'wb') as buffer:
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
                    raise HTTPException(
                        status_code=413,
                        detail=f"文件大小超过 {MAX_FILE_SIZE // (1024*1024)}MB 限制"
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")
    
    # 解析 CSV 文件
    try:
        records, stats = parse_csv_file(saved_path)
    except Exception as e:
        # 清理已保存的文件
        if os.path.exists(saved_path):
            os.remove(saved_path)
        raise HTTPException(status_code=400, detail=f"CSV 文件解析失败: {str(e)}")
    
    if not records:
        if os.path.exists(saved_path):
            os.remove(saved_path)
        raise HTTPException(status_code=400, detail="文件中没有有效数据")
    
    # 生成数据集标识
    dataset_key = generate_dataset_key(original_name)

    # 生成预览数据（显示全部数据以便检查）
    preview = []
    for r in records:
        preview.append({
            'userId': r.user_id,
            'postCount': len(r.posts),
            'riskLabel': _label_to_name(r.label),
            'riskValue': r.label,
            'firstPost': r.posts[0][:50] + '...' if r.posts and len(r.posts[0]) > 50 else (r.posts[0] if r.posts else ''),
        })
    
    return {
        "success": True,
        "data": {
            "datasetKey": dataset_key,
            "fileName": original_name,
            "savedName": saved_name,
            "filePath": f"/uploads/archives/{saved_name}",
            "totalUsers": stats['total_users'],
            "totalPosts": stats['total_posts'],
            "riskDistribution": stats['risk_distribution'],
            "columns": stats['columns'],
            "preview": preview,
            "uploadedAt": __import__('datetime').datetime.now().isoformat(),
        }
    }


@router.post("/archive/confirm")
async def confirm_archive_import(
    request: Request,
    import_data: dict,
):
    """
    确认导入档案数据
    
    请求体:
    {
        "datasetKey": "custom_reddit_xxx",
        "filePath": "uploads/archives/xxx.csv",
        "dataSource": "reddit",
        "acceptedRecords": ["user1", "user2", ...],  # 可选，指定接受的记录
        "isManualAnnotation": false
    }
    """
    dataset_key = import_data.get('datasetKey')
    file_path = import_data.get('filePath')
    data_source = import_data.get('dataSource', 'reddit')
    accepted_records = import_data.get('acceptedRecords', [])
    is_manual_annotation = import_data.get('isManualAnnotation', False)
    
    if not dataset_key or not file_path:
        raise HTTPException(status_code=400, detail="缺少必要参数")
    
    # 构建完整路径
    if file_path.startswith('/'):
        full_path = os.path.join(_BACKEND_ROOT, file_path.lstrip('/'))
    else:
        full_path = os.path.join(ARCHIVES_DIR, file_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="文件不存在，请重新上传")
    
    # 解析文件获取完整数据
    records, stats = parse_csv_file(full_path)
    
    # 获取 MySQL 连接池
    mysql_pool = _get_mysql_pool(request)
    
    # 生成批次编号
    batch_code = f"BATCH_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    # 计算细粒度风险分布
    fine_risk_dist = {}
    for r in records:
        label_name = _label_to_name(r.label)
        fine_risk_dist[label_name] = fine_risk_dist.get(label_name, 0) + 1
    
    # 计算粗粒度风险分布
    coarse_risk_dist = {"low": 0, "medium": 0, "high": 0}
    for r in records:
        if r.label >= 3:
            coarse_risk_dist["high"] += 1
        elif r.label >= 1:
            coarse_risk_dist["medium"] += 1
        else:
            coarse_risk_dist["low"] += 1
    
    fine_labels, coarse_risk_mapping, class_count = _build_risk_schema(data_source, records)
    has_timestamp = _detect_has_timestamp(records)
    has_emojis = _detect_has_emojis(full_path, data_source)
    
    # 过滤要导入的记录
    if accepted_records:
        records_to_import = [r for r in records if r.user_id in accepted_records]
    else:
        records_to_import = records
    
    try:
        async with mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                
                # 0. 确保 dataset_profile 中存在该数据集记录（注册数据集）
                display_name = os.path.splitext(os.path.basename(full_path))[0]
                await cursor.execute("""
                    INSERT INTO dataset_profile (
                        dataset_key, display_name, description, 
                        total_users, total_posts, 
                        fine_labels, class_count,
                        coarse_risk_mapping, 
                        language, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        display_name = VALUES(display_name),
                        total_users = VALUES(total_users),
                        total_posts = VALUES(total_posts),
                        fine_labels = VALUES(fine_labels),
                        class_count = VALUES(class_count),
                        coarse_risk_mapping = VALUES(coarse_risk_mapping),
                        updated_at = VALUES(updated_at)
                """, (
                    dataset_key,
                    display_name,
                    f"导入自文件: {os.path.basename(full_path)}",
                    stats['total_users'],
                    stats['total_posts'],
                    json.dumps(fine_labels, ensure_ascii=False),
                    class_count,
                    json.dumps(coarse_risk_mapping, ensure_ascii=False),
                    _detect_language(data_source),
                    datetime.now(),
                    datetime.now()
                ))
                
                # 1. 创建导入批次记录
                await cursor.execute("""
                    INSERT INTO archive_import_batch (
                        batch_code, dataset_key, original_filename, file_format,
                        total_rows, unique_users, unique_posts,
                        fine_risk_distribution, fine_class_count, fine_labels,
                        coarse_risk_mapping, coarse_risk_distribution,
                        post_count, is_manual_annotation, has_timestamp, has_emojis,
                        accepted_rows, rejected_rows, status, committed_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    batch_code,
                    dataset_key,
                    os.path.basename(full_path),
                    'csv',
                    len(records),
                    stats['total_users'],
                    stats['total_posts'],
                    json.dumps(fine_risk_dist, ensure_ascii=False),
                    class_count,
                    json.dumps(fine_labels, ensure_ascii=False),
                    json.dumps(coarse_risk_mapping, ensure_ascii=False),
                    json.dumps(coarse_risk_dist, ensure_ascii=False),
                    1,  # post_count
                    is_manual_annotation,
                    has_timestamp,
                    has_emojis,
                    len(records_to_import),
                    len(records) - len(records_to_import),
                    'committed',
                    datetime.now()
                ))
                batch_id = cursor.lastrowid
                
                # 2. 插入心理档案记录
                for r in records_to_import:
                    # 计算粗粒度风险等级
                    risk_level = coarse_risk_mapping.get(str(r.label), 'low')
                    
                    await cursor.execute("""
                        INSERT INTO psychological_archives (
                            user_id, dataset_source, post_count, risk_level, risk_value,
                            label, has_timestamp, has_emojis, import_batch_id, import_timestamp, status
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                            post_count = VALUES(post_count),
                            risk_level = VALUES(risk_level),
                            risk_value = VALUES(risk_value),
                            label = VALUES(label),
                            import_batch_id = VALUES(import_batch_id),
                            import_timestamp = VALUES(import_timestamp),
                            status = 'ready'
                    """, (
                        r.user_id,
                        data_source,  # 使用用户选择的数据源 (如 'reddit') 而不是 dataset_key
                        len(r.posts),
                        risk_level,
                        r.label,
                        r.label,
                        1 if has_timestamp else 0,
                        1 if has_emojis else 0,
                        batch_id,
                        datetime.now(),
                        'ready'
                    ))
                    
                    # 获取档案ID（如果刚插入则用 lastrowid，否则查询）
                    archive_id = cursor.lastrowid
                    
                    # 3. 插入贴文记录
                    for idx, post_content in enumerate(r.posts):
                        await cursor.execute("""
                            INSERT INTO user_posts (
                                archive_id, user_id, post_index, content,
                                importance_level, review_status
                            ) VALUES (%s, %s, %s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE content = VALUES(content)
                        """, (
                            archive_id,
                            r.user_id,
                            idx,
                            post_content,
                            'medium',  # importance_level
                            'pending'   # review_status
                        ))
                
                await conn.commit()
        
        # 刷新首页统计缓存（确保导入后统计立即更新）
        try:
            home_svc = getattr(request.app.state, 'home_service', None)
            if home_svc:
                print(f"[DEBUG] 刷新首页统计缓存...")
                await home_svc.get_home_stats(force_refresh=True)
                print(f"[DEBUG] 首页统计缓存刷新成功")
            else:
                print(f"[WARN] home_service 未初始化，跳过统计刷新")
        except Exception as refresh_err:
            import traceback
            print(f"[WARN] 刷新首页统计失败: {refresh_err}")
            traceback.print_exc()
        
        return {
            "success": True,
            "data": {
                "message": "导入成功",
                "datasetKey": dataset_key,
                "batchCode": batch_code,
                "totalUsers": len(records_to_import),
                "totalPosts": sum(len(r.posts) for r in records_to_import),
                "riskDistribution": coarse_risk_dist,
            }
        }
    except Exception as e:
        # 如果数据库操作失败，回退状态
        try:
            async with mysql_pool.acquire() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute("""
                        UPDATE archive_import_batch SET status = 'failed', error_message = %s WHERE batch_code = %s
                    """, (str(e), batch_code))
                    await conn.commit()
        except:
            pass
        raise HTTPException(status_code=500, detail=f"数据库导入失败: {str(e)}")


@router.get("/archive/datasets")
async def list_uploaded_datasets():
    """列出已上传的数据集"""
    if not os.path.exists(ARCHIVES_DIR):
        return {"success": True, "data": []}
    
    datasets = []
    for fname in os.listdir(ARCHIVES_DIR):
        fpath = os.path.join(ARCHIVES_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        
        # 尝试解析获取统计信息
        try:
            _, stats = parse_csv_file(fpath)
            datasets.append({
                "fileName": fname,
                "filePath": f"/uploads/archives/{fname}",
                "fileSize": os.path.getsize(fpath),
                "totalUsers": stats['total_users'],
                "totalPosts": stats['total_posts'],
                "riskDistribution": stats['risk_distribution'],
            })
        except Exception:
            datasets.append({
                "fileName": fname,
                "filePath": f"/uploads/archives/{fname}",
                "fileSize": os.path.getsize(fpath),
                "error": "解析失败",
            })
    
    return {"success": True, "data": datasets}


@router.delete("/archive/datasets/{filename}")
async def delete_uploaded_dataset(filename: str):
    """删除已上传的数据集"""
    # 防止路径遍历攻击
    if '..' in filename or '/' in filename or '\\' in filename:
        raise HTTPException(status_code=400, detail="无效的文件名")
    
    file_path = os.path.join(ARCHIVES_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        os.remove(file_path)
        return {"success": True, "message": "文件已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")
