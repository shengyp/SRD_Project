# 数据库连接池：MySQL（业务） + PostgreSQL（地理），生命周期由 app lifespan 管理
import asyncpg
import aiomysql
import asyncio
import gc
import time
import traceback
from .config import settings

# 模块级池，由 init_pools 赋值，便于 services 通过依赖注入或 app.state 使用
_pg_pool = None
_mysql_pool = None
_pool_init_time = 0
_pool_status = {
    "mysql": {"healthy": False, "last_check": 0, "error": None},
    "postgres": {"healthy": False, "last_check": 0, "error": None},
}


async def init_pools():
    """在 FastAPI lifespan 中调用，创建并持有连接池。"""
    global _pg_pool, _mysql_pool, _pool_init_time
    
    try:
        _pg_pool = await asyncpg.create_pool(
            host=settings.PG_HOST,
            port=settings.PG_PORT,
            database=settings.PG_NAME,
            user=settings.PG_USER,
            password=settings.PG_PASSWORD,
            min_size=settings.PG_POOL_MIN,
            max_size=settings.PG_POOL_MAX,
            server_settings={
                "client_encoding": "UTF8",
                "timezone": "Asia/Shanghai",
            },
        )
        _pool_status["postgres"]["healthy"] = True
        print("✅ PostgreSQL 连接池创建成功")
    except Exception as e:
        _pool_status["postgres"]["healthy"] = False
        _pool_status["postgres"]["error"] = str(e)
        print(f"⚠️ PostgreSQL 连接池创建失败: {str(e)}")
        print("   系统将继续运行，但地理数据查询功能可能不可用")

    try:
        _mysql_pool = await aiomysql.create_pool(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
            db=settings.DB_NAME,
            minsize=settings.MYSQL_POOL_MIN,
            maxsize=settings.MYSQL_POOL_MAX,
            autocommit=True,
            init_command="SET NAMES utf8mb4",
            use_unicode=True,
            charset='utf8mb4',
        )
        _pool_status["mysql"]["healthy"] = True
        _pool_init_time = time.time()
        print("✅ MySQL 连接池创建成功")
    except Exception as e:
        _pool_status["mysql"]["healthy"] = False
        _pool_status["mysql"]["error"] = str(e)
        print(f"⚠️ MySQL 连接池创建失败: {str(e)}")
        print("   系统将继续运行，但业务数据查询功能可能不可用")

    return _pg_pool, _mysql_pool


async def close_pools():
    """关闭连接池。"""
    global _pg_pool, _mysql_pool
    
    print("🔄 正在关闭数据库连接池...")
    if _pg_pool:
        try:
            await _pg_pool.close()
            _pg_pool = None
            print("✅ PostgreSQL 连接池已关闭")
        except Exception as e:
            print(f"⚠️ PostgreSQL 连接池关闭时出错: {str(e)}")
    
    if _mysql_pool:
        try:
            pool = _mysql_pool
            used_count = len(getattr(pool, "_used", []))
            free_count = len(getattr(pool, "_free", []))
            print(f"🔍 MySQL 连接池关闭前状态: used={used_count}, free={free_count}, size={pool.size}")

            pool.close()
            try:
                await asyncio.wait_for(pool.wait_closed(), timeout=3)
            except asyncio.TimeoutError:
                print("⚠️ MySQL 连接池等待关闭超时，改为强制终止仍在占用的连接")
                pool.terminate()
                await pool.wait_closed()

            _mysql_pool = None
            gc.collect()
            print("✅ MySQL 连接池已关闭")
        except Exception as e:
            print(f"⚠️ MySQL 连接池关闭时出错: {str(e)}")


def get_pg_pool():
    """获取 PostgreSQL 连接池（地理/机构/热线）。"""
    return _pg_pool


def get_mysql_pool():
    """获取 MySQL 连接池（业务/用户/数据集）。"""
    return _mysql_pool


