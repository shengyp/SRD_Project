from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


@dataclass(frozen=True)
class EmoccDatasetSpec:
    dataset_key: str
    display_name: str
    model_name: str
    root_dir_name: str
    class_num: int
    class_labels: Dict[int, str]
    coarse_risk_mapping: Dict[int, str]
    risk_score_mapping: Dict[int, float]
    language: str
    encoder_model_name: str
    max_posts: int
    max_emojis_per_post: int = 10
    checkpoint_file: str = "Emocc_model/checkpoints/emocc_model.pth"
    emoji_csv_file: str = ""
    emoji2vec_file: str = "pre-trained/emoji2vec.bin"
    embedding_pickle_file: Optional[str] = None
    description: str = ""
    features: List[str] = field(default_factory=list)
    performance_metrics: Dict[str, float] = field(default_factory=dict)

    def class_label_text(self) -> str:
        return "；".join(f"{idx}={label}" for idx, label in self.class_labels.items())

    def project_root(self) -> Path:
        return Path(__file__).resolve().parents[3]

    def emocc_root(self) -> Path:
        return self.project_root() / "Emocc" / self.root_dir_name

    def checkpoint_path(self) -> Path:
        return self.emocc_root() / self.checkpoint_file

    def emoji_csv_path(self) -> Path:
        return self.emocc_root() / self.emoji_csv_file

    def emoji2vec_path(self) -> Path:
        return self.emocc_root() / self.emoji2vec_file

    def embedding_pickle_path(self) -> Optional[Path]:
        if not self.embedding_pickle_file:
            return None
        return self.emocc_root() / self.embedding_pickle_file


EMOCC_DATASET_SPECS: Dict[str, EmoccDatasetSpec] = {
    "reddit": EmoccDatasetSpec(
        dataset_key="reddit",
        display_name="Reddit 系列",
        model_name="Emocc-Reddit",
        root_dir_name="reddit",
        class_num=5,
        class_labels={
            0: "无风险",
            1: "极低风险",
            2: "低风险",
            3: "中风险",
            4: "高风险",
        },
        coarse_risk_mapping={0: "low", 1: "low", 2: "medium", 3: "medium", 4: "high"},
        risk_score_mapping={0: 0.10, 1: 0.30, 2: 0.50, 3: 0.70, 4: 0.90},
        language="en",
        encoder_model_name="bert-base-uncased",
        max_posts=50,
        emoji_csv_file="data/reddit_500_emoji.csv",
        embedding_pickle_file="data/reddit_500_bert_embeddings.pkl",
        description="BERT + Emoji 双模态层次融合模型，面向 Reddit 五分类自杀风险检测。",
        features=[
            "输出五分类类别概率",
            "输出帖子重要性注意力分数",
            "融合 Emoji 情绪线索与文本语义",
            "支持 qwen-flash 二阶段综合解读",
        ],
        performance_metrics={
            "accuracy": 0.849,
            "precision": 0.835,
            "recall": 0.828,
            "f1": 0.831,
            "auc": 0.889,
        },
    ),
    "bigdata": EmoccDatasetSpec(
        dataset_key="bigdata",
        display_name="Bigdata 系列",
        model_name="Emocc-Bigdata",
        root_dir_name="bigdata",
        class_num=4,
        class_labels={0: "无风险", 1: "低风险", 2: "中风险", 3: "高风险"},
        coarse_risk_mapping={0: "low", 1: "low", 2: "medium", 3: "high"},
        risk_score_mapping={0: 0.10, 1: 0.35, 2: 0.65, 3: 0.90},
        language="en",
        encoder_model_name="bert-base-uncased",
        max_posts=300,
        emoji_csv_file="data/bigdata_emoji_batch.csv",
        embedding_pickle_file="data/bigdata_bert.pkl",
        description="BERT + Emoji 双模态层次融合模型，面向 Bigdata 四分类风险检测。",
        features=[
            "输出四分类类别概率",
            "支持长序列帖子建模",
            "输出帖子级重要性分数",
            "适配 Bigdata 风险标签体系",
        ],
        performance_metrics={
            "acc": 0.6000,
            "gp": 0.79,
            "gr": 0.71,
            "f_score": 0.75,
            "oe": 0.12,
            "macro_f1": 0.4649,
        },
    ),
    "sigir": EmoccDatasetSpec(
        dataset_key="sigir",
        display_name="SIGIR 系列",
        model_name="Emocc-SIGIR",
        root_dir_name="sigir",
        class_num=2,
        class_labels={0: "无风险", 1: "高风险"},
        coarse_risk_mapping={0: "low", 1: "high"},
        risk_score_mapping={0: 0.10, 1: 0.90},
        language="en",
        encoder_model_name="bert-base-uncased",
        max_posts=1,
        emoji_csv_file="data/sigir_emojis.csv",
        embedding_pickle_file="data/sigir_bert.pkl",
        description="BERT + Emoji 双模态层次融合模型，面向 SIGIR 二分类高风险检测。",
        features=[
            "输出二分类类别概率",
            "适配单帖子样本结构",
            "输出帖子重要性分数",
            "适配 SIGIR 风险标签体系",
        ],
    ),
    "weibo": EmoccDatasetSpec(
        dataset_key="weibo",
        display_name="Weibo 系列",
        model_name="Emocc-Weibo",
        root_dir_name="weibo",
        class_num=2,
        class_labels={0: "无风险", 1: "高风险"},
        coarse_risk_mapping={0: "low", 1: "high"},
        risk_score_mapping={0: 0.10, 1: 0.90},
        language="zh",
        encoder_model_name="bert-base-chinese",
        max_posts=100,
        emoji_csv_file="data/weibo_1000_emoji_batch.csv",
        embedding_pickle_file="data/user_post_embeddings_filtered.pkl",
        description=(
            "BERT + Emoji 双模态层次融合模型，面向微博二分类高风险检测。"
            " 与仓库 datasets/weibo/weibo_1000.csv（及 emoji 批）行序对齐，对应本目录 data 下 pkl；"
            " 与 FeaLearner 使用的 weibo_data.csv 子集不同。"
        ),
        features=[
            "输出二分类类别概率",
            "适配中文微博文本",
            "输出帖子重要性分数",
            "适配微博风险标签体系",
        ],
    ),
}


def get_emocc_dataset_spec(dataset_key: str) -> EmoccDatasetSpec:
    key = (dataset_key or "reddit").strip().lower()
    if key not in EMOCC_DATASET_SPECS:
        raise KeyError(f"不支持的 Emocc 数据集: {dataset_key}")
    return EMOCC_DATASET_SPECS[key]


def list_emocc_dataset_specs() -> List[EmoccDatasetSpec]:
    return [EMOCC_DATASET_SPECS[key] for key in ("reddit", "bigdata", "sigir", "weibo")]
