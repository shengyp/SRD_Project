"""
FeaLearner 本地推理服务
封装 Fealeaner/predict_with_bestmodel.py，提供按 user_hash 的单用户预测能力。
"""
from __future__ import annotations

import csv
import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


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


class FeaLearnerInferenceService:
    """FeaLearner 推理服务。"""

    def __init__(self) -> None:
        self._predict_module = None
        self._module_loaded = False

    def _project_root(self) -> Path:
        return Path(__file__).resolve().parent.parent.parent.parent

    def _fealeaner_root(self) -> Path:
        return self._project_root() / "Fealeaner"

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
        # 复用 DatasetCSVService 的配置与哈希规则，确保映射一致
        from src.services.dataset_csv_service import DatasetCSVService

        csv_svc = DatasetCSVService()
        cfg = csv_svc.DATASET_CONFIG.get(dataset_key)
        if not cfg:
            return None

        csv_path = csv_svc._get_csv_full_path(cfg["csv_path"])
        if not csv_path.exists():
            return None

        user_id_col = cfg.get("user_id_column") or "User"
        with open(csv_path, "r", encoding="utf-8-sig", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                uid_raw = row.get(user_id_col, "")
                uid = str(uid_raw).strip()
                if not uid:
                    continue
                expected_hash = csv_svc._generate_user_hash(dataset_key, uid)
                if expected_hash == user_hash:
                    return uid
        return None

    def _default_paths(self, dataset: str) -> Tuple[Path, Path, Path]:
        module = self._load_predict_module()
        emb, feat, ckpt = module._default_paths(dataset)
        emb_path = Path(emb)
        feat_path = Path(feat)
        ckpt_path = Path(ckpt)

        # 兼容当前目录命名：Reddit 嵌入文件可能为 bert_embeddings.pkl
        if dataset == "reddit" and not emb_path.exists():
            legacy_candidates = [
                self._fealeaner_root() / "data" / "bert_embeddings.pkl",
            ]
            for candidate in legacy_candidates:
                if candidate.exists():
                    emb_path = candidate
                    break

        return emb_path, feat_path, ckpt_path

    @staticmethod
    def _map_label_to_risk(dataset: str, pred_label: int) -> Tuple[str, float]:
        # 与现有页面等级保持一致：low / medium / high
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
        if not person_id:
            raise ValueError(f"无法在 {dataset} 数据集中根据 user_hash={user_hash} 找到原始 user_id")

        emb, feat, ckpt = self._default_paths(dataset)
        for p, name in ((emb, "embeddings"), (feat, "features"), (ckpt, "checkpoint")):
            if not p.exists():
                raise FileNotFoundError(f"FeaLearner {name} 文件不存在: {p}")

        result = module.predict_one_person(
            dataset=dataset,
            emb_path=emb,
            feat_path=feat,
            ckpt_path=ckpt,
            sample_index=None,
            person_id=person_id,
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
            },
        )


_fealearner_service: Optional[FeaLearnerInferenceService] = None


def get_fealearner_service() -> FeaLearnerInferenceService:
    global _fealearner_service
    if _fealearner_service is None:
        _fealearner_service = FeaLearnerInferenceService()
    return _fealearner_service
