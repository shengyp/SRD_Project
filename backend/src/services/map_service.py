# 地图/机构/热线业务：机构列表、附近机构、城市、热线
from typing import List, Optional


class MapService:
    """心理机构与热线查询，依赖 PostgreSQL 连接池。"""

    def __init__(self, pg_pool):
        self.pg_pool = pg_pool

    # ==================== 机构相关 ====================

    async def get_institutions(
        self,
        city: Optional[str] = None,
        type_filter: Optional[str] = None,
        district: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
    ) -> tuple:
        """获取机构列表，返回 (data_list, total)。"""
        offset = (page - 1) * limit
        conditions = []
        params = []
        param_idx = 1

        if city:
            conditions.append(f"city = ${param_idx}")
            params.append(city)
            param_idx += 1
        if type_filter:
            conditions.append(f"type = ${param_idx}")
            params.append(type_filter)
            param_idx += 1
        if district:
            conditions.append(f"district = ${param_idx}")
            params.append(district)
            param_idx += 1

        where = " WHERE " + " AND ".join(conditions) if conditions else ""

        query = f"""
            SELECT id, name, type, address, phone, rating, hours,
                   longitude, latitude, city, district, province,
                   data_source, poi_id
            FROM institutions
            {where}
            ORDER BY id
            LIMIT {limit} OFFSET {offset}
        """
        rows = (
            await self.pg_pool.fetch(query, *params)
            if params
            else await self.pg_pool.fetch(query)
        )
        institutions = [dict(r) for r in rows]

        count_query = f"SELECT COUNT(*) as total FROM institutions {where}"
        total = (
            await self.pg_pool.fetchval(count_query, *params)
            if params
            else await self.pg_pool.fetchval(count_query)
        )
        return institutions, total

    async def get_nearby_institutions(
        self,
        longitude: float,
        latitude: float,
        radius_km: float = 10,
        limit: int = 20,
        type_filter: Optional[str] = None,
    ) -> List[dict]:
        """附近机构（PostGIS）。"""
        conditions = []
        params = [longitude, latitude, radius_km * 1000, limit]
        param_idx = 4

        if type_filter:
            conditions.append(f"type = ${param_idx}")
            params.append(type_filter)
            param_idx += 1

        where = " AND " + " AND ".join(conditions) if conditions else ""

        query = f"""
            SELECT id, name, type, address, phone, rating, hours,
                   longitude, latitude, city, district, province,
                   data_source,
                   ST_Distance(
                       location::geography,
                       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                   ) as distance_meters
            FROM institutions
            WHERE ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                $3
            )
            {where}
            ORDER BY distance_meters
            LIMIT $4
        """
        rows = await self.pg_pool.fetch(query, *params)
        result = []
        for r in rows:
            row_dict = dict(r)
            # 转换距离为公里
            if 'distance_meters' in row_dict and row_dict['distance_meters']:
                row_dict['distance_km'] = round(row_dict['distance_meters'] / 1000, 2)
            result.append(row_dict)
        return result

    async def get_institution_by_id(self, institution_id: int) -> Optional[dict]:
        """单个机构详情。"""
        row = await self.pg_pool.fetchrow(
            "SELECT * FROM institutions WHERE id = $1", institution_id
        )
        return dict(row) if row else None

    async def get_institution_by_poi_id(self, poi_id: str) -> Optional[dict]:
        """根据 POI ID 获取机构。"""
        row = await self.pg_pool.fetchrow(
            "SELECT * FROM institutions WHERE poi_id = $1", poi_id
        )
        return dict(row) if row else None

    async def get_cities(self) -> List[dict]:
        """机构涉及城市列表及统计。"""
        rows = await self.pg_pool.fetch("""
            SELECT city, COUNT(*) as count
            FROM institutions
            WHERE city IS NOT NULL AND city != ''
            GROUP BY city
            ORDER BY count DESC, city
        """)
        return [{"name": r["city"], "institution_count": r["count"]} for r in rows]

    async def get_districts(self, city: str) -> List[str]:
        """获取指定城市的区县列表。"""
        rows = await self.pg_pool.fetch(
            """
            SELECT DISTINCT district
            FROM institutions
            WHERE city = $1 AND district IS NOT NULL AND district != ''
            ORDER BY district
            """,
            city,
        )
        return [r["district"] for r in rows if r["district"]]

    async def get_institution_types(self) -> List[str]:
        """获取所有机构类型。"""
        rows = await self.pg_pool.fetch("""
            SELECT DISTINCT type
            FROM institutions
            WHERE type IS NOT NULL AND type != ''
            ORDER BY type
        """)
        return [r["type"] for r in rows if r["type"]]

    async def get_statistics(self) -> dict:
        """获取机构统计信息。"""
        total = await self.pg_pool.fetchval("SELECT COUNT(*) FROM institutions")
        with_location = await self.pg_pool.fetchval(
            "SELECT COUNT(*) FROM institutions WHERE location IS NOT NULL"
        )

        # 按类型统计
        by_type = await self.pg_pool.fetch("""
            SELECT type, COUNT(*) as count
            FROM institutions
            WHERE type IS NOT NULL
            GROUP BY type
            ORDER BY count DESC
        """)

        # 按城市统计（前10）
        by_city = await self.pg_pool.fetch("""
            SELECT city, COUNT(*) as count
            FROM institutions
            WHERE city IS NOT NULL
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """)

        # 按数据来源统计
        by_source = await self.pg_pool.fetch("""
            SELECT data_source, COUNT(*) as count
            FROM institutions
            WHERE data_source IS NOT NULL
            GROUP BY data_source
            ORDER BY count DESC
        """)

        return {
            "total": total,
            "with_location": with_location,
            "without_location": total - with_location,
            "by_type": [{"type": r["type"], "count": r["count"]} for r in by_type],
            "by_city": [{"city": r["city"], "count": r["count"]} for r in by_city],
            "by_source": [{"source": r["data_source"], "count": r["count"]} for r in by_source],
        }

    # ==================== 热线相关 ====================

    async def get_hotlines(
        self,
        region: Optional[str] = None,
        city: Optional[str] = None,
        province: Optional[str] = None,
        hotline_type: Optional[str] = None,
    ) -> List[dict]:
        """热线列表，支持多种筛选。"""
        conditions = []
        params = []
        param_idx = 1

        if region:
            conditions.append(f"region = ${param_idx}")
            params.append(region)
            param_idx += 1
        if city:
            conditions.append(f"(city = ${param_idx} OR province = ${param_idx})")
            params.append(city)
            param_idx += 1
        if province:
            conditions.append(f"(province = ${param_idx} OR city LIKE ${param_idx} || '%')")
            params.append(province)
            param_idx += 1
        if hotline_type:
            conditions.append(f"hotline_type = ${param_idx}")
            params.append(hotline_type)
            param_idx += 1

        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        query = f"SELECT * FROM hotlines {where} ORDER BY region, id"
        rows = await self.pg_pool.fetch(query, *params) if params else await self.pg_pool.fetch(query)
        return [dict(r) for r in rows]

    async def get_national_hotlines(self) -> List[dict]:
        """全国热线。"""
        rows = await self.pg_pool.fetch(
            "SELECT * FROM hotlines WHERE region = '全国' ORDER BY id"
        )
        return [dict(r) for r in rows]

    async def get_local_hotlines(self, city: str) -> List[dict]:
        """地区热线（根据城市获取）。"""
        if not city:
            return []
        rows = await self.pg_pool.fetch(
            "SELECT * FROM hotlines WHERE city = $1 OR province = $1 ORDER BY id LIMIT 10",
            city,
        )
        return [dict(r) for r in rows]

    async def get_hotline_by_id(self, hotline_id: int) -> Optional[dict]:
        """根据 ID 获取热线详情。"""
        row = await self.pg_pool.fetchrow(
            "SELECT * FROM hotlines WHERE id = $1", hotline_id
        )
        return dict(row) if row else None

    async def get_hotline_by_number(self, hotline: str) -> Optional[dict]:
        """根据号码获取热线详情。"""
        row = await self.pg_pool.fetchrow(
            "SELECT * FROM hotlines WHERE hotline = $1", hotline
        )
        return dict(row) if row else None

    async def get_regions(self) -> List[dict]:
        """获取所有区域及其热线统计。"""
        rows = await self.pg_pool.fetch("""
            SELECT region, COUNT(*) as count
            FROM hotlines
            GROUP BY region
            ORDER BY
                CASE region
                    WHEN '全国' THEN 1
                    WHEN '华北' THEN 2
                    WHEN '华东' THEN 3
                    WHEN '华中' THEN 4
                    WHEN '华南' THEN 5
                    WHEN '西南' THEN 6
                    WHEN '西北' THEN 7
                    ELSE 8
                END
        """)
        return [{"region": r["region"], "count": r["count"]} for r in rows]

    async def get_hotline_statistics(self) -> dict:
        """获取热线统计信息。"""
        total = await self.pg_pool.fetchval("SELECT COUNT(*) FROM hotlines")
        national = await self.pg_pool.fetchval(
            "SELECT COUNT(*) FROM hotlines WHERE region = '全国'"
        )

        regions = await self.pg_pool.fetch("""
            SELECT region, COUNT(*) as count
            FROM hotlines
            GROUP BY region
            ORDER BY count DESC
        """)

        sources = await self.pg_pool.fetch("""
            SELECT source, COUNT(*) as count
            FROM hotlines
            WHERE source IS NOT NULL
            GROUP BY source
            ORDER BY count DESC
        """)

        return {
            "total": total,
            "national": national,
            "regional": total - national,
            "by_region": [{"region": r["region"], "count": r["count"]} for r in regions],
            "by_source": [{"source": r["source"], "count": r["count"]} for r in sources],
        }

    async def get_city_coordinates(self) -> dict:
        """获取各城市中心坐标（基于机构位置的平均值）。"""
        rows = await self.pg_pool.fetch("""
            SELECT city,
                   ROUND(AVG(longitude)::numeric, 6) as longitude,
                   ROUND(AVG(latitude)::numeric, 6) as latitude
            FROM institutions
            WHERE city IS NOT NULL AND city != ''
              AND longitude IS NOT NULL
              AND latitude IS NOT NULL
            GROUP BY city
            ORDER BY city
        """)
        result = {}
        for r in rows:
            result[r["city"]] = [float(r["longitude"]), float(r["latitude"])]
        return result
