# 数据集原始文件服务：从 datasets/ 目录读取原始数据，仅用于初始化同步入库。
#
# 约定：datasets/ 中的主贴 CSV 与各自推理用的 .pkl 嵌入按「同一套用户、同一行序」对齐（便于 user_hash / post_index 对齐）。
# Weibo 子目录下两套源文件分工如下（勿混用）：
#   - weibo/weibo_1000.csv  + weibo_1000_emoji_batch.csv  → 对应 Emocc-Weibo（Emocc/weibo/data 下 pkl，如 user_post_embeddings_filtered.pkl）
#   - weibo/weibo_data.csv  → 对应 FeaLearner-Weibo（Fealeaner/data 下 user_post_embeddings_bert_wwm.pkl 等；与 Emocc 的 1000 条子集不同）
# 当前内置同步入库的 dataset_key「weibo」使用 weibo_1000.csv；FeaLearner 若要以 weibo_data 全量对齐，需单独扩展导入或自定义 dataset_key。
import os
import csv
import json
import hashlib
import random
import re
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
    """单个档案的元信息（从原始文件聚合）"""
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
    evidence_domains: Optional[List[dict]] = None
    evidence_summary: Optional[str] = None


# 重要性分数词表：按权威筛查/预警框架整理
# 设计依据贴近以下维度：
# 1. NIMH ASQ / PHQ-9 Item 9 的“wish to be dead / self-harm”表达
# 2. C-SSRS 的被动意念、主动意念、计划/方法、既往自伤线索
# 3. WHO / VA 危机预警中的绝望、负担感、孤立、被困等信号
_IMPORTANCE_KEYWORDS = {
    # 一级：直接死亡/自杀意念
    "suicide": 3.5, "suicidal": 3.5, "kill myself": 3.5, "end my life": 3.5,
    "want to die": 3.3, "wish i was dead": 3.3, "wish i were dead": 3.3,
    "better off dead": 3.3, "don't want to live": 3.3, "do not want to live": 3.3,
    "not want to wake up": 3.1, "wish i could disappear": 2.8,
    # 二级：计划/方法/自伤行为
    "self-harm": 3.0, "self harm": 3.0, "cut myself": 3.0, "cutting": 2.7,
    "overdose": 3.0, "hang myself": 3.5, "jump off": 3.1, "jumping off": 3.1,
    "blow my head off": 3.5, "take all my pills": 3.3, "hurt myself": 2.8,
    # 三级：绝望、被困、负担感、孤立
    "hopeless": 2.4, "no hope": 2.4, "helpless": 2.0, "trapped": 2.2,
    "stuck forever": 2.0, "burden": 2.3, "worthless": 2.3, "useless": 2.1,
    "hate myself": 2.4, "hate my life": 2.4, "can't anymore": 2.2, "give up": 2.0,
    "alone": 1.5, "lonely": 1.8, "isolated": 1.8, "no one cares": 2.0, "nobody cares": 2.0,
    # 四级：常见症状与伴随状态
    "depressed": 1.9, "depression": 1.9, "empty": 1.4, "numb": 1.6, "crying": 1.3,
    "sad": 1.0, "anxiety": 1.2, "panic": 1.2, "overwhelmed": 1.5,
    "can't sleep": 1.0, "insomnia": 1.0, "exhausted": 1.0,
    # 保护性/求助性表达，轻度降权
    "therapy": -0.4, "medication": -0.4, "counselor": -0.5, "hotline": -0.6,
    "getting help": -0.7, "reach out": -0.5, "stay safe": -0.4,
}

_EVIDENCE_DOMAIN_CONFIG = [
    {
        "key": "passive_death_wish",
        "label": "被动死亡愿望",
        "keywords": [
            "wish i was dead", "wish i were dead", "better off dead",
            "don't want to live", "do not want to live", "want to die",
            "wish i could disappear", "not want to wake up",
        ],
    },
    {
        "key": "active_suicidal_ideation",
        "label": "主动自杀意念",
        "keywords": [
            "suicide", "suicidal", "kill myself", "end my life",
        ],
    },
    {
        "key": "self_harm_plan",
        "label": "自伤/方法线索",
        "keywords": [
            "self-harm", "self harm", "cut myself", "cutting", "overdose",
            "hang myself", "jump off", "jumping off", "blow my head off",
            "take all my pills", "hurt myself",
        ],
    },
    {
        "key": "hopelessness_burden",
        "label": "绝望/负担感",
        "keywords": [
            "hopeless", "no hope", "helpless", "trapped", "stuck forever",
            "burden", "worthless", "useless", "hate myself", "hate my life",
            "can't anymore", "give up",
        ],
    },
    {
        "key": "isolation_distress",
        "label": "孤立/痛苦状态",
        "keywords": [
            "alone", "lonely", "isolated", "no one cares", "nobody cares",
            "depressed", "depression", "empty", "numb", "crying", "sad",
            "anxiety", "panic", "overwhelmed", "can't sleep", "insomnia", "exhausted",
        ],
    },
]

