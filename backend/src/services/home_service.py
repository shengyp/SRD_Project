# 首页统计服务：从 homepage_summary_stats 表获取首页数据，从 CSV 读取内置数据集统计
import aiomysql
from datetime import datetime
from typing import List, Dict, Any, Optional
from src.services.dataset_csv_service import DatasetCSVService


class HomeService:
    """首页统计服务，依赖 MySQL 连接池和 CSV 文件读取。

    设计原则：
    - 读取优先：从 homepage_summary_stats 表读取已缓存的统计数据
    - 内置数据集统计从 datasets/ CSV 文件计算
    - Graceful degradation：表不存在或查询失败时返回空数据
    """

    # 缓存过期阈值（小时）
    CACHE_EXPIRE_HOURS = 1

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool
        self._csv_svc: Optional[DatasetCSVService] = None

    def _get_csv_service(self) -> DatasetCSVService:
        if self._csv_svc is None:
            self._csv_svc = DatasetCSVService()
        return self._csv_svc

    async def _is_cache_stale(self) -> bool:
        """检查 homepage_summary_stats 表的缓存是否过期。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                try:
                    await cursor.execute("""
                        SELECT MAX(updated_at) AS latest
                        FROM homepage_summary_stats
                        LIMIT 1
                    """)
                    row = await cursor.fetchone()
                    if not row or not row["latest"]:
                        return True
                    latest: datetime = row["latest"]
                    age_hours = (datetime.now() - latest).total_seconds() / 3600
                    return age_hours > self.CACHE_EXPIRE_HOURS
                except Exception:
                    return True

    async def _refresh_cache(self) -> None:
        """从业务表实时计算统计数据并写入 homepage_summary_stats 表。

        使用单连接执行所有操作，避免连接池死锁。
        内置数据集统计从 datasets/ CSV 文件计算。
        """
        csv_svc = self._get_csv_service()

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SET NAMES utf8mb4")

                # 1. 总档案数 = psychological_archives (仅自定义导入) + CSV 内置数据集
                # 注意：内置数据集（reddit等）在数据库中可能有重复数据，需排除
                csv_archives = csv_svc.list_dataset_csvs()
                csv_total_users = sum(ds.get("totalUsers", 0) for ds in csv_archives)
                
                # 获取内置数据集key列表，用于排除重复数据
                builtin_keys = list(DatasetCSVService.DATASET_CONFIG.keys())
                builtin_placeholders = ','.join(['%s'] * len(builtin_keys)) if builtin_keys else "'__none__'"
                
                try:
                    # 只统计自定义导入的档案，不统计内置数据集的重复数据
                    if builtin_keys:
                        sql = f"SELECT COUNT(*) AS cnt FROM psychological_archives WHERE dataset_source NOT IN ({builtin_placeholders})"
                        await cur.execute(sql, builtin_keys)
                    else:
                        await cur.execute("SELECT COUNT(*) AS cnt FROM psychological_archives")
                    r = await cur.fetchone()
                    db_archives = int(r["cnt"]) if r else 0
                except Exception:
                    db_archives = 0

                total_archives = csv_total_users + db_archives

                # 1.5 帖子总数 = psychological_archives 的 post_count + CSV 内置数据集的帖子数
                csv_total_posts = sum(ds.get("totalPosts", 0) for ds in csv_archives)
                try:
                    # 只统计自定义导入的档案的帖子数
                    if builtin_keys:
                        sql = f"SELECT COALESCE(SUM(post_count), 0) AS cnt FROM psychological_archives WHERE dataset_source NOT IN ({builtin_placeholders})"
                        await cur.execute(sql, builtin_keys)
                    else:
                        await cur.execute("SELECT COALESCE(SUM(post_count), 0) AS cnt FROM psychological_archives")
                    r = await cur.fetchone()
                    db_posts = int(r["cnt"]) if r else 0
                except Exception:
                    db_posts = 0
                total_posts = csv_total_posts + db_posts

                # 2. 已完成量表任务数
                try:
                    await cur.execute(
                        "SELECT COUNT(*) AS cnt FROM scale_tasks WHERE status = 'completed'"
                    )
                    r = await cur.fetchone()
                    total_scales = int(r["cnt"]) if r else 0
                except Exception:
                    total_scales = 0

                # 3. 已完成风险检测任务数
                try:
                    await cur.execute(
                        "SELECT COUNT(*) AS cnt FROM risk_detection_tasks WHERE status = 'completed'"
                    )
                    r = await cur.fetchone()
                    reports_generated = int(r["cnt"]) if r else 0
                except Exception:
                    reports_generated = 0

                # 4. 知识库文档数
                try:
                    await cur.execute(
                        "SELECT COUNT(*) AS cnt FROM knowledge_documents "
                        "WHERE upload_status = 'uploaded' AND is_deleted = FALSE"
                    )
                    r = await cur.fetchone()
                    knowledge_docs = int(r["cnt"]) if r else 0
                except Exception:
                    knowledge_docs = 0

                # 5. 风险分布 = psychological_archives + CSV 内置数据集
                risk_dist = {"low": 0, "medium": 0, "high": 0}
                for ds in csv_archives:
                    dataset_key = ds.get("datasetKey")
                    if not dataset_key:
                        continue
                    # 从 CSV 服务获取该数据集的实际风险分布
                    try:
                        coarse_map = ds.get("coarseRiskMapping", {})
                        # 反转 mapping: fine_value -> coarse_level
                        reverse_map: Dict[str, str] = {}
                        for fine_val, coarse_level in coarse_map.items():
                            reverse_map[fine_val] = coarse_level

                        # 获取该数据集的所有档案并统计风险分布
                        archives, total = csv_svc.get_archives_page(dataset_key=dataset_key, page_size=10000)
                        print(f"[DEBUG] CSV dataset={dataset_key}, total_archives={total}, fetched={len(archives)}")
                        for archive in archives:
                            # archive.risk_level 已经是 coarse 级别 (low/medium/high)
                            coarse = archive.risk_level
                            if coarse in risk_dist:
                                risk_dist[coarse] += 1
                        print(f"[DEBUG] risk_dist after {dataset_key}: {risk_dist}")
                    except Exception as e:
                        import traceback
                        print(f"[ERROR] Failed to get risk distribution for {dataset_key}: {e}")
                        traceback.print_exc()
                        pass
                print(f"[DEBUG] Final risk_dist: {risk_dist}")

                # 风险分布：仅添加自定义导入档案的风险数据，排除内置数据集的重复数据
                try:
                    if builtin_keys:
                        sql = f"""
                            SELECT COALESCE(risk_level, 'unknown') AS level, COUNT(*) AS cnt
                            FROM psychological_archives
                            WHERE dataset_source NOT IN ({builtin_placeholders})
                            GROUP BY risk_level
                        """
                        await cur.execute(sql, builtin_keys)
                    else:
                        await cur.execute("""
                            SELECT COALESCE(risk_level, 'unknown') AS level, COUNT(*) AS cnt
                            FROM psychological_archives
                            GROUP BY risk_level
                        """)
                    rows = await cur.fetchall()
                    for row in rows:
                        level = str(row["level"]).lower()
                        if level in risk_dist:
                            risk_dist[level] += int(row["cnt"])
                except Exception:
                    pass

            # 6. 计算百分比
            total = sum(risk_dist.values())
            risk_pct = {
                k: round(v / total * 100, 1) if total > 0 else 0.0
                for k, v in risk_dist.items()
            }

            # 7. 批量更新 stat_value
            stat_map = {
                "knowledge_base_docs": knowledge_docs,
                "total_archives": total_archives,
                "total_posts": total_posts,
                "total_scales": total_scales,
                "reports_generated": reports_generated,
                "risk_low_count": risk_dist["low"],
                "risk_low_percentage": int(risk_pct["low"]),
                "risk_medium_count": risk_dist["medium"],
                "risk_medium_percentage": int(risk_pct["medium"]),
                "risk_high_count": risk_dist["high"],
                "risk_high_percentage": int(risk_pct["high"]),
            }

            async with conn.cursor() as cur:
                await cur.execute("SET NAMES utf8mb4")
                for stat_key, stat_value in stat_map.items():
                    await cur.execute("""
                        UPDATE homepage_summary_stats
                        SET stat_value = %s, updated_at = NOW()
                        WHERE stat_key = %s
                    """, (stat_value, stat_key))
                await conn.commit()

    async def get_home_stats(self, force_refresh: bool = False) -> Dict[str, Any]:
        """获取首页统计数据。"""
        if not force_refresh and not await self._is_cache_stale():
            return await self._read_stats_from_table()

        try:
            await self._refresh_cache()
        except Exception:
            pass

        return await self._read_stats_from_table()

    async def _read_stats_from_table(self) -> Dict[str, Any]:
        """从 homepage_summary_stats 表读取统计数据并规范化。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "SELECT stat_key, stat_label, stat_value, stat_unit, "
                    "stat_icon, stat_color, stat_type, stat_category "
                    "FROM homepage_summary_stats ORDER BY stat_order"
                )
                rows = await cursor.fetchall()

        result = {
            "core_stats": [],
            "risk_distribution": {
                "low": {"count": 0, "percentage": 0},
                "medium": {"count": 0, "percentage": 0},
                "high": {"count": 0, "percentage": 0}
            },
            "all_stats": []
        }

        for row in rows:
            stat = {
                "key": row["stat_key"],
                "label": row["stat_label"],
                "value": row["stat_value"],
                "unit": row["stat_unit"],
                "icon": row["stat_icon"],
                "color": row["stat_color"],
                "type": row["stat_type"]
            }
            result["all_stats"].append(stat)

            category = row["stat_category"]
            stat_key = row["stat_key"]
            stat_value = row["stat_value"]

            if category == "core_stats":
                result["core_stats"].append(stat)
            elif category == "risk_distribution":
                if "low" in stat_key:
                    if "count" in stat_key:
                        result["risk_distribution"]["low"]["count"] = stat_value
                    elif "percentage" in stat_key:
                        result["risk_distribution"]["low"]["percentage"] = stat_value
                elif "medium" in stat_key:
                    if "count" in stat_key:
                        result["risk_distribution"]["medium"]["count"] = stat_value
                    elif "percentage" in stat_key:
                        result["risk_distribution"]["medium"]["percentage"] = stat_value
                elif "high" in stat_key:
                    if "count" in stat_key:
                        result["risk_distribution"]["high"]["count"] = stat_value
                    elif "percentage" in stat_key:
                        result["risk_distribution"]["high"]["percentage"] = stat_value

        return result

    async def get_summary_cards(self) -> List[Dict[str, Any]]:
        """获取首页统计卡片"""
        stats = await self.get_home_stats()
        return stats.get("core_stats", [])

    async def get_risk_distribution(self) -> Dict[str, Any]:
        """获取风险分布数据"""
        stats = await self.get_home_stats()
        return stats.get("risk_distribution", {
            "low": {"count": 0, "percentage": 0},
            "medium": {"count": 0, "percentage": 0},
            "high": {"count": 0, "percentage": 0}
        })

    async def get_home_cards(self) -> List[Dict[str, Any]]:
        """获取首页功能卡片列表，从 app_homepage_cards 表读取。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                try:
                    await cursor.execute("SET NAMES utf8mb4")
                    await cursor.execute("""
                        SELECT
                            id,
                            card_key AS cardKey,
                            card_label AS cardLabel,
                            card_icon AS cardIcon,
                            card_color AS cardColor,
                            card_bg AS cardBg,
                            card_route AS cardRoute,
                            card_description AS cardDescription,
                            card_order AS cardOrder,
                            is_active AS isActive,
                            is_new AS isNew
                        FROM app_homepage_cards
                        WHERE is_active = TRUE
                        ORDER BY card_order ASC
                    """)
                    rows = await cursor.fetchall()
                    return rows
                except Exception:
                    return []

    async def update_stat_value(self, stat_key: str, new_value: int) -> bool:
        """更新统计项值"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "UPDATE homepage_summary_stats SET stat_value = %s WHERE stat_key = %s",
                    (new_value, stat_key)
                )
                await conn.commit()
                return cursor.rowcount > 0

    async def get_home_trend(self, days: int = 30) -> List[Dict[str, Any]]:
        """获取首页趋势数据：按日期统计量表任务、检测任务和风险分布

        数据来源：
        - scale_tasks 表（量表提交趋势）
        - risk_detection_tasks 表（检测任务趋势）
        - psychological_archives 表（风险分布趋势）

        参数:
            days: 趋势天数，默认 30 天

        返回:
            按日期升序排列的趋势数据列表
        """
        result: List[Dict[str, Any]] = []

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                try:
                    await cursor.execute(
                        f"""
                        SELECT
                            DATE(created_at) AS date,
                            COUNT(*) AS scaleCount
                        FROM scale_tasks
                        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                          AND status = 'completed'
                        GROUP BY DATE(created_at)
                        ORDER BY date ASC
                        """,
                        (days,)
                    )
                    scale_rows = await cursor.fetchall()
                except Exception:
                    scale_rows = []

                try:
                    await cursor.execute(
                        f"""
                        SELECT
                            DATE(created_at) AS date,
                            COUNT(*) AS detectionCount
                        FROM risk_detection_tasks
                        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                          AND status = 'completed'
                        GROUP BY DATE(created_at)
                        ORDER BY date ASC
                        """,
                        (days,)
                    )
                    detection_rows = await cursor.fetchall()
                except Exception:
                    detection_rows = []

                try:
                    await cursor.execute(
                        f"""
                        SELECT
                            DATE(import_timestamp) AS date,
                            risk_level,
                            COUNT(*) AS cnt
                        FROM psychological_archives
                        WHERE import_timestamp >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                        GROUP BY DATE(import_timestamp), risk_level
                        ORDER BY date ASC
                        """,
                        (days,)
                    )
                    risk_rows = await cursor.fetchall()
                except Exception:
                    risk_rows = []

        # 构建日期映射
        date_map: Dict[str, Dict[str, Any]] = {}

        for row in scale_rows:
            d = str(row["date"])
            if d not in date_map:
                date_map[d] = {"date": d, "scaleCount": 0, "detectionCount": 0,
                               "riskLow": 0, "riskMedium": 0, "riskHigh": 0}
            date_map[d]["scaleCount"] = int(row["scaleCount"])

        for row in detection_rows:
            d = str(row["date"])
            if d not in date_map:
                date_map[d] = {"date": d, "scaleCount": 0, "detectionCount": 0,
                               "riskLow": 0, "riskMedium": 0, "riskHigh": 0}
            date_map[d]["detectionCount"] = int(row["detectionCount"])

        risk_level_map = {
            "low": "riskLow",
            "medium": "riskMedium",
            "high": "riskHigh",
            "risk_low": "riskLow",
            "risk_medium": "riskMedium",
            "risk_high": "riskHigh",
        }
        for row in risk_rows:
            d = str(row["date"])
            if d not in date_map:
                date_map[d] = {"date": d, "scaleCount": 0, "detectionCount": 0,
                               "riskLow": 0, "riskMedium": 0, "riskHigh": 0}
            level_key = risk_level_map.get(str(row["risk_level"]).lower())
            if level_key:
                date_map[d][level_key] = int(row["cnt"])

        # 按日期升序排列
        result = [date_map[d] for d in sorted(date_map.keys())]
        return result
