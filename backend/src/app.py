# -*- coding: utf-8 -*-
"""
VIS4SRD - 自杀风险可视化检测系统
"""
import sys
import io
import os
import traceback
from pathlib import Path

# 设置 UTF-8 编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 禁用代理（可能导致 SSL 问题）
os.environ['no_proxy'] = '*'
os.environ['NO_PROXY'] = '*'
os.environ['CURL_CA_BUNDLE'] = ''
os.environ['REQUESTS_CA_BUNDLE'] = ''

# 设置 HuggingFace 镜像（解决下载超时问题）
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

# 加载 .env 文件
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_path)

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import orjson


class ORJSONResponse(JSONResponse):
    """自定义 ORJSONResponse，确保不转义 Unicode 字符（解决中文显示问题）"""

    def render(self, content) -> bytes:
        return orjson.dumps(
            content, 
            default=lambda x: str(x),
            option=orjson.OPT_NON_STR_KEYS | orjson.OPT_SERIALIZE_NUMPY
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """管理数据库连接池与自定义表初始化。"""
    from src.core import init_pools, close_pools
    from src.core.database import get_mysql_pool, get_pg_pool
    
    try:
        await init_pools()
        pg_pool = get_pg_pool()
        mysql_pool = get_mysql_pool()

        # 注入服务（依赖连接池）
        from src.services import (
            DatasetService, DatasetCSVService, UserService, MapService, 
            ModelService, KnowledgeService, ChatService, ScaleService, 
            HomeService, AuthService
        )
        
        dataset_svc = DatasetService(mysql_pool)
        await dataset_svc.ensure_custom_dataset_meta_table()

        # 初始化 CSV 数据集服务（直接从 datasets/ 目录读取）
        dataset_csv_base = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "datasets")
        csv_svc = DatasetCSVService(base_dir=dataset_csv_base)

        async def get_dataset_config(force_refresh: bool = False):
            return await dataset_svc.get_dataset_config(force_refresh=force_refresh)

        user_svc = UserService(mysql_pool, get_dataset_config)
        map_svc = MapService(pg_pool)
        model_svc = ModelService(mysql_pool)
        knowledge_svc = KnowledgeService(mysql_pool)
        chat_svc = ChatService(mysql_pool)
        scale_svc = ScaleService(mysql_pool)
        home_svc = HomeService(mysql_pool)
        auth_svc = AuthService(mysql_pool)

        app.state.dataset_service = dataset_svc
        app.state.dataset_csv_service = csv_svc
        app.state.user_service = user_svc
        app.state.map_service = map_svc
        app.state.model_service = model_svc
        app.state.knowledge_service = knowledge_svc
        app.state.chat_service = chat_svc
        app.state.scale_service = scale_svc
        app.state.home_service = home_svc
        app.state.auth_service = auth_svc
        app.state.mysql_db = mysql_pool
        app.state.pg_db = pg_pool

        # 启动时自动加载 rag-skill/knowledge 目录（使用相对路径）
        try:
            # 使用相对路径，避免 Windows 中文路径导致的编码问题
            backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            knowledge_base_path = os.path.join(backend_root, "SuiAgent-main", "rag-skill", "knowledge")
            # 验证路径存在
            if os.path.exists(knowledge_base_path):
                topic_code_map = await knowledge_svc.get_topic_code_map()
                sub_topic_code_map = await knowledge_svc.get_sub_topic_code_map()
                import_results = await knowledge_svc.import_documents_from_directory(
                    base_path=knowledge_base_path,
                    topic_code_map=topic_code_map,
                    sub_topic_code_map=sub_topic_code_map,
                )
                print(f"✅ 知识库已自动加载：成功 {import_results.get('imported', 0)} 篇，跳过 {import_results.get('skipped', 0)} 篇")
            else:
                # 尝试使用 Path.resolve() 处理中文路径
                from pathlib import Path
                alt_path = Path(backend_root) / "SuiAgent-main" / "rag-skill" / "knowledge"
                if alt_path.exists():
                    knowledge_base_path = str(alt_path.resolve())
                    topic_code_map = await knowledge_svc.get_topic_code_map()
                    sub_topic_code_map = await knowledge_svc.get_sub_topic_code_map()
                    import_results = await knowledge_svc.import_documents_from_directory(
                        base_path=knowledge_base_path,
                        topic_code_map=topic_code_map,
                        sub_topic_code_map=sub_topic_code_map,
                    )
                    print(f"✅ 知识库已自动加载：成功 {import_results.get('imported', 0)} 篇")
                else:
                    print(f"⚠️ 知识库目录不存在：{knowledge_base_path}")
        except Exception as e:
            print(f"⚠️ 知识库自动加载失败：{str(e)}")

        print("🚀 PostgreSQL + PostGIS 连接池已创建（地理数据）")
        print("🚀 MySQL 连接池已创建（业务数据）")
        print("✅ custom_dataset_meta 表已就绪")
        print("✅ ModelService 已就绪")
        print("✅ KnowledgeService 已就绪")
        print("✅ ChatService 已就绪")
        print("✅ ScaleService 已就绪")
        print("✅ HomeService 已就绪")
        print("✅ AuthService 已就绪")

        # 预热 Agent 池（后台异步执行，不阻塞启动）
        import asyncio
        from src.routes.chat import _warmup_agent_pool_async
        asyncio.create_task(_warmup_agent_pool_async(count=1))

        yield
    except Exception as e:
        print(f"[启动错误] {str(e)}")
        print(traceback.format_exc())
    finally:
        from src.core import close_pools
        await close_pools()
        print("🔄 数据库连接池已关闭")


