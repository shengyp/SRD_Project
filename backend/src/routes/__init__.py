# 路由层初始化：统一导出所有路由
from .health import router as health_router
from .dataset_routes import router as dataset_router
from .user_routes import router as user_router
from .map_routes import router as map_router
from .home import router as home_router
from .scales import router as scales_router
from .risk import router as risk_router
from .knowledge import router as knowledge_router
from .chat import router as chat_router
from .models import router as models_router
from .system import router as system_router
from .auth import router as auth_router
from .upload_archive import router as upload_archive_router

__all__ = [
    "health_router",
    "dataset_router",
    "user_router",
    "map_router",
    "home_router",
    "scales_router",
    "risk_router",
    "knowledge_router",
    "chat_router",
    "models_router",
    "system_router",
    "auth_router",
    "upload_archive_router",
]
