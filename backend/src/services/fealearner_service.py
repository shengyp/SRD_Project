"""
FeaLearner 本地推理服务
封装 Fealeaner/predict_with_bestmodel.py，提供按 user_hash 的单用户预测能力。

嵌入路径约定（本仓库副本）：
- Reddit / SIGIR / BigData：优先使用 Emocc/<数据集>/data/ 下与 Emocc 部署一致的 .pkl
- Weibo：使用 Fealeaner/data/user_post_embeddings_bert_wwm.pkl（与 Emocc 的 weibo 嵌入不同）
特征 CSV 与 checkpoint 仍使用 Fealeaner/feature_data、Fealeaner/bestmodel。
"""
from __future__ import annotations

import csv
import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class FeaLearnerInferenceResult:
    user_hash: str
    dataset: str
    person_id: Optional[str]
    pred_label: int
    true_label: Optional[int]
    risk_level: str
    risk_score: float
    confidence: float
    probabilities: Dict[str, float]
    model_info: Dict[str, Any]


# 与 Fealeaner/predict_with_bestmodel.py 中 _default_paths 支持的数据集一致
FEAL_SUPPORTED_DATASETS = frozenset({"reddit", "weibo", "bigdata", "sigir"})

_FEAL_DATASET_LABEL = {
    "reddit": "Reddit",
    "weibo": "Weibo",
    "bigdata": "BigData",
    "sigir": "SIGIR",
}

FEAL_MODEL_CATALOG_DISPLAY = "FeaLearner"

FEAL_MODEL_CENTER_DESCRIPTION = (
    "基于 BERT 文本嵌入与统计特征的本地深度分类模型。"
    "风险任务按所选数据源（reddit、weibo、bigdata、sigir）推理；"
    "Reddit/SIGIR/BigData 的嵌入 pkl 与 Emocc 部署目录一致（Emocc/<源>/data/），"
    "Weibo 嵌入使用 Fealeaner/data/user_post_embeddings_bert_wwm.pkl（与 Emocc Weibo 不同）。"
    "特征与权重仍来自 Fealeaner/feature_data、Fealeaner/bestmodel。"
    "任务分类数：Reddit 五类，Weibo/SIGIR 二类，BigData 四类。"
)

FEAL_MODEL_CENTER_CODE = "fealearner"
FEAL_MODEL_CENTER_WEIGHTS_DISPLAY = (
    "Fealeaner/bestmodel：reddit→my_reddit_model.pth；weibo→my_weibo_model.pth；"
    "bigdata→my_bigdata_model.pth；sigir→my_sigir_model.pth（由任务 data_source 选用）"
)
FEAL_MODEL_CENTER_EMBED_DISPLAY = (
    "Emocc/reddit/data/bert_embeddings.pkl；Emocc/bigdata/data/bigdata_bert_embeddings.pkl；"
    "Emocc/sigir/data/sigir_bert_embeddings.pkl；Weibo→Fealeaner/data/user_post_embeddings_bert_wwm.pkl"
)


def fealearner_model_display_name(data_source: str | None = None) -> str:
    """任务/报告中的展示名：带数据源后缀。"""
    ds = (data_source or "reddit").strip().lower()
    if ds not in FEAL_SUPPORTED_DATASETS:
        ds = "reddit"
    return f"FeaLearner-{_FEAL_DATASET_LABEL[ds]}"


def fealearner_dataset_label(data_source: str) -> str:
    ds = (data_source or "reddit").strip().lower()
    if ds not in FEAL_SUPPORTED_DATASETS:
        ds = "reddit"
    return _FEAL_DATASET_LABEL[ds]


