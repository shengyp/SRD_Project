# 心理援助地图 API 路由
from fastapi import APIRouter, Query, HTTPException, Request
from typing import Optional
from src.models import (
    Institution,
    InstitutionListResponse,
    HotlineListResponse,
    Hotline,
    CityListResponse,
)

router = APIRouter(prefix="/api", tags=["心理援助地图"])


def _get_map_service(request: Request):
    return request.app.state.map_service


# ==================== 机构相关接口 ====================

@router.get("/institutions", response_model=InstitutionListResponse)
async def get_institutions(
    request: Request,
    city: Optional[str] = Query(None, description="城市名称"),
    type: Optional[str] = Query(None, alias="type", description="机构类型"),
    district: Optional[str] = Query(None, description="区县"),
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(20, ge=1, le=10000, description="每页数量"),
):
    """获取心理机构列表"""
    svc = _get_map_service(request)
    data, total = await svc.get_institutions(
        city=city,
        type_filter=type,
        district=district,
        page=page,
        limit=limit,
    )
    return {
        "success": True,
        "data": data,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit if limit else 0,
        },
    }


@router.get("/institutions/nearby")
async def get_nearby_institutions(
    request: Request,
    lat: Optional[float] = Query(None, description="纬度 (别名)"),
    lng: Optional[float] = Query(None, description="经度 (别名)"),
    latitude: Optional[float] = Query(None, description="纬度"),
    longitude: Optional[float] = Query(None, description="经度"),
    radius_km: float = Query(10, description="搜索半径(公里)"),
    type: Optional[str] = Query(None, alias="type", description="机构类型"),
    limit: int = Query(20, ge=1, le=100, description="返回数量"),
):
    """获取附近机构（兼容 lat/lng 和 latitude/longitude 两种参数名）"""
    lat_val = lat if lat is not None else latitude
    lng_val = lng if lng is not None else longitude

    if lat_val is None or lng_val is None:
        raise HTTPException(
            status_code=400,
            detail="缺少坐标参数：请提供 lat+lng 或 latitude+longitude"
        )

    svc = _get_map_service(request)
    data = await svc.get_nearby_institutions(
        longitude=lng_val,
        latitude=lat_val,
        radius_km=radius_km,
        limit=limit,
        type_filter=type,
    )
    return {
        "success": True,
        "data": data,
        "pagination": {
            "page": 1,
            "limit": limit,
            "total": len(data),
            "totalPages": 1,
        },
    }


@router.get("/institutions/{institution_id}")
async def get_institution(request: Request, institution_id: int):
    """获取机构详情"""
    svc = _get_map_service(request)
    inst = await svc.get_institution_by_id(institution_id)
    if not inst:
        raise HTTPException(status_code=404, detail="机构不存在")
    return {"success": True, "data": inst}


@router.get("/institutions/poi/{poi_id}")
async def get_institution_by_poi(request: Request, poi_id: str):
    """根据 POI ID 获取机构"""
    svc = _get_map_service(request)
    inst = await svc.get_institution_by_poi_id(poi_id)
    if not inst:
        raise HTTPException(status_code=404, detail="机构不存在")
    return {"success": True, "data": inst}


@router.get("/cities", response_model=CityListResponse)
async def get_cities(request: Request):
    """获取城市列表"""
    svc = _get_map_service(request)
    data = await svc.get_cities()
    return {"success": True, "data": data}


@router.get("/districts")
async def get_districts(request: Request, city: str = Query(..., description="城市名称")):
    """获取区县列表"""
    svc = _get_map_service(request)
    data = await svc.get_districts(city)
    return {"success": True, "data": data}


@router.get("/institution-types")
async def get_institution_types(request: Request):
    """获取机构类型列表"""
    svc = _get_map_service(request)
    data = await svc.get_institution_types()
    return {"success": True, "data": data}


@router.get("/institutions/statistics")
async def get_institution_statistics(request: Request):
    """获取机构统计信息"""
    svc = _get_map_service(request)
    data = await svc.get_statistics()
    return {"success": True, "data": data}