_KEYWORD_STOPWORDS: set = {
    '的', '了', '是', '我', '你', '他', '她', '它', '们', '这', '那',
    '有', '在', '和', '就', '不', '也', '都', '很', '要', '会', '可以',
    'to', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'be', 'as', 'are', 'was',
    'were', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'our', 'their', 'its', 'im', 'ive', 'ill',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'if', 'so', 'not', 'no', 'all', 'any', 'some', 'one', 'two',
}

_CHINESE_RE = re.compile(r'[\u4e00-\u9fff]+')
_ENGLISH_RE = re.compile(r"[a-zA-Z][a-zA-Z'_-]{1,}")


def calculate_importance_score(content: str) -> float:
    """基于权威筛查框架整理的词表计算贴文重要性分数。"""
    if not content:
        return 0.0

    content_lower = content.lower()
    total_score = 0.0

    for keyword, weight in _IMPORTANCE_KEYWORDS.items():
        if keyword in content_lower:
            total_score += weight

    import math
    normalized = 1.0 / (1.0 + math.exp(-total_score * 0.55))
    return 0.05 + normalized * 0.9


def analyze_risk_evidence(content: str) -> dict:
    """分析帖子中的风险证据域，并返回可解释结果。"""
    if not content:
        return {
            "importance_score": 0.0,
            "evidence_domains": [],
            "evidence_summary": "未识别到明显风险词汇。",
        }

    content_lower = content.lower()
    evidence_domains: List[dict] = []
    matched_keywords: List[str] = []

    for domain in _EVIDENCE_DOMAIN_CONFIG:
        domain_matches = [keyword for keyword in domain["keywords"] if keyword in content_lower]
        if not domain_matches:
            continue
        matched_keywords.extend(domain_matches)
        evidence_domains.append({
            "key": domain["key"],
            "label": domain["label"],
            "matches": domain_matches[:4],
            "count": len(domain_matches),
        })

    importance_score = calculate_importance_score(content)
    if evidence_domains:
        summary = "；".join(
            f"{domain['label']}（{', '.join(domain['matches'][:2])}）"
            for domain in evidence_domains[:3]
        )
    else:
        summary = "未识别到明显风险词汇。"

    return {
        "importance_score": importance_score,
        "evidence_domains": evidence_domains,
        "evidence_summary": summary,
        "matched_keywords": matched_keywords,
    }


def extract_keywords_from_texts(texts: List[str], top_n: int = 8) -> List[dict]:
    """从当前用户帖子中提取高频词，兼容中英文。"""
    if not texts:
        return []

    all_text = " ".join(texts)
    freq: Dict[str, int] = {}

    for word in _CHINESE_RE.findall(all_text):
        key = word.strip().lower()
        if len(key) < 2 or key in _KEYWORD_STOPWORDS:
            continue
        freq[key] = freq.get(key, 0) + 1

    for word in _ENGLISH_RE.findall(all_text.lower()):
        key = word.strip("'_-")
        if len(key) < 3 or key in _KEYWORD_STOPWORDS:
            continue
        freq[key] = freq.get(key, 0) + 1

    sorted_words = sorted(freq.items(), key=lambda item: (-item[1], item[0]))[:top_n]
    return [{"word": word, "count": count} for word, count in sorted_words]


