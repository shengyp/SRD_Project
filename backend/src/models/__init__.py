# 模型层初始化：统一导出所有 Pydantic 模型
from .schemas_map import (
    Institution,
    InstitutionListResponse,
    Hotline,
    HotlineListResponse,
    CityListResponse,
)
from .schemas_user import (
    UserPostItem,
    UserListItem,
    UserListPayload,
    UserDetail,
    UserDetailResponse,
)
from .schemas_dataset import (
    DatasetProfile,
    DatasetListResponse,
    ExternalDatasetItem,
    ExternalDatasetListResponse,
    DatasetCompareItem,
    DatasetCompareResponse,
    UploadDatasetResponse,
)
from .schemas_common import HealthResponse

__all__ = [
    # Map
    "Institution",
    "InstitutionListResponse",
    "Hotline",
    "HotlineListResponse",
    "CityListResponse",
    # User
    "UserPostItem",
    "UserListItem",
    "UserListPayload",
    "UserDetail",
    "UserDetailResponse",
    # Dataset
    "DatasetProfile",
    "DatasetListResponse",
    "ExternalDatasetItem",
    "ExternalDatasetListResponse",
    "DatasetCompareItem",
    "DatasetCompareResponse",
    "UploadDatasetResponse",
    # Common
    "HealthResponse",
]