@router.get("/cities/coordinates")
async def get_city_coordinates(request: Request):
    """获取城市中心坐标映射（城市名 -> [经度, 纬度]）"""
    svc = _get_map_service(request)
    data = await svc.get_city_coordinates()
    return {"success": True, "data": data}


@router.get("/ip-location")
async def get_ip_location(request: Request):
    """
    通过用户 IP 获取地理位置信息（城市、经纬度）
    后端调用高德 Web 服务 API，绕过前端 HTTP 协议的定位限制
    
    优先尝试多种定位方式：
    1. 高德 IP 定位 API（有 AMAP_WEB_SERVICE_KEY 时）
    2. 免费 IP 定位服务（备用）
    3. 默认返回重庆（兜底）
    """
    import httpx
    import os
    
    # 获取用户真实 IP（支持代理场景）
    # 优先从 X-Forwarded-For 获取（如果存在）
    x_forwarded_for = request.headers.get("X-Forwarded-For")
    if x_forwarded_for:
        # X-Forwarded-For 可能包含多个 IP，取第一个（最原始的客户端 IP）
        client_ip = x_forwarded_for.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "127.0.0.1"
    
    # 检查是否为内网 IP
    private_ip_prefixes = ["10.", "172.", "192.", "127.", "::1", "0.0.0.0"]
    is_private = any(client_ip.startswith(prefix) for prefix in private_ip_prefixes)
    
    # 如果是内网 IP，从 X-Real-IP 或 X-Forwarded-For 获取真实 IP
    if is_private:
        # 尝试从其他 header 获取真实 IP（通常是 Nginx/代理设置的）
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            client_ip = real_ip.split(",")[0].strip()
            # 再次检查是否是内网 IP
            is_private = any(client_ip.startswith(prefix) for prefix in private_ip_prefixes)
    
    # 如果仍然是内网 IP，说明无法获取真实客户端 IP，定位会不准确
    # 不再使用硬编码 IP，而是让后续的定位服务处理
    
    # 获取高德 API Key
    amap_key = os.environ.get("AMAP_WEB_SERVICE_KEY") or os.environ.get("AMAP_KEY", "")
    
    # 尝试方式1：使用高德 IP 定位 API
    if amap_key:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                url = "https://restapi.amap.com/v3/ip"
                params = {
                    "key": amap_key,
                    "ip": client_ip
                }
                resp = await client.get(url, params=params)
                data = resp.json()
                
                if data.get("status") == "1" and data.get("province"):
                    province = data.get("province", "")
                    city = data.get("city", province)
                    adcode = data.get("adcode", "")
                    
                    # 获取城市中心坐标
                    coords = await _get_city_center_coords(city, amap_key)
                    
                    return {
                        "success": True,
                        "data": {
                            "city": city,
                            "province": province,
                            "adcode": adcode,
                            "longitude": coords.get("lng", 116.4074),
                            "latitude": coords.get("lat", 39.9042),
                            "formattedAddress": f"{province}{city}",
                            "source": "amap"
                        }
                    }
        except Exception as e:
            print(f"高德 IP 定位失败: {e}")
    
    # 尝试方式2：使用 ip-api.com 免费服务（国内也能用）
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 使用批量查询模式
            resp = await client.get(
                f"http://ip-api.com/json/{client_ip}?fields=status,country,regionName,city,lat,lon,query"
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    city = data.get("city", "")
                    province = data.get("regionName", "")
                    lat = data.get("lat", 0)
                    lon = data.get("lon", 0)
                    
                    # 尝试转换城市名（中文）
                    city_mapping = _get_chinese_city_name(city, province)
                    
                    return {
                        "success": True,
                        "data": {
                            "city": city_mapping.get("city", city) or "重庆市",
                            "province": city_mapping.get("province", province) or "重庆市",
                            "adcode": "",
                            "longitude": lon,
                            "latitude": lat,
                            "formattedAddress": f"{province}{city}",
                            "source": "ip-api"
                        }
                    }
    except Exception as e:
        print(f"ip-api.com 定位失败: {e}")
    
    # 尝试方式3：使用 ipinfo.io（备用）
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://ipinfo.io/{client_ip}/json"
            )
            if resp.status_code == 200:
                data = resp.json()
                if "loc" in data:
                    loc = data.get("loc", "").split(",")
                    if len(loc) == 2:
                        lat = float(loc[0])
                        lon = float(loc[1])
                        city = data.get("city", "")
                        region = data.get("region", "")
                        
                        # 尝试转换城市名（英文转中文）
                        city_mapping = _get_chinese_city_name(city, region)
                        
                        return {
                            "success": True,
                            "data": {
                                "city": city_mapping.get("city", city) or "重庆市",
                                "province": city_mapping.get("province", region) or "重庆市",
                                "adcode": "",
                                "longitude": lon,
                                "latitude": lat,
                                "formattedAddress": f"{region}{city}",
                                "source": "ipinfo"
                            }
                        }
    except Exception as e:
        print(f"ipinfo.io 定位失败: {e}")
    
    # 方式4：使用浏览器语言/时区进行猜测定位（不精确但可用）
    accept_language = request.headers.get("Accept-Language", "")
    if "zh-CN" in accept_language or "zh" in accept_language:
        # 使用默认城市（中国用户）
        return {
            "success": True,
            "data": {
                "city": "重庆市",
                "province": "重庆市",
                "adcode": "500000",
                "longitude": 106.5516,
                "latitude": 29.5630,
                "formattedAddress": "重庆市",
                "source": "default-cn"
            }
        }
    
    # 最终兜底：返回默认位置（重庆）
    return {
        "success": True,
        "data": {
            "city": "重庆市",
            "province": "重庆市",
            "adcode": "500000",
            "longitude": 106.5516,
            "latitude": 29.5630,
            "formattedAddress": "重庆市",
            "source": "default"
        }
    }