class DatasetCSVService:
    """直接从 datasets/ 目录读取原始数据，供初始化同步与离线构造使用。"""

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
        "bigdata": {
            "csv_path": "bigdata/bigdata.csv",
            "emoji_csv_path": "bigdata/bigdata_emoji_batch.csv",
            "user_id_column": "user_id",
            "post_column": "post_sequence",
            "risk_column": "suicide_risk",
            "emoji_column": "emjio_sequenc",
            "timestamp_column": "created_utc",
            "display_name": "Bigdata系列",
            "language": "en",
            "class_system": "multi-class",
            "class_count": 4,
            "fine_labels": {"0": "无风险", "1": "低风险", "2": "中风险", "3": "高风险"},
            "coarse_risk_mapping": {"0": "low", "1": "low", "2": "medium", "3": "high"},
        },
        "sigir": {
            "csv_path": "sigir/sigir.csv",
            "emoji_csv_path": "sigir/sigir_emojis.csv",
            "user_id_column": None,
            "post_column": "Post",
            "risk_column": "Label",
            "emoji_column": "Post",
            "timestamp_column": None,
            "display_name": "SIGIR系列",
            "language": "en",
            "class_system": "binary",
            "class_count": 2,
            "fine_labels": {"0": "无风险", "1": "高风险"},
            "coarse_risk_mapping": {"0": "low", "1": "high"},
        },
        "weibo": {
            # 与 Emocc-Weibo、pkl 对齐的是 weibo_1000 系列（非 weibo_data.csv，后者对齐 FeaLearner）
            "csv_path": "weibo/weibo_1000.csv",
            "emoji_csv_path": "weibo/weibo_1000_emoji_batch.csv",
            "user_id_column": "user_id",
            "post_column": "Post",
            "risk_column": "label",
            "emoji_column": "emoji_sequence",
            "timestamp_column": None,
            "display_name": "Weibo系列",
            "language": "zh",
            "class_system": "binary",
            "class_count": 2,
            "fine_labels": {"0": "无风险", "1": "高风险"},
            "coarse_risk_mapping": {"0": "low", "1": "high"},
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
                cleaned = post_str.replace('\\"', '"')
                items = ast.literal_eval(cleaned)
                if isinstance(items, list):
                    return [str(i).strip() for i in items if str(i).strip()]
            except Exception:
                pass
            # bigdata 中存在少量格式受损的列表字符串，这里做温和恢复：
            # 仅在已经明显是 [...] 结构时，按引号片段提取帖子，避免把普通文本切碎。
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

    def _parse_timestamps(self, timestamp_str: Optional[str]) -> List[str]:
        """解析时间戳列表，支持 bigdata 中的 Timestamp(...) 序列。"""
        if not timestamp_str:
            return []

        text = str(timestamp_str).strip()
        if not text:
            return []

        matches = re.findall(r"Timestamp\('([^']+)'\)", text)
        if matches:
            return matches

        if text.startswith("[") and text.endswith("]"):
            try:
                import ast
                items = ast.literal_eval(text)
                if isinstance(items, list):
                    return [str(i).strip() for i in items if str(i).strip()]
            except Exception:
                pass

        if "\n" in text:
            return [part.strip() for part in text.split("\n") if part.strip()]

        return [text]

    def _get_row_user_id(self, dataset_key: str, row: Dict[str, str], row_index: int) -> str:
        """获取行级用户标识。对于没有用户ID列的数据集，使用行号构造稳定ID。"""
        config = self.DATASET_CONFIG.get(dataset_key, {})
        user_id_column = config.get("user_id_column")

        if user_id_column:
            value = row.get(user_id_column, "")
            user_id = str(value).strip()
            if user_id:
                return user_id

        return f"row_{row_index}"

    def _normalize_emoji_user_key(self, dataset_key: str, user_id: str) -> str:
        """归一化 emoji 文件中的用户键，兼容 bigdata 的 user_0 / 0。"""
        if dataset_key == "bigdata":
            if user_id.startswith("user_"):
                return user_id.split("user_", 1)[1]
            return user_id
        return user_id

    def _resolve_emoji_sequence(self, emoji_data: Dict[str, str], dataset_key: str, user_id: str, row_index: int) -> str:
        """按数据集规则解析当前行对应的 emoji 序列。"""
        row_key = f"row_{row_index}"

        # bigdata 的 emoji 批次文件 user_id 列存在大量重复，实际应按行顺序与主 CSV 对齐
        if dataset_key == "bigdata":
            return emoji_data.get(row_key, "")

        if dataset_key == "sigir":
            return emoji_data.get(row_key, "")

        normalized_user_id = self._normalize_emoji_user_key(dataset_key, user_id)
        return emoji_data.get(normalized_user_id, "") or emoji_data.get(row_key, "")

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
                for row_index, row in enumerate(reader):
                    # 规范化字段名（移除 BOM）
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}
                    # 尝试获取 emoji_sequence
                    emoji_col = config.get("emoji_column") or "Post"
                    emoji_seq = row.get(emoji_col)
                    if emoji_seq:
                        # 清理不可见字符，但保留 emoji
                        cleaned = emoji_seq.replace(chr(0x200B), '').replace(chr(0x200C), '').replace(chr(0x200D), '').replace(chr(0xFEFF), '').replace(chr(0xFFFD), '')
                        row_key = f"row_{row_index + 1}"
                        emoji_data[row_key] = cleaned

                        user_id_column = config.get("user_id_column")
                        if user_id_column and dataset_key != "bigdata":
                            uid_raw = row.get(user_id_column, row.get("User", ""))
                            uid = self._normalize_emoji_user_key(dataset_key, str(uid_raw).strip())
                            if uid:
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
                for row_index, row in enumerate(reader, start=1):
                    row_count += 1
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}
                    if user_id_col:
                        # 有 user_id 列的数据集
                        uid = row.get(user_id_col, "")
                        if uid:
                            users_set.add(uid)
                    else:
                        # 没有 user_id 列的数据集，每行算一个用户
                        users_set.add(f"row_{row_index}")

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

                for row_index, row in enumerate(reader, start=1):
                    # 规范化字段名（移除 BOM）
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}

                    posts_raw = row.get(cfg["post_column"], "")
                    uid = self._get_row_user_id(dataset_key, row, row_index)

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
                        emoji_seq = self._resolve_emoji_sequence(emoji_data, dataset_key, uid, row_index)
                        user_emojis[uid] = bool(emoji_seq)
                        user_emoji_seqs[uid] = emoji_seq
                    else:
                        user_posts[uid].extend(posts)
                        if risk_val > user_risks[uid]:
                            user_risks[uid] = risk_val
                        emoji_seq = self._resolve_emoji_sequence(emoji_data, dataset_key, uid, row_index)
                        if emoji_seq:
                            user_emojis[uid] = True
                            if not user_emoji_seqs.get(uid):
                                user_emoji_seqs[uid] = emoji_seq

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

    def get_builtin_csv_archives_page(
        self,
        dataset_key: str,
        risk_level: Optional[str] = None,
        keyword: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[ArchiveInfo], int]:
        """
        MySQL 尚未同步该数据源时，从内建 CSV 聚合用户列表（user_id 为与入库一致的哈希）。
        供风险检测选人、档案列表等接口回退使用。
        """
        if dataset_key not in self.DATASET_CONFIG:
            return [], 0
        csv_path = self._get_csv_full_path(self.DATASET_CONFIG[dataset_key]["csv_path"])
        if not csv_path.exists():
            return [], 0
        raw = self._get_aggregated_archives(dataset_key)
        if not raw:
            return [], 0
        if risk_level:
            raw = [a for a in raw if a.get("risk_level") == risk_level]
        if keyword and str(keyword).strip():
            kw = str(keyword).strip().lower()
            raw = [a for a in raw if kw in (a.get("user_id") or "").lower()]
        raw.sort(key=lambda x: x["user_id"])
        total = len(raw)
        start = (page - 1) * page_size
        chunk = raw[start : start + page_size]
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
            for a in chunk
        ]
        return result, total

    # ==================== 用户贴文查询 ====================

    def _calculate_importance_score(self, content: str) -> float:
        """根据贴文内容中的风险信号词汇计算重要性分数。"""
        return calculate_importance_score(content)

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
                    for row_index, row in enumerate(reader, start=1):
                        # 规范化字段名（移除 BOM）
                        row = {self._normalize_fieldname(k): v for k, v in row.items()}

                        uid = self._get_row_user_id(ds_key, row, row_index)
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
                        emoji_seq_str = self._resolve_emoji_sequence(emoji_data, ds_key, uid, row_index)
                        emoji_list: List[str] = []
                        if emoji_seq_str:
                            # emoji 序列是逗号分隔的字符串，每个元素对应一个帖子
                            emoji_list = [e.strip() for e in emoji_seq_str.split(",") if e.strip()]

                        timestamp_values: List[str] = []
                        timestamp_column = cfg.get("timestamp_column")
                        if timestamp_column:
                            timestamp_values = self._parse_timestamps(row.get(timestamp_column))

                        for idx, content in enumerate(posts):
                            evidence = analyze_risk_evidence(content)
                            importance = evidence["importance_score"]

                            # 获取对应的 emoji 序列（如果有的话）
                            post_emoji = emoji_list[idx] if idx < len(emoji_list) else None
                            has_emoji = bool(post_emoji)

                            post_info = PostInfo(
                                user_id=user_hash,
                                post_index=idx + 1,
                                content=content,
                                risk_level=coarse,
                                risk_value=risk_val,
                                sentiment_score=None,
                                importance_score=importance,
                                timestamp=timestamp_values[idx] if idx < len(timestamp_values) else None,
                                has_emojis=has_emoji,
                                emoji_sequence=post_emoji,
                                evidence_domains=evidence["evidence_domains"],
                                evidence_summary=evidence["evidence_summary"],
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
                for row_index, row in enumerate(reader, start=1):
                    # 规范化字段名（移除 BOM）
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}

                    uid = self._get_row_user_id(dataset_key, row, row_index)
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

    def get_user_keywords(self, user_hash: str, top_n: int = 8) -> List[dict]:
        """从用户贴文中提取高频词汇"""
        posts, _ = self.get_user_posts(user_hash=user_hash, page=1, page_size=100)
        if not posts:
            return []
        return extract_keywords_from_texts([p.content for p in posts], top_n=top_n)

    def build_dataset_import_payload(self, dataset_key: str) -> Optional[dict]:
        """构建内置数据集的完整导入载荷，供 MySQL 同步使用。"""
        cfg = self.DATASET_CONFIG.get(dataset_key)
        if not cfg:
            return None

        csv_path = self._get_csv_full_path(cfg["csv_path"])
        if not csv_path.exists():
            return None

        emoji_data = self._load_emoji_data(dataset_key)
        aggregated: Dict[str, dict] = {}

        try:
            with open(csv_path, "r", encoding="utf-8-sig", errors="replace") as f:
                reader = csv.DictReader(f)
                for row_index, row in enumerate(reader, start=1):
                    row = {self._normalize_fieldname(k): v for k, v in row.items()}
                    raw_user_id = self._get_row_user_id(dataset_key, row, row_index)
                    user_hash = self._generate_user_hash(dataset_key, raw_user_id)
                    posts = self._parse_posts(row.get(cfg["post_column"], ""))

                    risk_str = row.get(cfg["risk_column"], "0")
                    try:
                        risk_val = int(float(risk_str))
                    except (TypeError, ValueError):
                        risk_val = 0

                    timestamp_values: List[str] = []
                    if cfg.get("timestamp_column"):
                        timestamp_values = self._parse_timestamps(row.get(cfg["timestamp_column"]))

                    emoji_seq_str = self._resolve_emoji_sequence(emoji_data, dataset_key, raw_user_id, row_index)
                    emoji_list = [e.strip() for e in emoji_seq_str.split(",") if e.strip()] if emoji_seq_str else []

                    bucket = aggregated.setdefault(user_hash, {
                        "user_hash": user_hash,
                        "raw_user_id": raw_user_id,
                        "dataset_key": dataset_key,
                        "risk_value": risk_val,
                        "risk_level": self._get_coarse_risk(dataset_key, risk_val),
                        "has_timestamp": False,
                        "has_emojis": False,
                        "posts": [],
                    })

                    if risk_val > bucket["risk_value"]:
                        bucket["risk_value"] = risk_val
                        bucket["risk_level"] = self._get_coarse_risk(dataset_key, risk_val)

                    for idx, content in enumerate(posts):
                        timestamp = timestamp_values[idx] if idx < len(timestamp_values) else None
                        emoji_sequence = emoji_list[idx] if idx < len(emoji_list) else None
                        bucket["posts"].append({
                            "content": content,
                            "timestamp": timestamp,
                            "emoji_sequence": emoji_sequence,
                            "risk_value": risk_val,
                        })
                        if timestamp:
                            bucket["has_timestamp"] = True
                        if emoji_sequence:
                            bucket["has_emojis"] = True
        except Exception as exc:
            print(f"[ERROR] build_dataset_import_payload failed for {dataset_key}: {exc}")
            return None

        archives = []
        random.seed(42)
        start_date = datetime(2026, 1, 1)
        end_date = datetime(2026, 4, 22, 23, 59, 59)
        total_seconds = (end_date - start_date).total_seconds()
        user_count = len(aggregated)
        import_times: List[datetime] = []

        for i in range(user_count):
            base_fraction = (i + 0.5) / user_count if user_count else 0.5
            jitter = random.uniform(-0.4 / max(user_count, 1), 0.4 / max(user_count, 1))
            fraction = max(0.001, min(0.999, base_fraction + jitter))
            import_times.append(start_date + timedelta(seconds=fraction * total_seconds))
        import_times.sort()

        for idx, user_hash in enumerate(sorted(aggregated.keys())):
            item = aggregated[user_hash]
            post_infos = []
            raw_scores: List[float] = []
            parsed_times: List[datetime] = []

            for post_index, raw_post in enumerate(item["posts"], start=1):
                raw_score = self._calculate_importance_score(raw_post["content"])
                raw_scores.append(raw_score)
                timestamp = raw_post["timestamp"]
                if timestamp:
                    try:
                        parsed_times.append(datetime.fromisoformat(timestamp))
                    except ValueError:
                        pass
                post_infos.append(PostInfo(
                    user_id=user_hash,
                    post_index=post_index,
                    content=raw_post["content"],
                    risk_level=item["risk_level"],
                    risk_value=raw_post["risk_value"],
                    sentiment_score=None,
                    importance_score=raw_score,
                    timestamp=timestamp,
                    has_emojis=bool(raw_post["emoji_sequence"]),
                    emoji_sequence=raw_post["emoji_sequence"],
                ))

            post_infos = self._normalize_importance_scores(post_infos)

            high_count = sum(1 for post in post_infos if (post.importance_score or 0) >= 0.7)
            medium_count = sum(1 for post in post_infos if 0.4 <= (post.importance_score or 0) < 0.7)
            low_count = len(post_infos) - high_count - medium_count
            avg_importance = sum((post.importance_score or 0) for post in post_infos) / len(post_infos) if post_infos else 0.0
            top_posts = sorted(post_infos, key=lambda post: post.importance_score or 0, reverse=True)[:3]

            archives.append({
                "user_hash": user_hash,
                "raw_user_id": item["raw_user_id"],
                "dataset_key": dataset_key,
                "post_count": len(post_infos),
                "risk_level": item["risk_level"],
                "risk_value": item["risk_value"],
                "label": item["risk_value"],
                "has_timestamp": item["has_timestamp"],
                "post_timestamp_start": min(parsed_times).isoformat(sep=" ") if parsed_times else None,
                "post_timestamp_end": max(parsed_times).isoformat(sep=" ") if parsed_times else None,
                "has_emojis": item["has_emojis"],
                "import_timestamp": import_times[idx].isoformat(sep=" ") if idx < len(import_times) else datetime.now().isoformat(sep=" "),
                "high_importance_count": high_count,
                "medium_importance_count": medium_count,
                "low_importance_count": low_count,
                "avg_importance_score": round(avg_importance, 4),
                "top_posts_summary": [
                    {
                        "postIndex": post.post_index,
                        "importanceScore": round(post.importance_score or 0, 4),
                        "contentPreview": post.content[:120],
                    }
                    for post in top_posts
                ],
                "posts": [
                    {
                        "post_index": post.post_index,
                        "content": post.content,
                        "importance_score": round(post.importance_score or 0, 4),
                        "importance_level": "high" if (post.importance_score or 0) >= 0.7 else "medium" if (post.importance_score or 0) >= 0.4 else "low",
                        "timestamp": post.timestamp,
                        "emoji_count": len(post.emoji_sequence) if post.emoji_sequence else 0,
                        "emoji_sequence": post.emoji_sequence,
                        "fine_risk_value": post.risk_value,
                    }
                    for post in post_infos
                ],
            })

        info = self.get_dataset_info(dataset_key)
        return {
            "dataset": {
                "dataset_key": dataset_key,
                "display_name": cfg["display_name"],
                "description": f"{cfg['display_name']}自杀风险数据集",
                "language": cfg["language"],
                "class_system": cfg["class_system"],
                "class_count": cfg["class_count"],
                "fine_labels": cfg["fine_labels"],
                "coarse_risk_mapping": cfg["coarse_risk_mapping"],
                "total_users": info.total_users if info else len(archives),
                "total_posts": info.total_posts if info else sum(a["post_count"] for a in archives),
                "total_archives": len(archives),
            },
            "archives": archives,
        }
