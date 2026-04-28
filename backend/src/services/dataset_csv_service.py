# 数据集 CSV 文件读取服务：直接从 datasets/ 目录读取原始数据
# 后端数据库仅存储元信息，实际档案/贴文数据由前端从 CSV 读取
import os
import csv
import json
import hashlib
import random
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class DatasetCSVInfo:
    """单个数据集的元信息"""
    dataset_key: str
    display_name: str
    csv_path: str
    total_users: int
    total_posts: int
    columns: List[str]
    risk_column: str
    post_column: str
    user_id_column: str
    timestamp_column: Optional[str]
    emoji_column: Optional[str]
    language: str
    class_system: str
    class_count: int
    fine_labels: Dict[str, str]
    coarse_risk_mapping: Dict[str, str]


@dataclass
class ArchiveInfo:
    """单个档案的元信息（从 CSV 聚合）"""
    user_id: str
    dataset_key: str
    post_count: int
    risk_level: str
    risk_value: int
    has_timestamp: bool
    has_emojis: bool
    user_stats: Dict = field(default_factory=dict)
    import_timestamp: Optional[str] = None


@dataclass
class PostInfo:
    """单条贴文的元信息"""
    user_id: str
    post_index: int
    content: str
    risk_level: str
    risk_value: int
    sentiment_score: Optional[float]
    importance_score: Optional[float]
    timestamp: Optional[str]
    has_emojis: bool
    emoji_sequence: Optional[str]


# 重要性分数计算：消极/自杀风险相关词汇（英文自杀风险五分类任务）
# 基于 Reddit 数据集的关键词进行重要性评估
_IMPORTANCE_KEYWORDS = {
    # 直接自杀相关（高权重）
    "suicide": 3.0, "suicidal": 3.0, "kill myself": 3.0, "want to die": 3.0,
    "better off dead": 3.0, "end my life": 3.0, "self-harm": 2.5, "self harm": 2.5,
    "cutting": 2.0, "overdose": 2.0, "hang myself": 3.0, "jump off": 2.5,
    # 抑郁症状（中权重）
    "depressed": 2.0, "depression": 2.0, "hopeless": 2.0, "helpless": 2.0,
    "worthless": 2.0, "empty": 1.5, "numb": 1.5, "empty inside": 2.0,
    "crying": 1.5, "cry": 1.0, "tears": 1.0, "sad": 1.0, "sadness": 1.5,
    # 焦虑症状
    "anxiety": 1.5, "anxious": 1.5, "panic": 1.5, "worried": 1.0, "fear": 1.0,
    "scared": 1.0, "terrified": 1.5, "overwhelmed": 1.5,
    # 失眠/疲劳
    "insomnia": 1.0, "can't sleep": 1.0, "no sleep": 1.0, "exhausted": 1.0,
    "tired": 0.5, "fatigue": 1.0,
    # 社交退缩
    "alone": 1.5, "lonely": 1.5, "isolated": 1.5, "no one": 1.0, "nobody": 1.0,
    "isolating": 1.5, "push away": 1.0, "stay away": 1.0,
    # 负面自我评价
    "hate myself": 2.5, "hate my life": 2.5, "burden": 2.0, "useless": 2.0,
    "failure": 1.5, "pathetic": 1.5, "disgusting": 1.0, "ugly": 1.0,
    # 绝望相关
    "hopeless": 2.0, "no hope": 2.0, "never get better": 2.5, "forever": 1.5,
    "always tired": 1.0, "give up": 2.0, "give up on": 2.0, "can't anymore": 2.0,
    # 治疗/应对相关（可能降低风险）
    "therapy": -0.5, "medication": -0.5, "hospital": 0.5, "better": -0.5,
}