@router.get("/geocode/reverse")
async def reverse_geocode(
    request: Request,
    lat: float = Query(..., description="纬度"),
    lng: float = Query(..., description="经度"),
):
    """
    逆地理编码接口：通过经纬度获取详细地址
    后端调用高德 Web 服务 API，绕过前端对 amap.com 的网络限制
    
    Returns:
        成功时返回结构化地址信息
    """
    import httpx
    import os
    
    # 验证坐标范围（中国区域大致范围）
    if not (15 <= lat <= 60 and 70 <= lng <= 140):
        raise HTTPException(
            status_code=400,
            detail="坐标超出中国范围"
        )
    
    # 获取高德 API Key
    amap_key = os.environ.get("AMAP_WEB_SERVICE_KEY") or os.environ.get("AMAP_KEY", "")
    
    if not amap_key:
        raise HTTPException(
            status_code=500,
            detail="未配置高德地图 API Key"
        )
    
    # 调用高德逆地理编码 API
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = "https://restapi.amap.com/v3/geocode/regeo"
            params = {
                "key": amap_key,
                "location": f"{lng},{lat}",
                "extensions": "all",
                "radius": 1000,
                "output": "JSON"
            }
            resp = await client.get(url, params=params)
            data = resp.json()
            
            if data.get("status") == "1" and data.get("regeocode"):
                regeocode = data["regeocode"]
                address_component = regeocode.get("addressComponent", {})
                formatted_address = regeocode.get("formatted_address", "")
                
                # 解析地址组件
                province = address_component.get("province", "")
                city = address_component.get("city", province)
                district = address_component.get("district", "")
                township = address_component.get("township", "")
                street_number = address_component.get("streetNumber", {})
                street = street_number.get("street", "")
                number = street_number.get("number", "")
                
                # 构建详细地址
                detail_parts = []
                if district:
                    detail_parts.append(district)
                if township:
                    detail_parts.append(township)
                if street:
                    detail_parts.append(street)
                if number:
                    detail_parts.append(number)
                
                short_address = "".join(detail_parts) if detail_parts else city
                
                # 获取最近的 POI（如果存在）
                pois = regeocode.get("pois", [])
                nearest_poi = None
                if pois:
                    # 按距离排序取最近的
                    pois.sort(key=lambda x: float(x.get("distance", "999999")))
                    nearest = pois[0]
                    nearest_poi = {
                        "name": nearest.get("name", ""),
                        "address": nearest.get("address", ""),
                        "distance": nearest.get("distance", "")
                    }
                
                return {
                    "success": True,
                    "data": {
                        "formattedAddress": formatted_address,
                        "shortAddress": short_address,
                        "province": province,
                        "city": city,
                        "district": district,
                        "township": township,
                        "street": street,
                        "streetNumber": number,
                        "location": {"lat": lat, "lng": lng},
                        "nearestPoi": nearest_poi,
                        "source": "amap"
                    }
                }
            else:
                raise HTTPException(
                    status_code=500,
                    detail="逆地理编码失败"
                )
    except HTTPException:
        raise
    except Exception as e:
        print(f"逆地理编码请求失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"逆地理编码请求失败: {str(e)}"
        )