def create_app() -> FastAPI:
    """工厂函数创建 FastAPI 应用"""
    app = FastAPI(
        title="VIS4SRD 心理健康服务平台 API",
        description="自杀风险可视化检测系统：数据集、用户档案、心理机构与热线",
        version="1.0.0",
        lifespan=lifespan,
        default_response_class=ORJSONResponse,
    )
    
    # 设置全局异常处理器
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        """捕获所有未处理的异常，确保服务器不会崩溃"""
        error_id = f"ERR_{int(os.times().elapsed * 1000000)}"
        
        print(f"\n{'='*60}")
        print(f"[全局异常] {error_id}")
        print(f"[请求路径] {request.url.path}")
        print(f"[请求方法] {request.method}")
        print(f"[错误类型] {type(exc).__name__}")
        print(f"[错误信息] {str(exc)}")
        print(f"[堆栈跟踪]\n{traceback.format_exc()}")
        print(f"{'='*60}\n")
        
        status_code = 500
        if isinstance(exc, HTTPException):
            status_code = exc.status_code
        elif isinstance(exc, (ValueError, TypeError)):
            status_code = 400
        elif "timeout" in str(exc).lower() or "timed out" in str(exc).lower():
            status_code = 504
        elif "connection" in str(exc).lower():
            status_code = 503
        
        return JSONResponse(
            status_code=status_code,
            content={
                "code": status_code,
                "error_id": error_id,
                "message": "系统处理请求时发生错误，请稍后重试。",
            }
        )

    # CORS 中间件（开发环境允许 localhost，生产环境建议指定具体域名）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册路由
    from src.routes import (
        health_router, dataset_router, user_router, map_router,
        home_router, system_router, scales_router, risk_router,
        knowledge_router, chat_router, upload_router, upload_archive_router,
        models_router, auth_router,
    )
    
    app.include_router(health_router)
    app.include_router(dataset_router)
    app.include_router(user_router)
    app.include_router(map_router)
    app.include_router(home_router)
    app.include_router(system_router)
    app.include_router(scales_router)
    app.include_router(risk_router)
    app.include_router(knowledge_router)
    app.include_router(chat_router)
    app.include_router(upload_router)
    app.include_router(upload_archive_router)
    app.include_router(models_router)
    app.include_router(auth_router)

    # 挂载静态文件目录
    _uploads_mount = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _uploads_base = os.path.join(_uploads_mount, "uploads")
    if os.path.exists(_uploads_base):
        app.mount("/uploads", StaticFiles(directory=_uploads_base), name="uploads")
    else:
        print(f"⚠️ uploads 目录不存在：{_uploads_base}")

    datasets_base = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "datasets")
    if os.path.exists(datasets_base):
        app.mount("/datasets", StaticFiles(directory=datasets_base), name="datasets")
    else:
        print(f"⚠️ datasets 目录不存在：{datasets_base}")
    
    return app


app = create_app()
