# 认证路由：注册 / 登录 / 退出 / 修改密码
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status, Depends, Request
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional

from src.core.security import get_current_user, create_access_token
from src.services.auth_service import AuthService

router = APIRouter(prefix="", tags=["auth"])


def _get_auth_service(request: Request) -> AuthService:
    return request.app.state.auth_service


# ==================== Pydantic 请求模型 ====================


class RegisterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    username: str = Field(..., min_length=3, max_length=50, description="用户名（3-50字符）")
    password: str = Field(..., min_length=6, max_length=128, description="密码（至少6字符）")
    nickname: Optional[str] = Field(None, max_length=100, description="昵称（可选）")

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        import re
        if not re.match(r"^[a-zA-Z0-9_\u4e00-\u9fff]+$", v):
            raise ValueError("用户名只能包含字母、数字、下划线和中文")
        return v


class LoginRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    old_password: str = Field(..., description="原密码")
    new_password: str = Field(..., min_length=6, max_length=128, description="新密码（至少6字符）")


class UpdateProfileRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    nickname: Optional[str] = Field(None, max_length=100, description="新昵称")


class TokenResponse(BaseModel):
    token: str
    expires_at: str
    jti: str
    user: dict


# ==================== 路由实现 ====================


@router.post("/api/auth/register", summary="用户注册")
async def register(body: RegisterRequest, request: Request):
    """注册新用户账户。成功返回 JWT Token。"""
    svc = _get_auth_service(request)
    try:
        user_id, nickname = await svc.register(
            username=body.username,
            password=body.password,
            nickname=body.nickname,
            role="user",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 注册后自动登录
    token_data = create_access_token(user_id, body.username, role="user")
    return {
        "success": True,
        "data": {
            "token": token_data["token"],
            "expires_at": token_data["expires_at"],
            "jti": token_data["jti"],
            "user": {
                "id": user_id,
                "username": body.username,
                "nickname": nickname,
                "avatar_color": "#C19A83",
                "role": "user",
            },
        },
    }


@router.post("/api/auth/login", summary="用户登录")
async def login(body: LoginRequest, request: Request):
    """用户名 + 密码登录，成功返回 JWT Token。"""
    svc = _get_auth_service(request)
    user = await svc.authenticate(body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    token_data = create_access_token(user["id"], user["username"], role=user.get("role", "user"))
    return {
        "success": True,
        "data": {
            "token": token_data["token"],
            "expires_at": token_data["expires_at"],
            "jti": token_data["jti"],
            "user": {
                "id": user["id"],
                "username": user["username"],
                "nickname": user["nickname"],
                "avatar_color": user["avatar_color"],
                "role": user.get("role", "user"),
            },
        },
    }


@router.post("/api/auth/logout", summary="退出登录")
async def logout(request: Request, current_user: dict = Depends(get_current_user)):
    """撤销当前 Token（加入黑名单）。"""
    svc = _get_auth_service(request)
    exp = current_user.get("exp")
    expires_at = datetime.fromtimestamp(exp, tz=timezone.utc) if exp else datetime.now(timezone.utc)
    await svc.revoke_token(current_user["jti"], expires_at)
    return {"success": True, "data": {"message": "已安全退出"}}


@router.get("/api/auth/me", summary="获取当前用户信息")
async def get_me(request: Request, current_user: dict = Depends(get_current_user)):
    """获取当前登录用户的详细信息。"""
    svc = _get_auth_service(request)
    user = await svc.get_user_by_id(current_user["user_id"])
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return {"success": True, "data": user}


@router.post("/api/auth/change-password", summary="修改密码")
async def change_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """修改当前用户的登录密码。"""
    svc = _get_auth_service(request)
    success, message = await svc.change_password(
        user_id=current_user["user_id"],
        old_password=body.old_password,
        new_password=body.new_password,
    )
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    return {"success": True, "data": {"message": message}}


@router.put("/api/auth/profile", summary="更新个人资料")
async def update_profile(
    body: UpdateProfileRequest,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """更新昵称等个人资料。"""
    svc = _get_auth_service(request)
    if body.nickname is not None:
        ok = await svc.update_nickname(current_user["user_id"], body.nickname)
        if not ok:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="昵称不能为空")
    return {"success": True, "data": {"message": "资料更新成功"}}
