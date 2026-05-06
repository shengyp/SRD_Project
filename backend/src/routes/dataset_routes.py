from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Query
from typing import Optional, List, Dict, Any
import aiomysql
import json
from src.models import (
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


@router.get("/api/datasets")
async def get_datasets(request: Request):
    """获取数据集列表，仅读取 MySQL。"""
    svc = _get_dataset_service(request)
    data = await svc.get_datasets()
    for item in data:
        if "id" in item and item["id"] is not None:
            item["id"] = str(item["id"])
    return {"success": True, "data": data}


@router.get("/api/datasets/csv/{dataset_key}")
async def get_dataset_csv_info(request: Request, dataset_key: str):
    raise HTTPException(status_code=410, detail="系统已切换为纯数据库模式，CSV 直连接口已停用")


@router.get("/api/datasets/{dataset_key}/archives")
async def get_csv_archives(
    request: Request,
    dataset_key: str,
    dataset: Optional[str] = Query(None, description="数据集筛选"),
    risk_level: Optional[str] = Query(None, description="风险等级筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
):
    """获取档案分页列表，仅从 MySQL 读取。"""
    svc = _get_dataset_service(request)
    data = await svc.get_db_archives_page(
        dataset_key=dataset or dataset_key,
        risk_level=risk_level,
        page=page,
        page_size=page_size,
    )
    return {"success": True, "data": data}


@router.get("/api/datasets/{dataset_key}/posts")
async def get_csv_user_posts(
    request: Request,
    dataset_key: str,
    user_hash: str = Query(..., description="用户哈希"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=500, description="每页条数"),
):
    """获取用户贴文列表，仅从 MySQL 读取。"""
    svc = _get_dataset_service(request)
    data = await svc.get_db_user_posts(
        dataset_key=dataset_key,
        user_hash=user_hash,
        page=page,
        page_size=page_size,
    )
    return {"success": True, "data": data}


@router.get("/api/datasets/{dataset_key}/keywords")
async def get_csv_user_keywords(
    request: Request,
    dataset_key: str,
    user_hash: str = Query(..., description="用户哈希"),
    top_n: int = Query(8, ge=1, le=50, description="返回前 N 个高频词"),
):
    """获取用户贴文高频词汇，仅从 MySQL 读取。"""
    svc = _get_dataset_service(request)
    keywords = await svc.get_db_user_keywords(dataset_key=dataset_key, user_hash=user_hash, top_n=top_n)
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
    """获取所有数据集的汇总统计，仅从 MySQL 读取。"""
    svc = _get_dataset_service(request)
    datasets = await svc.get_datasets()

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


@router.post("/api/datasets/builtin/sync")
async def sync_builtin_datasets(
    request: Request,
    payload: Optional[Dict[str, Any]] = None,
):
    """将四个内置系列同步到 MySQL，作为统一主存储。"""
    svc = _get_dataset_service(request)
    csv_svc = DatasetCSVService()
    dataset_keys = None
    if payload:
        dataset_keys = payload.get("datasetKeys") or payload.get("dataset_keys")
    result = await svc.sync_builtin_datasets(csv_svc=csv_svc, dataset_keys=dataset_keys)

    try:
        home_svc = getattr(request.app.state, "home_service", None)
        if home_svc:
            await home_svc.get_home_stats(force_refresh=True)
    except Exception as exc:
        print(f"[WARN] 刷新首页统计失败: {exc}")

    return {"success": True, "data": result}
