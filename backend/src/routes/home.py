from fastapi import APIRouter, Query, HTTPException, Request

router = APIRouter(prefix="", tags=["home"])


def _get_home_service(request: Request):
    return request.app.state.home_service


def _get_dataset_service(request: Request):
    return request.app.state.dataset_service


@router.get("/api/home/cards")
async def get_home_cards(request: Request):
    home_svc = _get_home_service(request)
    try:
        cards = await home_svc.get_home_cards()
        return {"success": True, "data": cards}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/home/stats")
async def get_home_stats(
    request: Request,
    force_refresh: bool = Query(False, description="强制刷新缓存")
):
    """获取首页统计数据，仅从数据库读取。"""
    home_svc = _get_home_service(request)
    try:
        stats = await home_svc.get_home_stats(force_refresh=force_refresh)
        core_stats = stats.get("core_stats", [])
        stat_map = {s.get("key"): s.get("value", 0) for s in core_stats}
        risk_dist = stats.get("risk_distribution", {
            "low": {"count": 0, "percentage": 0},
            "medium": {"count": 0, "percentage": 0},
            "high": {"count": 0, "percentage": 0},
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/home/overview")
async def get_home_overview(request: Request):
    """获取首页概览数据，仅从数据库读取。"""
    home_svc = _get_home_service(request)
    dataset_svc = _get_dataset_service(request)
    try:
        stats = await home_svc.get_home_stats(force_refresh=False)
        datasets = await dataset_svc.get_datasets()
        core_stats = stats.get("core_stats", [])
        stat_map = {s.get("key"): s.get("value", 0) for s in core_stats}
        risk_dist = stats.get("risk_distribution", {})
        high_risk = risk_dist.get("high", {}).get("count", 0)
        return {
            "success": True,
            "data": {
                "totalUsers": stat_map.get("total_archives", 0),
                "totalDatasets": len(datasets),
                "highRiskUsers": high_risk,
                "recentAssessments": [],
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/home/trend")
async def get_home_trend(
    request: Request,
    days: int = Query(default=30, ge=1, le=365, description="趋势天数，默认 30 天")
):
    home_svc = _get_home_service(request)
    try:
        trend_data = await home_svc.get_home_trend(days=days)
        return {"success": True, "code": 200, "data": trend_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/home/refresh-stats")
async def refresh_stats(request: Request):
    """刷新首页统计数据缓存，仅刷新数据库统计。"""
    home_svc = _get_home_service(request)
    stats = await home_svc.get_home_stats(force_refresh=True)
    return {
        "success": True,
        "data": {
            "totalArchives": next((item.get("value", 0) for item in stats.get("core_stats", []) if item.get("key") == "total_archives"), 0),
            "riskDistribution": stats.get("risk_distribution", {}),
        }
    }