def _get_chinese_city_name(english_city: str, english_region: str = "") -> dict:
    """将英文城市名转换为中文城市名"""
    # 常见城市的中英文映射
    CITY_MAPPING = {
        # 直辖市
        "beijing": {"city": "北京市", "province": "北京"},
        "shanghai": {"city": "上海市", "province": "上海"},
        "tianjin": {"city": "天津市", "province": "天津"},
        "chongqing": {"city": "重庆市", "province": "重庆"},
        
        # 省会城市
        "guangzhou": {"city": "广州市", "province": "广东省"},
        "shenzhen": {"city": "深圳市", "province": "广东省"},
        "chengdu": {"city": "成都市", "province": "四川省"},
        "hangzhou": {"city": "杭州市", "province": "浙江省"},
        "nanjing": {"city": "南京市", "province": "江苏省"},
        "wuhan": {"city": "武汉市", "province": "湖北省"},
        "xian": {"city": "西安市", "province": "陕西省"},
        "changsha": {"city": "长沙市", "province": "湖南省"},
        "zhengzhou": {"city": "郑州市", "province": "河南省"},
        "jinan": {"city": "济南市", "province": "山东省"},
        "qingdao": {"city": "青岛市", "province": "山东省"},
        "dalian": {"city": "大连市", "province": "辽宁省"},
        "shenyang": {"city": "沈阳市", "province": "辽宁省"},
        "harbin": {"city": "哈尔滨市", "province": "黑龙江省"},
        "changchun": {"city": "长春市", "province": "吉林省"},
        "nanchang": {"city": "南昌市", "province": "江西省"},
        "hefei": {"city": "合肥市", "province": "安徽省"},
        "fuzhou": {"city": "福州市", "province": "福建省"},
        "xiamen": {"city": "厦门市", "province": "福建省"},
        "nanning": {"city": "南宁市", "province": "广西壮族自治区"},
        "guiyang": {"city": "贵阳市", "province": "贵州省"},
        "kunming": {"city": "昆明市", "province": "云南省"},
        "lanzhou": {"city": "兰州市", "province": "甘肃省"},
        "xining": {"city": "西宁市", "province": "青海省"},
        "yinchuan": {"city": "银川市", "province": "宁夏回族自治区"},
        "urumqi": {"city": "乌鲁木齐市", "province": "新疆维吾尔自治区"},
        "hohhot": {"city": "呼和浩特市", "province": "内蒙古自治区"},
        "nanchang": {"city": "南昌市", "province": "江西省"},
        "taiyuan": {"city": "太原市", "province": "山西省"},
        "shijiazhuang": {"city": "石家庄市", "province": "河北省"},
        "wuxi": {"city": "无锡市", "province": "江苏省"},
        "suzhou": {"city": "苏州市", "province": "江苏省"},
        "ningbo": {"city": "宁波市", "province": "浙江省"},
        "foshan": {"city": "佛山市", "province": "广东省"},
        "dongguan": {"city": "东莞市", "province": "广东省"},
        "zhuhai": {"city": "珠海市", "province": "广东省"},
        "zhongshan": {"city": "中山市", "province": "广东省"},
        "huizhou": {"city": "惠州市", "province": "广东省"},
        "baoding": {"city": "保定市", "province": "河北省"},
        "tangshan": {"city": "唐山市", "province": "河北省"},
        "luoyang": {"city": "洛阳市", "province": "河南省"},
        "yantai": {"city": "烟台市", "province": "山东省"},
        "weihai": {"city": "威海市", "province": "山东省"},
        "shaoxing": {"city": "绍兴市", "province": "浙江省"},
        "wenzhou": {"city": "温州市", "province": "浙江省"},
        "haikou": {"city": "海口市", "province": "海南省"},
        "sanya": {"city": "三亚市", "province": "海南省"},
        
        # 特别行政区
        "hong kong": {"city": "香港", "province": "香港特别行政区"},
        "macau": {"city": "澳门", "province": "澳门特别行政区"},
        "taipei": {"city": "台北", "province": "台湾省"},
        
        # 省份映射
        "guangdong": {"city": "广州市", "province": "广东省"},
        "sichuan": {"city": "成都市", "province": "四川省"},
        "hubei": {"city": "武汉市", "province": "湖北省"},
        "shaanxi": {"city": "西安市", "province": "陕西省"},
        "jiangsu": {"city": "南京市", "province": "江苏省"},
        "zhejiang": {"city": "杭州市", "province": "浙江省"},
        "hunan": {"city": "长沙市", "province": "湖南省"},
        "henan": {"city": "郑州市", "province": "河南省"},
        "shandong": {"city": "济南市", "province": "山东省"},
        "liaoning": {"city": "沈阳市", "province": "辽宁省"},
        "heilongjiang": {"city": "哈尔滨市", "province": "黑龙江省"},
        "jilin": {"city": "长春市", "province": "吉林省"},
        "jiangxi": {"city": "南昌市", "province": "江西省"},
        "anhui": {"city": "合肥市", "province": "安徽省"},
        "fujian": {"city": "福州市", "province": "福建省"},
        "guangxi": {"city": "南宁市", "province": "广西壮族自治区"},
        "guizhou": {"city": "贵阳市", "province": "贵州省"},
        "yunnan": {"city": "昆明市", "province": "云南省"},
        "gansu": {"city": "兰州市", "province": "甘肃省"},
        "qinghai": {"city": "西宁市", "province": "青海省"},
        "ningxia": {"city": "银川市", "province": "宁夏回族自治区"},
        "xinjiang": {"city": "乌鲁木齐市", "province": "新疆维吾尔自治区"},
        "inner mongolia": {"city": "呼和浩特市", "province": "内蒙古自治区"},
        "shanxi": {"city": "太原市", "province": "山西省"},
        "hebei": {"city": "石家庄市", "province": "河北省"},
        "hainan": {"city": "海口市", "province": "海南省"},
    }
    
    # 标准化输入（小写处理）
    city_lower = english_city.lower().strip()
    region_lower = english_region.lower().strip()
    
    # 先尝试匹配城市名
    if city_lower in CITY_MAPPING:
        return CITY_MAPPING[city_lower]
    
    # 再尝试匹配省份名
    if region_lower in CITY_MAPPING:
        return CITY_MAPPING[region_lower]
    
    # 尝试模糊匹配（包含关系）
    for eng_name, cn_names in CITY_MAPPING.items():
        if eng_name in city_lower or city_lower in eng_name:
            return cn_names
        if eng_name in region_lower or region_lower in eng_name:
            return cn_names
    
    # 无法匹配，返回原始值（使用默认值）
    return {"city": english_city or "重庆市", "province": english_region or "重庆市"}


