from fastapi import APIRouter, Response
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str = "1.0.0"
    database: Optional[dict] = None
    uptime_seconds: Optional[float] = None


class DetailedHealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str
    database: dict
    agent_pool: dict
    memory_usage: dict
    uptime_seconds: float


@router.get("/api/health", response_model=HealthResponse)
async def health_check():
    """基础健康检查接口"""
    from src.core.database import get_mysql_pool, get_pg_pool
    
    mysql_ok = False
    postgres_ok = False
    
    try:
        mysql_pool = get_mysql_pool()
        if mysql_pool:
            async with mysql_pool.acquire() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute("SELECT 1")
                    await cursor.fetchone()
            mysql_ok = True
    except Exception:
        pass
    
    try:
        pg_pool = get_pg_pool()
        if pg_pool:
            async with pg_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            postgres_ok = True
    except Exception:
        pass
    
    status = "ok" if mysql_ok else "degraded"
    
    return HealthResponse(
        status=status,
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        database={"mysql": mysql_ok, "postgres": postgres_ok}
    )


@router.get("/api/health/detailed")
async def detailed_health_check():
    """详细健康检查接口，包含数据库、Agent 池、内存使用等信息"""
    import os
    from src.core.database import get_pool_status
    from src.routes.chat import _agent_pool, _MAX_POOL_SIZE
    
    pool_status = await get_pool_status()
    
    # 获取 Agent 池状态
    agent_pool_size = len(_agent_pool)
    
    # 简化内存使用情况获取（不依赖 psutil）
    import sys
    memory_mb = sys.getsizeof(globals()) / 1024 / 1024  # 粗略估算
    
    # 总体状态判断
    overall_status = "ok"
    if not pool_status["mysql"]["healthy"]:
        overall_status = "degraded"
    if not pool_status["postgres"]["healthy"]:
        if overall_status == "degraded":
            overall_status = "critical"
        else:
            overall_status = "degraded"
    
    return {
        "status": overall_status,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0.0",
        "database": pool_status,
        "agent_pool": {
            "size": agent_pool_size,
            "max_size": _MAX_POOL_SIZE,
            "healthy": agent_pool_size > 0
        },
        "memory_usage": {
            "rss_mb": round(memory_mb, 2),
            "percent": 0.0  # 简化估算
        },
        "uptime_seconds": pool_status.get("uptime_seconds", 0)
    }


@router.post("/api/health/reconnect")
async def reconnect_databases():
    """手动重连数据库连接池"""
    from src.core.database import reconnect_mysql, reconnect_postgres
    
    results = {
        "mysql": {"success": False, "message": ""},
        "postgres": {"success": False, "message": ""}
    }
    
    mysql_result = await reconnect_mysql()
    results["mysql"]["success"] = mysql_result
    results["mysql"]["message"] = "重连成功" if mysql_result else "重连失败"
    
    pg_result = await reconnect_postgres()
    results["postgres"]["success"] = pg_result
    results["postgres"]["message"] = "重连成功" if pg_result else "重连失败"
    
    overall_success = mysql_result or pg_result
    
    return {
        "status": "success" if overall_success else "failed",
        "message": "部分数据库重连成功" if overall_success else "所有数据库重连失败",
        "results": results
    }