class FeaLearnerInferenceService:
    """FeaLearner 推理服务。"""

    def __init__(self) -> None:
        self._predict_module = None
        self._module_loaded = False

    def _project_root(self) -> Path:
        return Path(__file__).resolve().parent.parent.parent.parent

    def _fealeaner_root(self) -> Path:
        return self._project_root() / "Fealeaner"

    def _emocc_root(self) -> Path:
        return self._project_root() / "Emocc"

    def _embedding_candidates(self, dataset: str) -> List[Path]:
        """按优先级返回嵌入 pkl 候选路径（首项存在即用）。"""
        root = self._project_root()
        fl = self._fealeaner_root()
        em = self._emocc_root()
        ds = (dataset or "").strip().lower()
        if ds == "reddit":
            return [
                em / "reddit" / "data" / "bert_embeddings.pkl",
                fl / "data" / "reddit_bert_embeddings.pkl",
                fl / "data" / "bert_embeddings.pkl",
                root / "datasets" / "reddit" / "reddit_500_bert_embeddings.pkl",
            ]
        if ds == "bigdata":
            return [
                em / "bigdata" / "data" / "bigdata_bert.pkl",
                em / "bigdata" / "data" / "bigdata_bert_embeddings.pkl",
                fl / "data" / "bigdata_bert_embeddings.pkl",
            ]
        if ds == "sigir":
            return [
                em / "sigir" / "data" / "sigir_bert.pkl",
                em / "sigir" / "data" / "sigir_bert_embeddings.pkl",
                fl / "data" / "sigir_bert_embeddings.pkl",
            ]
        if ds == "weibo":
            return [fl / "data" / "user_post_embeddings_bert_wwm.pkl"]
        return []

    def _load_predict_module(self):
        if self._module_loaded and self._predict_module is not None:
            return self._predict_module

        script_path = self._fealeaner_root() / "predict_with_bestmodel.py"
        if not script_path.exists():
            raise FileNotFoundError(f"未找到 FeaLearner 预测脚本: {script_path}")

        spec = importlib.util.spec_from_file_location("fealearner_predict_module", script_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("加载 FeaLearner 预测模块失败")

        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self._predict_module = module
        self._module_loaded = True
        return module

    def _resolve_person_id_from_hash(self, dataset_key: str, user_hash: str) -> Optional[str]:
        from src.services.dataset_csv_service import DatasetCSVService

        csv_svc = DatasetCSVService()
        cfg = csv_svc.DATASET_CONFIG.get(dataset_key)
        if not cfg:
            return None

        csv_path = csv_svc._get_csv_full_path(cfg["csv_path"])
        if not csv_path.exists():
            return None

        with open(csv_path, "r", encoding="utf-8-sig", errors="replace") as f:
            reader = csv.DictReader(f)
            for row_index, row in enumerate(reader, start=1):
                row = {csv_svc._normalize_fieldname(k): v for k, v in row.items()}
                uid = csv_svc._get_row_user_id(dataset_key, row, row_index)
                expected_hash = csv_svc._generate_user_hash(dataset_key, uid)
                if expected_hash == user_hash:
                    if dataset_key == "bigdata" and uid.startswith("user_"):
                        return uid.split("user_", 1)[1]
                    return uid
        return None

    def _resolve_sample_index_from_hash(self, dataset_key: str, user_hash: str) -> Optional[int]:
        from src.services.dataset_csv_service import DatasetCSVService

        csv_svc = DatasetCSVService()
        cfg = csv_svc.DATASET_CONFIG.get(dataset_key)
        if not cfg:
            return None

        csv_path = csv_svc._get_csv_full_path(cfg["csv_path"])
        if not csv_path.exists():
            return None

        with open(csv_path, "r", encoding="utf-8-sig", errors="replace") as f:
            reader = csv.DictReader(f)
            for row_index, row in enumerate(reader, start=1):
                row = {csv_svc._normalize_fieldname(k): v for k, v in row.items()}
                uid = csv_svc._get_row_user_id(dataset_key, row, row_index)
                expected_hash = csv_svc._generate_user_hash(dataset_key, uid)
                if expected_hash == user_hash:
                    return row_index - 1
        return None

    def _default_paths(self, dataset: str) -> Tuple[Path, Path, Path]:
        module = self._load_predict_module()
        emb, feat, ckpt = module._default_paths(dataset)
        emb_path = Path(emb)
        feat_path = Path(feat)
        ckpt_path = Path(ckpt)

        for candidate in self._embedding_candidates(dataset):
            if candidate.exists():
                emb_path = candidate
                break

        if dataset == "reddit" and not emb_path.exists():
            for candidate in (
                self._fealeaner_root() / "data" / "bert_embeddings.pkl",
                self._fealeaner_root() / "data" / "reddit_bert_embeddings.pkl",
            ):
                if candidate.exists():
                    emb_path = candidate
                    break

        return emb_path, feat_path, ckpt_path

    @staticmethod
    def _map_label_to_risk(dataset: str, pred_label: int) -> Tuple[str, float]:
        if dataset == "reddit":
            mapping = {
                0: ("low", 0.10),
                1: ("low", 0.30),
                2: ("medium", 0.50),
                3: ("medium", 0.70),
                4: ("high", 0.90),
            }
            return mapping.get(pred_label, ("medium", 0.50))
        if dataset in ("weibo", "sigir"):
            return ("high", 0.90) if pred_label >= 1 else ("low", 0.20)
        if dataset == "bigdata":
            mapping = {
                0: ("low", 0.15),
                1: ("low", 0.35),
                2: ("medium", 0.65),
                3: ("high", 0.90),
            }
            return mapping.get(pred_label, ("medium", 0.50))
        return ("medium", 0.50)

    def predict_single_user(self, user_hash: str, dataset: str = "reddit", seed: int = 24) -> FeaLearnerInferenceResult:
        module = self._load_predict_module()
        person_id = self._resolve_person_id_from_hash(dataset, user_hash)
        sample_index = self._resolve_sample_index_from_hash(dataset, user_hash)
        if person_id is None and sample_index is None:
            raise ValueError(f"无法在 {dataset} 数据集中根据 user_hash={user_hash} 找到原始 user_id")

        emb, feat, ckpt = self._default_paths(dataset)
        for p, name in ((emb, "embeddings"), (feat, "features"), (ckpt, "checkpoint")):
            if not p.exists():
                raise FileNotFoundError(f"FeaLearner {name} 文件不存在: {p}")

        use_sample_index = dataset in {"bigdata"} and sample_index is not None
        result = module.predict_one_person(
            dataset=dataset,
            emb_path=emb,
            feat_path=feat,
            ckpt_path=ckpt,
            sample_index=sample_index if use_sample_index else None,
            person_id=None if use_sample_index else person_id,
            output_path=None,
            seed=seed,
        )

        pred_label = int(result.get("pred_label", 0))
        true_label = result.get("true_label")
        probabilities = result.get("probabilities", {}) or {}
        confidence = float(max(probabilities.values())) if probabilities else 0.0
        risk_level, risk_score = self._map_label_to_risk(dataset, pred_label)

        return FeaLearnerInferenceResult(
            user_hash=user_hash,
            dataset=dataset,
            person_id=result.get("person_id"),
            pred_label=pred_label,
            true_label=int(true_label) if true_label is not None else None,
            risk_level=risk_level,
            risk_score=risk_score,
            confidence=confidence,
            probabilities={str(k): float(v) for k, v in probabilities.items()},
            model_info={
                "model_type": "fealearner_local",
                "dataset": dataset,
                "person_id": result.get("person_id"),
                "sample_index": result.get("sample_index"),
                "embedding_path": str(emb),
            },
        )


_fealearner_service: Optional[FeaLearnerInferenceService] = None


def get_fealearner_service() -> FeaLearnerInferenceService:
    global _fealearner_service
    if _fealearner_service is None:
        _fealearner_service = FeaLearnerInferenceService()
    return _fealearner_service
