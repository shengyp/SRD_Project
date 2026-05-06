from typing import List, Any, Optional, Union
from pydantic import BaseModel


class DatasetProfile(BaseModel):
    """数据集档案（匹配前端 DatasetProfile 接口）"""
    id: Union[str, int]
    datasetKey: str
    displayName: str
    description: str
    language: str
    classSystem: str  # 'binary' | 'multi-class'
    classCount: int
    fineLabels: dict = {}
    coarseRiskMapping: dict = {}
    totalUsers: int = 0
    totalPosts: int = 0
    totalArchives: int = 0
    isBuiltin: bool = True
    isActive: bool = True
    sortOrder: int = 0
    # 可选 UI 属性
    color: Optional[str] = None
    bgColor: Optional[str] = None
    textColor: Optional[str] = None
    icon: Optional[str] = None


class DatasetListResponse(BaseModel):
    success: bool
    data: List[DatasetProfile]


class ExternalDatasetItem(BaseModel):
    id: Union[str, int]
    meta_id: int
    name: str
    table_name: str
    mode_type: str
    row_count: int
    columns_info: Optional[Any] = None
    created_at: str


class ExternalDatasetListResponse(BaseModel):
    success: bool
    data: List[ExternalDatasetItem]


class DatasetCompareItem(BaseModel):
    id: Union[str, int]
    name: str
    type: str  # builtin | external
    total: int
    user_count: int
    timestamp: bool
    language: str
    structure: str
    balance: str
    balance_ratio: Optional[float] = None
    task: str
    task_type: Optional[str] = None
    class_count: Optional[int] = None
    class_distribution: Optional[Any] = None


class DatasetCompareResponse(BaseModel):
    success: bool
    data: List[DatasetCompareItem]


class UploadDatasetResponse(BaseModel):
    success: bool
    data: dict  # id, name, table_name, row_count, columns, mode_type
