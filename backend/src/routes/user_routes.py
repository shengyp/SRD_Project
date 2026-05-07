from fastapi import APIRouter, Query, HTTPException, Request
from typing import Optional
from pydantic import BaseModel

router = APIRouter(prefix="", tags=["users"])


def _get_user_service(request: Request):
    return request.app.state.user_service


def _get_home_service(request: Request):
    return request.app.state.home_service


class BatchDeleteUsersRequest(BaseModel):
    user_ids: list[str]


@router.get("/api/users")
async def get_users(
    request: Request,
    dataset: Optional[str] = Query(None, description="数据集名称"),
    risk_level: Optional[str] = Query(None, description="风险等级"),
    keyword: Optional[str] = Query(None, description="用户ID关键词"),
    status: Optional[str] = Query(None, description="档案状态"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    svc = _get_user_service(request)
    try:
        payload = await svc.get_users(
            dataset=dataset,
            risk_level=risk_level,
            keyword=keyword,
            status=status,
            page=page,
            page_size=page_size,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True, "data": payload}


@router.post("/api/users/batch-delete")
async def batch_delete_users(request: Request, body: BatchDeleteUsersRequest):
    svc = _get_user_service(request)
    home_svc = _get_home_service(request)
    try:
        deleted = await svc.delete_users(body.user_ids)
        await home_svc.get_home_stats(force_refresh=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True, "data": {"deleted": deleted}}


@router.get("/api/users/{user_hash}")
async def get_user_detail(request: Request, user_hash: str):
    svc = _get_user_service(request)
    try:
        user = await svc.get_user_detail(user_hash)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True, "data": user}


@router.delete("/api/users/{user_hash}")
async def delete_user(request: Request, user_hash: str):
    svc = _get_user_service(request)
    home_svc = _get_home_service(request)
    try:
        deleted = await svc.delete_user(user_hash)
        if deleted == 0:
            raise HTTPException(status_code=404, detail="用户不存在")
        await home_svc.get_home_stats(force_refresh=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True, "data": {"deleted": deleted}}
