# 心理援助地图相关 Pydantic 模型
from typing import List, Optional
from pydantic import BaseModel, Field


class InstitutionBase(BaseModel):
    """机构基础信息"""
    id: int
    name: str
    type: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    hours: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    city: Optional[str] = None
    district: Optional[str] = None
    data_source: Optional[str] = None


class Institution(InstitutionBase):
    """心理机构"""
    province: Optional[str] = None
    poi_id: Optional[str] = None
    distance_km: Optional[float] = None

    class Config:
        from_attributes = True


class InstitutionWithDistance(Institution):
    """带距离信息的机构"""
    distance_meters: Optional[float] = None


class InstitutionListResponse(BaseModel):
    """机构列表响应"""
    success: bool = True
    data: List[Institution]
    pagination: dict


class InstitutionStatsResponse(BaseModel):
    """机构统计响应"""
    success: bool = True
    data: dict


class HotlineBase(BaseModel):
    """热线基础信息"""
    id: int
    hotline: str
    name: str
    region: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None


class Hotline(HotlineBase):
    """心理援助热线"""
    hotline_type: Optional[str] = "全国"
    is_emergency: bool = False
    is_verified: bool = True
    usage_count: int = 0

    class Config:
        from_attributes = True


class HotlineListResponse(BaseModel):
    """热线列表响应"""
    success: bool = True
    data: List[Hotline]


class CityInfo(BaseModel):
    """城市信息"""
    name: str
    institution_count: int = 0


class CityListResponse(BaseModel):
    """城市列表响应"""
    success: bool = True
    data: List[dict]


class RegionStats(BaseModel):
    """区域统计"""
    region: str
    count: int
    hotlines: List[Hotline]


class RegionStatsResponse(BaseModel):
    """区域统计响应"""
    success: bool = True
    data: List[dict]