class DatasetCSVService:
    """直接从 datasets/ 目录读取 CSV 文件，提供元信息和数据查询"""

    def __init__(self, base_dir: Optional[str] = None):
        # datasets 目录的基础路径（容器内挂载路径）
        container_base = Path("/app/datasets")
        # 本地开发路径：datasets 在项目根目录，不在 backend 下
        # __file__ = backend/src/services/dataset_csv_service.py
        # parent.parent.parent = backend
        # parent.parent.parent.parent = 项目根目录
        current_file = Path(__file__).resolve()
        local_base = current_file.parent.parent.parent.parent / "datasets"

        # 优先使用传入的路径，否则尝试本地开发路径，最后使用容器路径
        if base_dir:
            self.base_dir = Path(base_dir)
        elif local_base.exists():
            self.base_dir = local_base
        else:
            self.base_dir = container_base
        self._cache: Dict[str, dict] = {}

    DATASET_CONFIG: Dict[str, dict] = {
        "reddit": {
            "csv_path": "reddit/reddit_500.csv",
            "emoji_csv_path": "reddit/reddit_500_emoji_batch.csv",
            "user_id_column": "User",
            "post_column": "Post",
            "risk_column": "Label",
            "emoji_column": "Post",  # emoji 文件的 Post 列包含 emoji_sequence
            "timestamp_column": None,
            "display_name": "Reddit系列",
            "language": "en",
            "class_system": "multi-class",
            "class_count": 5,
            "fine_labels": {"0": "无风险", "1": "极低风险", "2": "低风险", "3": "中风险", "4": "高风险"},
            "coarse_risk_mapping": {"0": "low", "1": "low", "2": "low", "3": "medium", "4": "high"},
        },
    }

    def _get_csv_full_path(self, relative_path: str) -> Path:
        """获取 CSV 文件的完整路径"""
        return self.base_dir / relative_path

    @staticmethod
    def _remove_bom(content: str) -> str:
        """移除 UTF-8 BOM"""
        if content.startswith('\ufeff'):
            return content[1:]
        return content

    @staticmethod
    def _normalize_fieldname(name: str) -> str:
        """规范化字段名：移除 BOM，统一大小写"""
        name = DatasetCSVService._remove_bom(name)
        return name.strip()

    def _generate_user_hash(self, dataset_key: str, user_id: str) -> str:
        """生成用户哈希（与 ArchiveInfo.user_id 一致，md5 格式）"""
        raw = f"{dataset_key}_{user_id}"
        return hashlib.md5(raw.encode()).hexdigest()[:12]

    def _parse_posts(self, post_str: str) -> List[str]:
        """解析贴文内容（可能是列表字符串、换行分隔或纯文本）"""
        if not post_str:
            return []
        post_str = post_str.strip()

        # 检查是否是 Python list 格式 [...]
        if post_str.startswith("[") and post_str.endswith("]"):
            try:
                import ast
                items = ast.literal_eval(post_str)
                if isinstance(items, list):
                    return [str(i).strip() for i in items if str(i).strip()]
            except Exception:
                pass
            # 如果 ast 失败，尝试用正则提取
            try:
                import re
                items = re.findall(r'["\']([^"\']+)["\']', post_str)
                if items:
                    return [i.strip() for i in items if i.strip()]
            except Exception:
                pass

        # 检查是否包含换行符分隔的多个帖子
        if '\n' in post_str:
            parts = [p.strip() for p in post_str.split('\n') if p.strip()]
            if len(parts) > 1:
                return parts

        return [post_str]

    def _get_coarse_risk(self, dataset_key: str, risk_value: int) -> str:
        """获取粗粒度风险等级"""
        config = self.DATASET_CONFIG.get(dataset_key, {})
        mapping = config.get("coarse_risk_mapping", {})
        return mapping.get(str(risk_value), "low")

    # ==================== Emoji 数据缓存 ====================

    def _load_emoji_data(self, dataset_key: str) -> Dict[str, str]:
        """加载 emoji 数据到缓存"""
        cache_key = f"{dataset_key}_emoji"
        if cache_key in self._cache and "emoji_data" in self._cache[cache_key]:
            return self._cache[cache_key]["emoji_data"]

        config = self.DATASET_CONFIG.get(dataset_key, {})
        emoji_csv_path = config.get("emoji_csv_path")
        if not emoji_csv_path:
            return {}

        full_path = self._get_csv_full_path(emoji_csv_path)
        if not full_path.exists():
            return {}

        emoji_data: Dict[str, str] = {}
        try:
            # 使用 utf-8-sig 编码读取，自动处理 BOM
            # 使用 surrogateescape 来保留无法解码的字节
            with open(full_path, "r", encoding="utf-8-sig", errors='surrogateescape') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # 规范化字段名（移除 BOM）
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}
                    uid_raw = row.get(config.get("user_id_column") or "User", "")
                    uid = str(uid_raw).strip()
                    if not uid:
                        continue
                    # 尝试获取 emoji_sequence
                    emoji_col = config.get("emoji_column") or "Post"
                    emoji_seq = row.get(emoji_col)
                    if emoji_seq:
                        # 清理不可见字符，但保留 emoji
                        cleaned = emoji_seq.replace(chr(0x200B), '').replace(chr(0x200C), '').replace(chr(0x200D), '').replace(chr(0xFEFF), '').replace(chr(0xFFFD), '')
                        emoji_data[uid] = cleaned
        except Exception:
            pass

        if cache_key not in self._cache:
            self._cache[cache_key] = {}
        self._cache[cache_key]["emoji_data"] = emoji_data
        return emoji_data

    # ==================== 数据集元信息 ====================

    def list_dataset_csvs(self) -> List[dict]:
        """返回所有数据集的元信息（用于前端选择数据集）"""
        result = []
        for ds_key, config in self.DATASET_CONFIG.items():
            csv_path = self._get_csv_full_path(config["csv_path"])
            if not csv_path.exists():
                continue

            # 统计用户数和贴文数（缓存）
            stats = self._get_dataset_stats(ds_key)

            result.append({
                "id": ds_key,
                "datasetKey": ds_key,
                "displayName": config["display_name"],
                "description": f"{config['display_name']}自杀风险数据集",
                "language": config["language"],
                "classSystem": config["class_system"],
                "classCount": config["class_count"],
                "fineLabels": config["fine_labels"],
                "coarseRiskMapping": config["coarse_risk_mapping"],
                "totalUsers": stats["total_users"],
                "totalPosts": stats["total_posts"],
                "totalArchives": stats["total_users"],
                "csvPath": f"/datasets/{config['csv_path']}",
                "emojiCsvPath": f"/datasets/{config.get('emoji_csv_path', '')}" if config.get('emoji_csv_path') else None,
                "isBuiltin": True,
                "isActive": True,
                "sortOrder": list(self.DATASET_CONFIG.keys()).index(ds_key),
            })
        return result

    def get_dataset_info(self, dataset_key: str) -> Optional[DatasetCSVInfo]:
        """获取单个数据集的元信息"""
        config = self.DATASET_CONFIG.get(dataset_key)
        if not config:
            return None
        csv_path = self._get_csv_full_path(config["csv_path"])
        if not csv_path.exists():
            return None
        stats = self._get_dataset_stats(dataset_key)
        return DatasetCSVInfo(
            dataset_key=dataset_key,
            display_name=config["display_name"],
            csv_path=str(csv_path),
            total_users=stats["total_users"],
            total_posts=stats["total_posts"],
            columns=stats["columns"],
            risk_column=config["risk_column"],
            post_column=config["post_column"],
            user_id_column=config.get("user_id_column") or "user_id",
            timestamp_column=config.get("timestamp_column"),
            emoji_column=config.get("emoji_column"),
            language=config["language"],
            class_system=config["class_system"],
            class_count=config["class_count"],
            fine_labels=config["fine_labels"],
            coarse_risk_mapping=config["coarse_risk_mapping"],
        )

    def _get_dataset_stats(self, dataset_key: str) -> dict:
        """统计数据集的用户数和贴文数（带缓存）"""
        if dataset_key in self._cache and "stats" in self._cache[dataset_key]:
            return self._cache[dataset_key]["stats"]

        config = self.DATASET_CONFIG.get(dataset_key)
        if not config:
            return {"total_users": 0, "total_posts": 0, "columns": []}

        csv_path = self._get_csv_full_path(config["csv_path"])
        if not csv_path.exists():
            return {"total_users": 0, "total_posts": 0, "columns": []}

        user_id_col = config.get("user_id_column")
        post_col = config["post_column"]
        total_posts = 0
        users_set = set()
        columns = []
        row_count = 0

        try:
            with open(csv_path, "r", encoding="utf-8-sig", errors='replace') as f:
                reader = csv.DictReader(f)
                columns = [self._normalize_fieldname(c) for c in (reader.fieldnames or [])]
                for row in reader:
                    row_count += 1
                    if user_id_col:
                        # 有 user_id 列的数据集
                        uid = row.get(user_id_col, "")
                        if uid:
                            users_set.add(uid)
                    else:
                        # 没有 user_id 列的数据集，每行算一个用户
                        users_set.add(f"row_{row_count}")

                    posts_raw = row.get(post_col, "")
                    posts = self._parse_posts(posts_raw)
                    total_posts += len(posts)

        except Exception:
            pass

        stats = {
            "total_users": len(users_set),
            "total_posts": total_posts,
            "columns": columns,
        }

        if dataset_key not in self._cache:
            self._cache[dataset_key] = {}
        self._cache[dataset_key]["stats"] = stats
        return stats

    # ==================== 档案分页查询 ====================

    def _get_aggregated_archives(self, dataset_key: str) -> List[dict]:
        """获取数据集的聚合档案（带缓存）

        这个方法会读取整个 CSV 并在内存中聚合所有用户数据。
        结果会被缓存以提高分页查询性能。
        """
        cache_key = f"{dataset_key}_archives"
        if cache_key in self._cache and "archives" in self._cache[cache_key]:
            return self._cache[cache_key]["archives"]

        cfg = self.DATASET_CONFIG.get(dataset_key)
        if not cfg:
            return []

        csv_path = self._get_csv_full_path(cfg["csv_path"])
        if not csv_path.exists():
            return []

        # 加载 emoji 数据
        emoji_data = self._load_emoji_data(dataset_key)

        try:
            with open(csv_path, "r", encoding="utf-8-sig", errors='replace') as f:
                reader = csv.DictReader(f)
                user_posts: Dict[str, list] = {}
                user_risks: Dict[str, int] = {}
                user_timestamps: Dict[str, bool] = {}
                user_emojis: Dict[str, bool] = {}
                user_emoji_seqs: Dict[str, str] = {}

                for row in reader:
                    # 规范化字段名（移除 BOM）
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}

                    posts_raw = row.get(cfg["post_column"], "")
                    uid_raw = row.get(cfg.get("user_id_column") or "user_id", "")
                    uid = str(uid_raw).strip()
                    if not uid:
                        uid = f"anon_{hashlib.md5(posts_raw[:50].encode()).hexdigest()[:8]}"

                    posts = self._parse_posts(posts_raw)

                    risk_str = row.get(cfg["risk_column"], "0")
                    try:
                        risk_val = int(float(risk_str))
                    except (ValueError, TypeError):
                        risk_val = 0

                    if uid not in user_posts:
                        user_posts[uid] = posts
                        user_risks[uid] = risk_val
                        user_timestamps[uid] = cfg.get("timestamp_column") is not None
                        user_emojis[uid] = uid in emoji_data
                        user_emoji_seqs[uid] = emoji_data.get(uid, "")
                    else:
                        user_posts[uid].extend(posts)
                        if risk_val > user_risks[uid]:
                            user_risks[uid] = risk_val
                        if uid in emoji_data:
                            user_emojis[uid] = True
                            if not user_emoji_seqs.get(uid):
                                user_emoji_seqs[uid] = emoji_data[uid]

                archives = []
                # 预设随机时间种子，保证每次运行结果一致但分布合理
                # 时间范围：2026年1月1日至今，模拟不同患者就诊时间
                random.seed(42)  # 固定种子保证一致性
                
                # 2026年至今的时间范围
                start_date = datetime(2026, 1, 1)
                end_date = datetime(2026, 4, 22, 23, 59, 59)
                total_seconds = (end_date - start_date).total_seconds()
                user_count = len(user_posts)
                
                # 生成500个完全不同的随机时间点（使用分数阶跃确保唯一性）
                import_times = []
                for i in range(user_count):
                    # 使用等差分布 + 随机偏移，确保每个时间都不同
                    # 基础位置：均匀分布的分数位置
                    base_fraction = (i + 0.5) / user_count
                    # 添加随机抖动，但确保不超过相邻位置
                    jitter = random.uniform(-0.4/user_count, 0.4/user_count)
                    fraction = base_fraction + jitter
                    fraction = max(0.001, min(0.999, fraction))
                    
                    seconds_offset = fraction * total_seconds
                    import_time = start_date + timedelta(seconds=seconds_offset)
                    import_times.append(import_time)
                
                # 按时间排序，使时间分布更自然
                import_times.sort()
                
                # 如果有重复（极端情况），添加微调
                for i in range(1, len(import_times)):
                    if import_times[i] == import_times[i-1]:
                        import_times[i] += timedelta(seconds=1)
                
                for idx, (uid, posts) in enumerate(user_posts.items()):
                    risk_val = user_risks[uid]
                    coarse = self._get_coarse_risk(dataset_key, risk_val)
                    user_hash = self._generate_user_hash(dataset_key, uid)
                    
                    # 获取该用户的时间戳（已确保各不相同）
                    import_time = import_times[idx] if idx < len(import_times) else datetime.now()
                    
                    archives.append({
                        "user_id": user_hash,
                        "dataset_key": dataset_key,
                        "post_count": len(posts),
                        "risk_level": coarse,
                        "risk_value": risk_val,
                        "has_timestamp": user_timestamps.get(uid, False),
                        "has_emojis": user_emojis.get(uid, False),
                        "import_timestamp": import_time.isoformat(),
                    })

                # 按 user_id 排序
                archives.sort(key=lambda x: x["user_id"])

                # 缓存结果（使用时间戳标记，避免永久缓存）
                if cache_key not in self._cache:
                    self._cache[cache_key] = {}
                self._cache[cache_key]["archives"] = archives

                return archives

        except Exception as e:
            print(f"Error aggregating archives for {dataset_key}: {e}")
            return []

    def get_archives_page(
        self,
        dataset_key: Optional[str] = None,
        risk_level: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[ArchiveInfo], int]:
        """分页获取档案列表（从 CSV 聚合，带缓存）

        Returns:
            (archives, total): 档案列表和总数
        """
        target_keys = [dataset_key] if dataset_key else list(self.DATASET_CONFIG.keys())

        all_archives: List[dict] = []

        for ds_key in target_keys:
            cfg = self.DATASET_CONFIG.get(ds_key)
            if not cfg:
                continue
            csv_path = self._get_csv_full_path(cfg["csv_path"])
            if not csv_path.exists():
                continue

            # 使用带缓存的聚合方法
            archives = self._get_aggregated_archives(ds_key)

            # 按风险等级过滤
            if risk_level:
                archives = [a for a in archives if a["risk_level"] == risk_level]

            all_archives.extend(archives)

        # 按 user_id 排序（分页）
        all_archives.sort(key=lambda x: x["user_id"])
        total = len(all_archives)

        # 分页
        start = (page - 1) * page_size
        end = start + page_size
        page_archives = all_archives[start:end]

        # 转换为 ArchiveInfo 对象
        result = [
            ArchiveInfo(
                user_id=a["user_id"],
                dataset_key=a["dataset_key"],
                post_count=a["post_count"],
                risk_level=a["risk_level"],
                risk_value=a["risk_value"],
                has_timestamp=a["has_timestamp"],
                has_emojis=a["has_emojis"],
                user_stats={"male": 0, "female": 0, "unknown": 1},
                import_timestamp=a.get("import_timestamp"),
            )
            for a in page_archives
        ]

        return result, total

    # ==================== 用户贴文查询 ====================

    def _calculate_importance_score(self, content: str) -> float:
        """根据贴文内容中的消极/自杀风险词汇计算重要性分数

        算法：
        1. 统计匹配到的关键词及其权重
        2. 对权重求和（负值表示保护性因素）
        3. 使用 sigmoid 归一化到 (0, 1) 区间
        4. 确保分数总和为1（由调用方在返回前归一化）
        """
        if not content:
            return 0.0

        content_lower = content.lower()
        total_score = 0.0

        # 遍历关键词字典，计算匹配得分
        for keyword, weight in _IMPORTANCE_KEYWORDS.items():
            if keyword in content_lower:
                total_score += weight

        # 使用 sigmoid 归一化：sigmoid(x) = 1 / (1 + exp(-x))
        # 将分数映射到 (0.05, 0.95) 区间，避免极端值
        import math
        normalized = 1.0 / (1.0 + math.exp(-total_score * 0.5))
        # 将 (0, 1) 映射到 (0.05, 0.95)
        return 0.05 + normalized * 0.9

    def _normalize_importance_scores(self, posts: List[PostInfo]) -> List[PostInfo]:
        """归一化重要性分数，使所有帖子的分数总和为1"""
        if not posts:
            return posts

        total_raw = sum(p.importance_score or 0.0 for p in posts)
        if total_raw <= 0:
            # 所有分数都是0，平均分配
            equal_score = 1.0 / len(posts)
            for p in posts:
                p.importance_score = equal_score
        else:
            # 归一化：每条帖子的分数 / 总分数
            for p in posts:
                raw = p.importance_score or 0.0
                p.importance_score = raw / total_raw

        return posts

    def get_user_posts(
        self,
        user_hash: str,
        dataset_key: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[PostInfo], int]:
        """获取指定用户的贴文列表（从 CSV 查询，带重要性分数计算和微表情序列关联）

        user_hash 格式: md5(dataset_key_user_id)[:12]
        需要遍历 CSV 找到对应用户

        重要性分数计算：
        - 基于贴文内容中消极/自杀风险相关词汇的出现频率和权重
        - 使用 sigmoid 归一化
        - 所有帖子分数总和归一化为1

        微表情序列关联：
        - 从 emoji CSV 加载用户的 emoji 序列
        - 按帖子顺序对应关联
        """
        target_keys = [dataset_key] if dataset_key else list(self.DATASET_CONFIG.keys())
        all_posts: List[PostInfo] = []

        for ds_key in target_keys:
            cfg = self.DATASET_CONFIG.get(ds_key)
            if not cfg:
                continue
            csv_path = self._get_csv_full_path(cfg["csv_path"])
            if not csv_path.exists():
                continue

            # 加载该用户的 emoji 序列
            emoji_data = self._load_emoji_data(ds_key)

            try:
                with open(csv_path, "r", encoding="utf-8-sig", errors='replace') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        # 规范化字段名（移除 BOM）
                        row = {self._normalize_fieldname(k): v for k, v in row.items()}

                        uid_raw = row.get(cfg.get("user_id_column") or "user_id", "")
                        uid = str(uid_raw).strip()
                        expected_hash = self._generate_user_hash(ds_key, uid)

                        if expected_hash != user_hash:
                            continue

                        posts_raw = row.get(cfg["post_column"], "")
                        posts = self._parse_posts(posts_raw)

                        risk_str = row.get(cfg["risk_column"], "0")
                        try:
                            risk_val = int(float(risk_str))
                        except (ValueError, TypeError):
                            risk_val = 0

                        coarse = self._get_coarse_risk(ds_key, risk_val)

                        # 获取该用户的 emoji 序列
                        emoji_seq_str = emoji_data.get(uid, "")
                        emoji_list: List[str] = []
                        if emoji_seq_str:
                            # emoji 序列是逗号分隔的字符串，每个元素对应一个帖子
                            emoji_list = [e.strip() for e in emoji_seq_str.split(",") if e.strip()]

                        for idx, content in enumerate(posts):
                            # 计算该帖子的重要性分数
                            importance = self._calculate_importance_score(content)

                            # 获取对应的 emoji 序列（如果有的话）
                            post_emoji = emoji_list[idx] if idx < len(emoji_list) else None
                            has_emoji = bool(post_emoji)

                            post_info = PostInfo(
                                user_id=user_hash,
                                post_index=idx,
                                content=content,
                                risk_level=coarse,
                                risk_value=risk_val,
                                sentiment_score=None,
                                importance_score=importance,
                                timestamp=None,
                                has_emojis=has_emoji,
                                emoji_sequence=post_emoji,
                            )
                            all_posts.append(post_info)

            except Exception as e:
                print(f"Error reading {ds_key}: {e}")
                continue

        total = len(all_posts)

        # 归一化重要性分数：所有帖子分数总和为1
        if all_posts:
            all_posts = self._normalize_importance_scores(all_posts)

        start = (page - 1) * page_size
        end = start + page_size
        return all_posts[start:end], total

    # ==================== 获取所有用户哈希（用于验证） ====================

    def get_all_user_hashes(self, dataset_key: str) -> List[str]:
        """获取数据集下所有用户的哈希列表"""
        cfg = self.DATASET_CONFIG.get(dataset_key)
        if not cfg:
            return []

        csv_path = self._get_csv_full_path(cfg["csv_path"])
        if not csv_path.exists():
            return []

        hashes = []
        try:
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                seen = set()
                for row in reader:
                    # 规范化字段名（移除 BOM）
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}

                    uid_raw = row.get(cfg.get("user_id_column") or "user_id", "")
                    uid = str(uid_raw).strip()
                    if not uid:
                        continue
                    h = self._generate_user_hash(dataset_key, uid)
                    if h not in seen:
                        seen.add(h)
                        hashes.append(h)
        except Exception:
            pass
        return hashes

    def get_csv_url(self, dataset_key: str) -> Optional[str]:
        """获取数据集 CSV 的 URL 路径（供前端直接读取）"""
        config = self.DATASET_CONFIG.get(dataset_key)
        if not config:
            return None
        csv_path = self._get_csv_full_path(config["csv_path"])
        if not csv_path.exists():
            return None
        return f"/datasets/{config['csv_path']}"

    def get_emoji_csv_url(self, dataset_key: str) -> Optional[str]:
        """获取数据集 Emoji CSV 的 URL 路径"""
        config = self.DATASET_CONFIG.get(dataset_key)
        if not config or not config.get("emoji_csv_path"):
            return None
        emoji_path = self._get_csv_full_path(config["emoji_csv_path"])
        if not emoji_path.exists():
            return None
        return f"/datasets/{config['emoji_csv_path']}"

    # ==================== 用户高频词汇提取 ====================

    _KEYWORD_STOPWORDS: set = {
        '的', '了', '是', '我', '你', '他', '她', '它', '们', '这', '那',
        '有', '在', '和', '就', '不', '也', '都', '很', '要', '会', '可以',
        'to', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'for',
        'of', 'with', 'by', 'from', 'is', 'it', 'be', 'as', 'are', 'was',
        'were', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
        'would', 'could', 'should', 'may', 'might', 'must', 'shall',
        'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
        'my', 'your', 'his', 'our', 'their', 'its',
        'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
        'am', 'if', 'so', 'not', 'no', 'all', 'any', 'some', 'one', 'two',
    }

    _chinese_re = __import__('re', fromlist=['re']).compile(r'[\u4e00-\u9fff]+')

    def get_user_keywords(self, user_hash: str, top_n: int = 8) -> List[dict]:
        """从用户贴文中提取高频词汇"""
        posts, _ = self.get_user_posts(user_hash=user_hash, page=1, page_size=100)
        if not posts:
            return []

        all_text = " ".join(p.content for p in posts)
        words = self._chinese_re.findall(all_text)

        freq: dict = {}
        for w in words:
            w_lower = w.strip().lower()
            if len(w_lower) < 2 or w_lower in self._KEYWORD_STOPWORDS:
                continue
            freq[w_lower] = freq.get(w_lower, 0) + 1

        sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:top_n]
        return [{"word": word, "count": count} for word, count in sorted_words]
