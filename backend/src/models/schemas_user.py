from typing import List, Optional
from pydantic import BaseModel


class UserPostItem(BaseModel):
    id: int
    text: str
    label: Optional[int] = None
    sequence: Optional[int] = None


class UserListItem(BaseModel):
    id: str
    userId: str
    source: str
    postCount: int
    avgLabel: float
    maxLabel: int
    riskLevel: str
    riskScore: float
    assessmentTime: str


class UserListPayload(BaseModel):
    users: List[UserListItem]
    total: int
    page: int
    page_size: int


class UserDetail(BaseModel):
    userId: str
    source: str
    postCount: int
    avgLabel: float
    maxLabel: int
    riskLevel: str
    riskScore: float
    posts: List[UserPostItem]
    assessmentTime: str


class UserDetailResponse(BaseModel):
    success: bool
    data: UserDetail
