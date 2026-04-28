# 认证服务：用户注册 / 登录 / 密码修改 / Token 黑名单
from datetime import datetime, timezone
from typing import Optional, Tuple

from src.core.security import hash_password, verify_password


# 头像背景色候选池（与 TopBar 配色协调）
AVATAR_COLORS = [
    "#C19A83", "#A07D6B", "#8B6F5E",  # 暖棕系
    "#7B9E89", "#5A7A63",              # 抹茶绿
    "#8BA5B5", "#6B8A9E",              # 雾霾蓝
    "#B5A07B", "#9E8A5A",              # 沙金
    "#A08B8B", "#8E7474",              # 藕荷
    "#8B8BA5", "#74749E",              # 薰衣草灰
]


class AuthService:
    """用户认证业务逻辑，依赖 MySQL 连接池。"""

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool

    # ==================== 工具方法 ====================

    async def _query_one(self, sql: str, params: tuple = ()):
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(sql, params)
                return await cursor.fetchone()

    async def _query_all(self, sql: str, params: tuple = ()):
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(sql, params)
                return await cursor.fetchall()

    async def _execute(self, sql: str, params: tuple = ()):
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(sql, params)
                await conn.commit()
                return cursor.lastrowid

    # ==================== Token 黑名单 ====================

    async def revoke_token(self, jti: str, expires_at: datetime) -> None:
        """将 Token jti 加入黑名单。"""
        await self._execute(
            "INSERT INTO token_blacklist (token_jti, expires_at) VALUES (%s, %s)",
            (jti, expires_at),
        )

    async def is_token_revoked(self, jti: str) -> bool:
        """检查 Token jti 是否在黑名单中。"""
        row = await self._query_one(
            "SELECT id FROM token_blacklist WHERE token_jti = %s", (jti,)
        )
        return row is not None

    async def cleanup_expired_tokens(self) -> int:
        """清理已过期的黑名单记录。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "DELETE FROM token_blacklist WHERE expires_at < NOW()"
                )
                await conn.commit()
                return cursor.rowcount

    # ==================== 用户注册 ====================

    async def register(
        self, username: str, password: str, nickname: Optional[str] = None, role: str = "user"
    ) -> Tuple[int, str]:
        """注册新用户，返回 (user_id, nickname)。用户名已存在则抛出 ValueError。"""
        # 检查用户名是否重复
        existing = await self._query_one(
            "SELECT id FROM app_users WHERE username = %s", (username,)
        )
        if existing:
            raise ValueError("用户名已存在，请换一个")

        # 检查邮箱是否重复（如果提供了邮箱）
        if nickname is None:
            nickname = username

        import random
        avatar_color = random.choice(AVATAR_COLORS)
        password_hash = hash_password(password)

        user_id = await self._execute(
            """INSERT INTO app_users
               (username, nickname, password_hash, avatar_color, role)
               VALUES (%s, %s, %s, %s, %s)""",
            (username, nickname, password_hash, avatar_color, role),
        )
        return user_id, nickname

    # ==================== 用户登录 ====================

    async def authenticate(self, username: str, password: str) -> Optional[dict]:
        """验证用户名密码，成功返回用户信息，失败返回 None。"""
        row = await self._query_one(
            """SELECT id, username, nickname, password_hash, avatar_color, is_active, role
               FROM app_users WHERE username = %s""",
            (username,),
        )
        if not row:
            return None

        user_id, uname, nickname, pwd_hash, avatar_color, is_active, role = row
        if not is_active:
            return None

        if not verify_password(password, pwd_hash):
            return None

        # 更新最后登录时间
        await self._execute(
            "UPDATE app_users SET last_login_at = %s WHERE id = %s",
            (datetime.now(timezone.utc), user_id),
        )

        return {
            "id": user_id,
            "username": uname,
            "nickname": nickname or uname,
            "avatar_color": avatar_color,
            "role": role or "user",
        }

    async def get_user_by_id(self, user_id: int) -> Optional[dict]:
        """根据 ID 获取用户基本信息。"""
        row = await self._query_one(
            """SELECT id, username, nickname, email, avatar_color, role,
                      is_active, last_login_at, created_at
               FROM app_users WHERE id = %s""",
            (user_id,),
        )
        if not row:
            return None
        return {
            "id": row[0],
            "username": row[1],
            "nickname": row[2] or row[1],
            "email": row[3],
            "avatar_color": row[4],
            "role": row[5] or "user",
            "is_active": row[6],
            "last_login_at": row[7].isoformat() if row[7] else None,
            "created_at": row[8].isoformat() if row[8] else None,
        }

    # ==================== 修改密码 ====================

    async def change_password(
        self, user_id: int, old_password: str, new_password: str
    ) -> Tuple[bool, str]:
        """修改密码。返回 (success, message)。"""
        row = await self._query_one(
            "SELECT password_hash FROM app_users WHERE id = %s", (user_id,)
        )
        if not row:
            return False, "用户不存在"

        if not verify_password(old_password, row[0]):
            return False, "原密码错误"

        new_hash = hash_password(new_password)
        await self._execute(
            "UPDATE app_users SET password_hash = %s WHERE id = %s",
            (new_hash, user_id),
        )
        return True, "密码修改成功"

    async def update_nickname(self, user_id: int, nickname: str) -> bool:
        """更新昵称。"""
        if not nickname or not nickname.strip():
            return False
        await self._execute(
            "UPDATE app_users SET nickname = %s WHERE id = %s",
            (nickname.strip(), user_id),
        )
        return True
