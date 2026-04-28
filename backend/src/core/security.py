# VIS4SRD 后端安全模块：JWT + 密码加密
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
import bcrypt

from src.core.config import settings

# ==================== 密码加密 ====================


def hash_password(password: str) -> str:
    """bcrypt 加密密码。"""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """验证密码。"""
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


# ==================== JWT Token ====================

ALGORITHM = getattr(settings, "JWT_ALGORITHM", "HS256")
SECRET_KEY = getattr(settings, "JWT_SECRET_KEY", "dev_secret_key_change_in_production")
ACCESS_TOKEN_EXPIRE_MINUTES = getattr(settings, "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 1440)


def create_access_token(user_id: int, username: str, role: str = "user") -> dict:
    """创建 JWT Access Token。返回 { token, expires_at }。"""
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    jti = str(uuid.uuid4())
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expires_at,
        "iat": datetime.now(timezone.utc),
        "jti": jti,
        "type": "access",
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return {
        "token": token,
        "expires_at": expires_at.isoformat(),
        "jti": jti,
    }


def decode_token(token: str) -> dict:
    """解码 JWT Token，失败则抛异常。"""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ==================== 依赖注入：获取当前用户 ====================

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    request: Request = None,
) -> dict:
    """从请求头提取并验证 JWT Token，返回用户信息。"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证 Token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 Token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = int(payload.get("sub", 0))
    username = payload.get("username", "")
    role = payload.get("role", "user")
    jti = payload.get("jti", "")

    if not user_id or not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 格式无效",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 检查 Token 黑名单
    if request is not None:
        auth_service = getattr(request.app.state, "auth_service", None)
        if auth_service is not None:
            if await auth_service.is_token_revoked(jti):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token 已失效，请重新登录",
                    headers={"WWW-Authenticate": "Bearer"},
                )

    return {
        "user_id": user_id,
        "username": username,
        "role": role,
        "jti": jti,
        "exp": payload.get("exp"),
    }


async def get_current_admin_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    request: Request = None,
) -> dict:
    """管理员权限依赖：必须是已登录的 admin 角色。"""
    current_user = await get_current_user(credentials, request)
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    """可选认证：Token 存在则解析，不存在也不报错（用于判断登录状态）。"""
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None