async def _get_city_center_coords(city_name: str, amap_key: str) -> dict:
    """获取城市中心坐标"""
    import httpx
    
    # 城市坐标映射表（常见城市）
    CITY_COORDS = {
        "北京": {"lng": 116.4074, "lat": 39.9042},
        "北京市": {"lng": 116.4074, "lat": 39.9042},
        "上海": {"lng": 121.4737, "lat": 31.2304},
        "上海市": {"lng": 121.4737, "lat": 31.2304},
        "广州": {"lng": 113.2644, "lat": 23.1291},
        "广州市": {"lng": 113.2644, "lat": 23.1291},
        "深圳": {"lng": 114.3055, "lat": 22.5431},
        "深圳市": {"lng": 114.3055, "lat": 22.5431},
        "成都": {"lng": 104.0665, "lat": 30.5728},
        "成都市": {"lng": 104.0665, "lat": 30.5728},
        "武汉": {"lng": 114.3055, "lat": 30.5928},
        "武汉市": {"lng": 114.3055, "lat": 30.5928},
        "西安": {"lng": 108.9543, "lat": 34.3416},
        "西安市": {"lng": 108.9543, "lat": 34.3416},
        "重庆": {"lng": 106.5516, "lat": 29.5630},
        "重庆市": {"lng": 106.5516, "lat": 29.5630},
        "天津": {"lng": 117.2008, "lat": 39.1256},
        "天津市": {"lng": 117.2008, "lat": 39.1256},
        "杭州": {"lng": 120.1536, "lat": 30.2744},
        "杭州市": {"lng": 120.1536, "lat": 30.2744},
        "南京": {"lng": 118.7969, "lat": 32.0603},
        "南京市": {"lng": 118.7969, "lat": 32.0603},
        "长沙": {"lng": 112.9388, "lat": 28.2282},
        "长沙市": {"lng": 112.9388, "lat": 28.2282},
        "郑州": {"lng": 113.6484, "lat": 34.7566},
        "郑州市": {"lng": 113.6484, "lat": 34.7566},
    }
    
    # 检查本地缓存
    if city_name in CITY_COORDS:
        return CITY_COORDS[city_name]
    
    # 调用高德地理编码 API 获取坐标
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = "https://restapi.amap.com/v3/geocode/geo"
            params = {
                "key": amap_key,
                "address": city_name,
                "city": city_name
            }
            resp = await client.get(url, params=params)
            data = resp.json()
            
            if data.get("status") == "1" and data.get("geocodes"):
                geocode = data["geocodes"][0]
                location = geocode.get("location", "").split(",")
                if len(location) == 2:
                    return {"lng": float(location[0]), "lat": float(location[1])}
    except Exception:
        pass
    
    # 默认返回北京坐标
    return {"lng": 116.4074, "lat": 39.9042}


