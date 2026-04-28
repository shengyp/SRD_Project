# 首页统计路由：直接从 CSV 文件读取统计，不依赖数据库
from fastapi import APIRouter, Query, HTTPException, Request
from src.services.dataset_csv_service import DatasetCSVService

router = APIRouter(prefix="", tags=["home"])


def _get_user_service(request: Request):
    return request.app.state.user_service


def _get_dataset_service(request: Request):
    return request.app.state.dataset_service


def _get_home_service(request: Request):
    return request.app.state.home_service


def _get_csv_service(request: Request) -> DatasetCSVService:
    if not hasattr(request.app.state, "dataset_csv_service"):
        request.app.state.dataset_csv_service = DatasetCSVService()
    return request.app.state.dataset_csv_service


@router.get("/api/home/cards")
async def get_home_cards(request: Request):
    """获取首页功能卡片列表"""
    home_svc = _get_home_service(request)

    try:
        cards = await home_svc.get_home_cards()
        return {
            "success": True,
            "data": cards
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/home/stats")
async def get_home_stats(
    request: Request,
    force_refresh: bool = Query(False, description="强制刷新缓存")
):
    """获取首页统计数据：从数据库读取，fallback 到 CSV。

    返回格式：
    - knowledgeBaseDocs: 知识库文档数
    - totalArchives: 心理档案总数（用户数）
    - totalPosts: 贴文总数
    - totalScales: 量表评估次数
    - reportsGenerated: 生成的报告数
    - riskDistribution: 风险分布
    """
    home_svc = _get_home_service(request)
    csv_svc = _get_csv_service(request)

    try:
        # 1. 先尝试从数据库获取统计
        stats = await home_svc.get_home_stats(force_refresh=force_refresh)
        core_stats = stats.get("core_stats", [])

        # 如果 core_stats 为空，说明表没有初始化数据，fallback 到 CSV
        if not core_stats:
            raise ValueError("数据库统计表为空，fallback 到 CSV")

        stat_map = {s.get("key"): s.get("value", 0) for s in core_stats}
        risk_dist = stats.get("risk_distribution", {
            "low": {"count": 0, "percentage": 0},
            "medium": {"count": 0, "percentage": 0},
            "high": {"count": 0, "percentage": 0}
        })

        return {
            "success": True,
            "data": {
                "knowledgeBaseDocs": stat_map.get("knowledge_base_docs", 0),
                "totalArchives": stat_map.get("total_archives", 0),
                "totalPosts": stat_map.get("total_posts", 0),
                "totalScales": stat_map.get("total_scales", 0),
                "reportsGenerated": stat_map.get("reports_generated", 0),
                "totalUsers": stat_map.get("total_archives", 0),
                "riskDistribution": risk_dist,
            }
        }
    except Exception:
        # Fallback: 从 CSV 读取统计数据
        try:
            reddit_info = csv_svc.get_dataset_info("reddit")
            if not reddit_info:
                return {
                    "success": True,
                    "data": {
                        "knowledgeBaseDocs": 0,
                        "totalArchives": 0,
                        "totalPosts": 0,
                        "totalScales": 0,
                        "reportsGenerated": 0,
                        "riskDistribution": {
                            "low": {"count": 0, "percentage": 0.0},
                            "medium": {"count": 0, "percentage": 0.0},
                            "high": {"count": 0, "percentage": 0.0}
                        },
                        "totalUsers": 0,
                    }
                }

            # 从 CSV 获取档案并计算风险分布
            archives, _ = csv_svc.get_archives_page(dataset_key="reddit", page=1, page_size=500)

            risk_distribution = {
                "low": {"count": 0, "percentage": 0.0},
                "medium": {"count": 0, "percentage": 0.0},
                "high": {"count": 0, "percentage": 0.0}
            }

            for archive in archives:
                level = archive.risk_level
                if level == "low":
                    risk_distribution["low"]["count"] += 1
                elif level == "medium":
                    risk_distribution["medium"]["count"] += 1
                elif level == "high":
                    risk_distribution["high"]["count"] += 1

            total = len(archives)
            for key in risk_distribution:
                if total > 0:
                    risk_distribution[key]["percentage"] = round(risk_distribution[key]["count"] / total * 100, 1)

            return {
                "success": True,
                "data": {
                    "knowledgeBaseDocs": 0,  # CSV 模式下无法获取知识库文档数
                    "totalArchives": total,
                    "totalPosts": sum(a.post_count for a in archives),
                    "totalScales": 0,  # CSV 模式下无法获取量表数
                    "reportsGenerated": 0,  # CSV 模式下无法获取报告数
                    "riskDistribution": risk_distribution,
                    "totalUsers": total,
                }
            }
        except Exception:
            # 最后兜底：返回默认值
            return {
                "success": True,
                "data": {
                    "knowledgeBaseDocs": 0,
                    "totalArchives": 0,
                    "totalPosts": 0,
                    "totalScales": 0,
                    "reportsGenerated": 0,
                    "riskDistribution": {
                        "low": {"count": 0, "percentage": 0.0},
                        "medium": {"count": 0, "percentage": 0.0},
                        "high": {"count": 0, "percentage": 0.0}
                    },
                    "totalUsers": 0,
                }
            }


@router.get("/api/home/overview")
async def get_home_overview(request: Request):
    """获取首页概览数据（简化版）：直接从 CSV 读取"""
    csv_svc = _get_csv_service(request)

    try:
        datasets = csv_svc.list_dataset_csvs()
        total_users = sum(d.get("totalUsers", 0) for d in datasets)

        return {
            "success": True,
            "data": {
                "totalUsers": total_users,
                "totalDatasets": len(datasets),
                "highRiskUsers": 0,
                "recentAssessments": []
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/home/trend")
async def get_home_trend(
    request: Request,
    days: int = Query(default=30, ge=1, le=365, description="趋势天数，默认 30 天")
):
    """获取首页趋势数据"""
    home_svc = _get_home_service(request)

    try:
        trend_data = await home_svc.get_home_trend(days=days)
        return {
            "success": True,
            "code": 200,
            "data": trend_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/home/refresh-stats")
async def refresh_stats(request: Request):
    """刷新首页统计数据缓存"""
    csv_svc = _get_csv_service(request)
    home_svc = _get_home_service(request)

    csv_svc.clear_cache()  # 清除 CSV 服务缓存

    # 强制刷新 home_service 的缓存
    stats = await home_svc.get_home_stats(force_refresh=True)

    return {
        "success": True,
        "data": {
            "totalArchives": stats.get("total_archives", 0),
            "riskDistribution": stats.get("risk_distribution", {}),
        }
    }
