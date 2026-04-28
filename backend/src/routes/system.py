# 系统配置路由：获取前端静态配置数据
# 包括：知识库关键词等
from fastapi import APIRouter, Query, HTTPException, Request
from typing import Optional

router = APIRouter(prefix="", tags=["system"])


@router.get("/api/keywords")
async def get_knowledge_keywords(
    request: Request,
    is_hot: Optional[bool] = Query(None, description="是否热门关键词"),
):
    """获取知识库关键词列表

    用于前端 KnowledgeBasePage.tsx 的关键词标签显示。

    返回格式:
    [
      {"keyword": "高危信号", "category": "风险", "color_class": "bg-red-100 text-red-700", "is_hot": true, ...},
      ...
    ]
    """
    scale_svc = _get_scale_service(request)

    keywords = await scale_svc.get_knowledge_keywords(is_hot=is_hot)

    return {
        "success": True,
        "data": keywords
    }
