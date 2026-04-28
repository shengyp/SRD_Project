from fastapi import APIRouter, Query, HTTPException, Request
from typing import Optional

router = APIRouter(prefix="", tags=["users"])


def _get_user_service(request: Request):
    return request.app.state.user_service


@router.get("/api/users")
async def get_users(
    request: Request,
    dataset: Optional[str] = Query(None, description="数据集名称"),
    risk_level: Optional[str] = Query(None, description="风险等级"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    svc = _get_user_service(request)
    try:
        payload = await svc.get_users(
            dataset=dataset,
            risk_level=risk_level,
            page=page,
            page_size=page_size,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True, "data": payload}


@router.get("/api/users/{user_hash}")
async def get_user_detail(request: Request, user_hash: str):
    svc = _get_user_service(request)
    try:
        user = await svc.get_user_detail(user_hash)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True, "data": user}