# ==================== 热线相关接口 ====================

@router.get("/hotlines", response_model=HotlineListResponse)
async def get_hotlines(
    request: Request,
    region: Optional[str] = Query(None, description="区域"),
    city: Optional[str] = Query(None, description="城市"),
    province: Optional[str] = Query(None, description="省份"),
    hotline_type: Optional[str] = Query(None, description="热线类型"),
):
    """获取热线列表"""
    svc = _get_map_service(request)
    data = await svc.get_hotlines(
        region=region,
        city=city,
        province=province,
        hotline_type=hotline_type,
    )
    return {"success": True, "data": data}


@router.get("/hotlines/national", response_model=HotlineListResponse)
async def get_national_hotlines(request: Request):
    """获取全国热线"""
    svc = _get_map_service(request)
    data = await svc.get_national_hotlines()
    return {"success": True, "data": data}


@router.get("/hotlines/local", response_model=HotlineListResponse)
async def get_local_hotlines(request: Request, city: str = Query(..., description="城市名称")):
    """获取本地热线"""
    svc = _get_map_service(request)
    data = await svc.get_local_hotlines(city)
    return {"success": True, "data": data}


@router.get("/hotlines/{hotline_id}")
async def get_hotline(request: Request, hotline_id: int):
    """获取热线详情"""
    svc = _get_map_service(request)
    hotline = await svc.get_hotline_by_id(hotline_id)
    if not hotline:
        raise HTTPException(status_code=404, detail="热线不存在")
    return {"success": True, "data": hotline}


@router.get("/hotlines/number/{hotline}")
async def get_hotline_by_number(request: Request, hotline: str):
    """根据号码获取热线"""
    svc = _get_map_service(request)
    data = await svc.get_hotline_by_number(hotline)
    if not data:
        raise HTTPException(status_code=404, detail="热线不存在")
    return {"success": True, "data": data}


@router.get("/regions")
async def get_regions(request: Request):
    """获取区域列表"""
    svc = _get_map_service(request)
    data = await svc.get_regions()
    return {"success": True, "data": data}


@router.get("/hotlines/statistics")
async def get_hotline_statistics(request: Request):
    """获取热线统计信息"""
    svc = _get_map_service(request)
    data = await svc.get_hotline_statistics()
    return {"success": True, "data": data}
