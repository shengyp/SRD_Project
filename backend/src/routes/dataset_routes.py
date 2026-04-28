from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Query
from typing import Optional, List, Dict, Any
import aiomysql
import json
from src.models import (
    DatasetListResponse,
    ExternalDatasetListResponse,
    DatasetCompareResponse,
    UploadDatasetResponse,
)
from src.services.dataset_csv_service import DatasetCSVService

router = APIRouter(prefix="", tags=["datasets"])


def _get_dataset_service(request: Request):
    return request.app.state.dataset_service


def _get_dataset_csv_service(request: Request):
    if not hasattr(request.app.state, "dataset_csv_service"):
        request.app.state.dataset_csv_service = DatasetCSVService()
    return request.app.state.dataset_csv_service


@router.get("/api/datasets", response_model=DatasetListResponse)
async def get_datasets(request: Request):
    """获取数据集列表（仅返回 CSV 内置数据集）"""
    csv_svc = _get_dataset_csv_service(request)
    csv_datasets = csv_svc.list_dataset_csvs()
    
    # 仅返回内置 CSV 数据集（Reddit系列）
    # 导入的档案通过 /api/demo/archives 接口访问，不作为独立数据集显示
    all_datasets = csv_datasets
    
    if all_datasets:
        return {"success": True, "data": all_datasets}
    
    svc = _get_dataset_service(request)
    data = await svc.get_datasets()
    return {"success": True, "data": data}


@router.get("/api/datasets/csv/{dataset_key}")
async def get_dataset_csv_info(request: Request, dataset_key: str):
    """获取数据集 CSV 文件信息（路径、URL）"""
    csv_svc = _get_dataset_csv_service(request)
    info = csv_svc.get_dataset_info(dataset_key)
    if not info:
        raise HTTPException(status_code=404, detail=f"数据集 {dataset_key} 不存在")
    return {
        "success": True,
        "data": {
            "datasetKey": info.dataset_key,
            "displayName": info.display_name,
            "csvPath": csv_svc.get_csv_url(dataset_key),
            "emojiCsvPath": csv_svc.get_emoji_csv_url(dataset_key),
            "totalUsers": info.total_users,
            "totalPosts": info.total_posts,
            "columns": info.columns,
            "language": info.language,
            "classSystem": info.class_system,
            "classCount": info.class_count,
            "fineLabels": info.fine_labels,
            "coarseRiskMapping": info.coarse_risk_mapping,
        }
    }


