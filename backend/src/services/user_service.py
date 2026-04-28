# 用户/心理档案业务：列表、详情，从 datasets/ CSV 文件读取
from typing import Dict, List, Optional
from src.core.constants import RISK_LEVEL_LOW, RISK_LEVEL_MEDIUM, RISK_LEVEL_HIGH
from src.services.dataset_csv_service import DatasetCSVService


class UserService:
    """用户与心理档案业务，依赖 CSV 文件读取服务。"""

    def __init__(self, mysql_pool, get_dataset_config_fn):
        self.mysql_pool = mysql_pool
        self.get_dataset_config = get_dataset_config_fn
        self._csv_svc: Optional[DatasetCSVService] = None

    def _get_csv_service(self) -> DatasetCSVService:
        if self._csv_svc is None:
            self._csv_svc = DatasetCSVService()
        return self._csv_svc

    async def get_users(
        self,
        dataset: Optional[str] = None,
        risk_level: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """分页获取用户列表，从 datasets/ CSV 文件读取。

        数据从 datasets/ 目录下的 CSV 文件聚合，按数据集、风险等级筛选。
        """
        csv_svc = self._get_csv_service()
        archives, total = csv_svc.get_archives_page(
            dataset_key=dataset,
            risk_level=risk_level,
            page=page,
            page_size=page_size,
        )

        users = []
        for a in archives:
            if a.risk_value == 0:
                risk_level_val = RISK_LEVEL_LOW
                risk_score = 0.1
            elif a.risk_value == 1:
                risk_level_val = RISK_LEVEL_LOW
                risk_score = 0.35
            elif a.risk_value == 2:
                risk_level_val = RISK_LEVEL_MEDIUM
                risk_score = 0.6
            else:
                risk_level_val = RISK_LEVEL_HIGH
                risk_score = 0.9

            users.append({
                "id": a.user_id[-4:] if len(a.user_id) > 4 else a.user_id,
                "userId": a.user_id,
                "source": a.dataset_key,
                "postCount": a.post_count,
                "avgLabel": float(a.risk_value),
                "maxLabel": a.risk_value,
                "riskLevel": risk_level_val,
                "riskScore": risk_score,
                "assessmentTime": a.import_timestamp or "",
            })

        return {
            "users": users,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def get_user_detail(self, user_hash: str) -> dict:
        """获取单个用户心理档案详情（含帖子列表），从 CSV 文件读取。"""
        csv_svc = self._get_csv_service()
        posts, _ = csv_svc.get_user_posts(user_hash=user_hash, page=1, page_size=20)

        if not posts:
            raise ValueError("用户不存在")

        max_risk = max((p.risk_value for p in posts), default=0)
        dataset_key = next((p.user_id.split('_')[0] for p in posts if '_' in p.user_id), "unknown")

        if max_risk == 0:
            risk_level_val = RISK_LEVEL_LOW
            risk_score = 0.1
        elif max_risk == 1:
            risk_level_val = RISK_LEVEL_LOW
            risk_score = 0.35
        elif max_risk == 2:
            risk_level_val = RISK_LEVEL_MEDIUM
            risk_score = 0.6
        else:
            risk_level_val = RISK_LEVEL_HIGH
            risk_score = 0.9

        user_posts = []
        for p in posts:
            text = p.content
            if len(text) > 200:
                text = text[:200] + "..."
            user_posts.append({
                "id": f"{p.user_id}_{p.post_index}",
                "text": text,
                "label": p.risk_value,
                "timestamp": p.timestamp,
            })

        return {
            "userId": user_hash,
            "source": dataset_key,
            "postCount": len(user_posts),
            "avgLabel": float(max_risk),
            "maxLabel": max_risk,
            "riskLevel": risk_level_val,
            "riskScore": risk_score,
            "posts": user_posts,
            "assessmentTime": "",
        }