async def check_mysql_health() -> dict:
    """检查 MySQL 连接池健康状态"""
    global _pool_status
    
    if _mysql_pool is None:
        return {"healthy": False, "error": "连接池未初始化"}
    
    try:
        async with _mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1")
                await cursor.fetchone()
        
        _pool_status["mysql"]["healthy"] = True
        _pool_status["mysql"]["last_check"] = time.time()
        _pool_status["mysql"]["error"] = None
        return {"healthy": True}
    except Exception as e:
        _pool_status["mysql"]["healthy"] = False
        _pool_status["mysql"]["error"] = str(e)
        _pool_status["mysql"]["last_check"] = time.time()
        return {"healthy": False, "error": str(e)}


async def check_postgres_health() -> dict:
    """检查 PostgreSQL 连接池健康状态"""
    global _pool_status
    
    if _pg_pool is None:
        return {"healthy": False, "error": "连接池未初始化"}
    
    try:
        async with _pg_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        _pool_status["postgres"]["healthy"] = True
        _pool_status["postgres"]["last_check"] = time.time()
        _pool_status["postgres"]["error"] = None
        return {"healthy": True}
    except Exception as e:
        _pool_status["postgres"]["healthy"] = False
        _pool_status["postgres"]["error"] = str(e)
        _pool_status["postgres"]["last_check"] = time.time()
        return {"healthy": False, "error": str(e)}


async def get_pool_status() -> dict:
    """获取所有连接池状态"""
    mysql_health = await check_mysql_health()
    postgres_health = await check_postgres_health()
    
    return {
        "mysql": mysql_health,
        "postgres": postgres_health,
        "uptime_seconds": time.time() - _pool_init_time if _pool_init_time > 0 else 0,
        "initialized": _mysql_pool is not None or _pg_pool is not None,
    }


async def reconnect_mysql() -> bool:
    """手动重连 MySQL 连接池"""
    global _mysql_pool
    
    print("🔄 正在重连 MySQL...")
    try:
        if _mysql_pool:
            _mysql_pool.close()
            try:
                await asyncio.wait_for(_mysql_pool.wait_closed(), timeout=3)
            except asyncio.TimeoutError:
                _mysql_pool.terminate()
                await _mysql_pool.wait_closed()
            gc.collect()

        _mysql_pool = await aiomysql.create_pool(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
            db=settings.DB_NAME,
            minsize=settings.MYSQL_POOL_MIN,
            maxsize=settings.MYSQL_POOL_MAX,
            autocommit=True,
            init_command="SET NAMES utf8mb4",
            use_unicode=True,
            charset='utf8mb4',
        )
        _pool_status["mysql"]["healthy"] = True
        print("✅ MySQL 重连成功")
        return True
    except Exception as e:
        _pool_status["mysql"]["healthy"] = False
        _pool_status["mysql"]["error"] = str(e)
        print(f"❌ MySQL 重连失败: {str(e)}")
        return False


async def reconnect_postgres() -> bool:
    """手动重连 PostgreSQL 连接池"""
    global _pg_pool
    
    print("🔄 正在重连 PostgreSQL...")
    try:
        if _pg_pool:
            await _pg_pool.close()
        
        _pg_pool = await asyncpg.create_pool(
            host=settings.PG_HOST,
            port=settings.PG_PORT,
            database=settings.PG_NAME,
            user=settings.PG_USER,
            password=settings.PG_PASSWORD,
            min_size=settings.PG_POOL_MIN,
            max_size=settings.PG_POOL_MAX,
            server_settings={
                "client_encoding": "UTF8",
                "timezone": "Asia/Shanghai",
            },
        )
        _pool_status["postgres"]["healthy"] = True
        print("✅ PostgreSQL 重连成功")
        return True
    except Exception as e:
        _pool_status["postgres"]["healthy"] = False
        _pool_status["postgres"]["error"] = str(e)
        print(f"❌ PostgreSQL 重连失败: {str(e)}")
        return False