@router.get("/api/datasets/{dataset_key}/archives")
async def get_csv_archives(
    request: Request,
    dataset_key: str,
    dataset: Optional[str] = Query(None, description="数据集筛选"),
    risk_level: Optional[str] = Query(None, description="风险等级筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
):
    """获取档案分页列表（合并CSV内置数据和数据库导入数据）"""
    csv_svc = _get_dataset_csv_service(request)
    target_ds = dataset or dataset_key
    
    # 1. 从CSV获取内置数据集档案
    csv_archives, csv_total = csv_svc.get_archives_page(
        dataset_key=target_ds,
        risk_level=risk_level,
        page=1,
        page_size=10000,  # 获取全部，后面合并分页
    )
    
    # 2. 从数据库获取导入的档案（仅自定义数据集，内置数据集只从CSV读取）
    db_archives = []
    db_total = 0
    is_builtin_dataset = dataset_key in DatasetCSVService.DATASET_CONFIG
    
    # 内置数据集（reddit等）只从CSV读取，数据库中可能存在重复数据需排除
    if not is_builtin_dataset:
        try:
            mysql_pool = request.app.state.mysql_db
            async with mysql_pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cursor:
                    await cursor.execute("SET NAMES utf8mb4")
                    
                    # 构建查询条件：优先匹配 archive_import_batch 表的 dataset_key
                    if target_ds.startswith("custom_"):
                        # 自定义数据集：通过 archive_import_batch 表关联查询
                        query_sql = """
                            SELECT pa.id, pa.user_id, pa.dataset_source, pa.post_count, pa.risk_level, pa.risk_value,
                                   pa.has_timestamp, pa.has_emojis, pa.import_timestamp, pa.status,
                                   aib.dataset_key
                            FROM psychological_archives pa
                            INNER JOIN archive_import_batch aib ON pa.import_batch_id = aib.id
                            WHERE aib.dataset_key = %s
                        """
                        count_sql = """
                            SELECT COUNT(*) as cnt
                            FROM psychological_archives pa
                            INNER JOIN archive_import_batch aib ON pa.import_batch_id = aib.id
                            WHERE aib.dataset_key = %s
                        """
                        params = [target_ds]
                    else:
                        # 内置数据集：直接查询 psychological_archives（但通常为空）
                        query_sql = """
                            SELECT id, user_id, dataset_source, post_count, risk_level, risk_value,
                                   has_timestamp, has_emojis, import_timestamp, status,
                                   NULL as dataset_key
                            FROM psychological_archives 
                            WHERE dataset_source = %s
                        """
                        count_sql = """
                            SELECT COUNT(*) as cnt
                            FROM psychological_archives 
                            WHERE dataset_source = %s
                        """
                        params = [target_ds]
                    
                    if risk_level:
                        query_sql += " AND pa.risk_level = %s" if target_ds.startswith("custom_") else " AND risk_level = %s"
                        count_sql += " AND pa.risk_level = %s" if target_ds.startswith("custom_") else " AND risk_level = %s"
                        params.append(risk_level)
                    
                    query_sql += " ORDER BY pa.id DESC LIMIT %s OFFSET %s"
                    
                    # 获取总数
                    await cursor.execute(count_sql, params)
                    row = await cursor.fetchone()
                    db_total = row["cnt"] if row else 0
                    
                    # 获取数据
                    if db_total > 0:
                        offset = 0  # 数据库档案单独分页
                        limit = page_size
                        await cursor.execute(query_sql, params + [limit, offset])
                        rows = await cursor.fetchall()
                        db_archives = rows
        except Exception as e:
            print(f"[WARN] 获取数据库档案失败: {e}")
            db_archives = []
            db_total = 0
    else:
        # 内置数据集：跳过数据库查询，仅使用CSV数据
        print(f"[INFO] 内置数据集 {dataset_key}，跳过数据库查询，仅使用CSV数据")
    
    # 3. 合并并转换数据格式
    def make_archive_dict(a, source):
        """统一档案数据结构"""
        if hasattr(a, 'user_id'):  # CSV对象
            return {
                "id": a.user_id,
                "userId": a.user_id,
                "userHash": a.user_id,
                "datasetSource": a.dataset_key,
                "postCount": a.post_count,
                "riskLevel": a.risk_level,
                "riskValue": a.risk_value,
                "hasTimestamp": a.has_timestamp,
                "hasEmojis": a.has_emojis,
                "importTime": a.import_timestamp,
                "source": source,
            }
        else:  # 数据库字典
            return {
                "id": str(a["user_id"]),
                "userId": str(a["user_id"]),
                "userHash": str(a["user_id"]),
                "datasetSource": a.get("dataset_key") or a["dataset_source"],  # 优先使用 dataset_key
                "postCount": a["post_count"],
                "riskLevel": a["risk_level"],
                "riskValue": a["risk_value"],
                "hasTimestamp": bool(a["has_timestamp"]),
                "hasEmojis": bool(a["has_emojis"]),
                "importTime": a["import_timestamp"].isoformat() if a.get("import_timestamp") else None,
                "source": source,
            }
    
    # 合并两个数据源
    all_archives = []
    for a in csv_archives:
        all_archives.append(make_archive_dict(a, "csv"))
    for a in db_archives:
        all_archives.append(make_archive_dict(a, "db"))
    
    # 应用风险等级筛选（如果是在代码层面筛选的话，上面SQL已经筛选了）
    # 但为了确保CSV数据也被筛选，我们在这里再次确认
    if risk_level:
        all_archives = [a for a in all_archives if a["riskLevel"] == risk_level]
    
    # 4. 计算总数和分页
    total = csv_total + db_total
    
    # 分页：只取当前页的数据
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    page_archives = all_archives[start_idx:end_idx]
    
    return {
        "success": True,
        "data": {
            "archives": page_archives,
            "total": total,
            "csvTotal": csv_total,
            "dbTotal": db_total,
            "page": page,
            "pageSize": page_size,
            "totalPages": (total + page_size - 1) // page_size if total > 0 else 1,
        }
    }


@router.get("/api/datasets/{dataset_key}/posts")
async def get_csv_user_posts(
    request: Request,
    dataset_key: str,
    user_hash: str = Query(..., description="用户哈希"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=500, description="每页条数"),
):
    """从 CSV 文件获取用户贴文列表（默认50条，前端负责分页显示）
    
    注意：后端一次返回较多数据（默认50条），前端负责：
    1. 默认显示前15条
    2. 通过"查看更多"按钮逐步加载后续帖子
    """
    csv_svc = _get_dataset_csv_service(request)
    posts, total = csv_svc.get_user_posts(
        user_hash=user_hash,
        dataset_key=dataset_key,
        page=page,
        page_size=page_size,
    )
    return {
        "success": True,
        "data": {
            "posts": [
                {
                    "id": f"{p.user_id}_{p.post_index}",
                    "userId": p.user_id,
                    "postIndex": p.post_index,
                    "content": p.content,
                    "riskLevel": p.risk_level,
                    "riskValue": p.risk_value,
                    "sentimentScore": p.sentiment_score,
                    "importanceScore": p.importance_score,
                    "timestamp": p.timestamp,
                    "hasEmojis": p.has_emojis,
                    "emojiSequence": p.emoji_sequence,
                }
                for p in posts
            ],
            "total": total,
            "page": page,
            "pageSize": page_size,
        }
    }


@router.get("/api/datasets/{dataset_key}/keywords")
async def get_csv_user_keywords(
    request: Request,
    dataset_key: str,
    user_hash: str = Query(..., description="用户哈希"),
    top_n: int = Query(8, ge=1, le=50, description="返回前 N 个高频词"),
):
    """从 CSV 文件获取用户贴文高频词汇"""
    csv_svc = _get_dataset_csv_service(request)
    keywords = csv_svc.get_user_keywords(user_hash=user_hash, top_n=top_n)
    return {
        "success": True,
        "data": {
            "keywords": keywords,
            "total": len(keywords),
        }
    }


@router.get("/api/datasets/external", response_model=ExternalDatasetListResponse)
async def get_external_datasets(request: Request):
    svc = _get_dataset_service(request)
    data = await svc.get_external_datasets()
    return {"success": True, "data": data}


@router.get("/api/datasets/compare", response_model=DatasetCompareResponse)
async def get_datasets_compare(request: Request):
    svc = _get_dataset_service(request)
    data = await svc.get_datasets_compare()
    return {"success": True, "data": data}


@router.get("/api/datasets/stats")
async def get_datasets_stats(request: Request):
    """获取所有数据集的汇总统计"""
    csv_svc = _get_dataset_csv_service(request)
    datasets = csv_svc.list_dataset_csvs()

    total_users = sum(d.get("totalUsers", 0) for d in datasets)
    total_posts = sum(d.get("totalPosts", 0) for d in datasets)

    return {
        "success": True,
        "data": {
            "totalUsers": total_users,
            "totalPosts": total_posts,
            "datasets": {
                d["datasetKey"]: {
                    "users": d.get("totalUsers", 0),
                    "posts": d.get("totalPosts", 0)
                }
                for d in datasets
            }
        }
    }


@router.post("/api/datasets/upload", response_model=UploadDatasetResponse)
async def upload_dataset(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(...),
    mode_type: str = Form("all"),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="仅支持 CSV 文件")
    content = await file.read()
    svc = _get_dataset_service(request)
    try:
        data = await svc.upload_dataset(content, file.filename, name, mode_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "data": data}
