"""
Emocc 多数据集推理服务

统一支持 Reddit / Bigdata / SIGIR / Weibo 四套 Emocc 模型：
1. 按数据集动态加载对应模型权重与 Emoji 词表
2. 输出类别概率、帖子重要性分数、风险等级、模型元信息
3. 仅使用各数据集已预编码的 pkl 样本，不进行实时 BERT 编码
"""
from __future__ import annotations

import ast
import csv
import importlib.util
import hashlib
import pickle
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F

from src.services.emocc_config import (
    EmoccDatasetSpec,
    get_emocc_dataset_spec,
    list_emocc_dataset_specs,
)


@dataclass
class EmoccInferenceResult:
    user_hash: str
    dataset_key: str
    model_name: str
    risk_level: str
    risk_score: float
    risk_class: int
    confidence: float
    post_attention_scores: List[Dict[str, Any]]
    model_info: Dict[str, Any]
    mapping_info: Dict[str, Any]


@dataclass
class ModelArgs:
    dropout: float = 0.5
    gru_size: int = 128
    class_num: int = 5


@dataclass
class LoadedDatasetRuntime:
    spec: EmoccDatasetSpec
    model: nn.Module
    emoji_to_id: Dict[str, int]
    model_config: Dict[str, Any]


@dataclass
class PrecomputedSample:
    dataset_key: str
    row_index: int
    raw_user_id: str
    user_hash: str
    embeddings: np.ndarray
    sample_posts: List[str]
    mapping_mode: str


class GlobalSelfAttentionWithScores(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: Optional[int] = None):
        super().__init__()
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim or input_dim
        self.W_Q = nn.Linear(input_dim, self.hidden_dim)
        self.W_K = nn.Linear(input_dim, self.hidden_dim)
        self.W_V = nn.Linear(input_dim, self.hidden_dim)
        self.scale = torch.sqrt(torch.tensor(self.hidden_dim, dtype=torch.float32))
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.W_Q.weight)
        nn.init.xavier_uniform_(self.W_K.weight)
        nn.init.xavier_uniform_(self.W_V.weight)
        nn.init.zeros_(self.W_Q.bias)
        nn.init.zeros_(self.W_K.bias)
        nn.init.zeros_(self.W_V.bias)

    def forward(self, x, mask=None, return_scores: bool = False):
        Q = self.W_Q(x)
        K = self.W_K(x)
        V = self.W_V(x)
        attn_scores = torch.matmul(Q, K.transpose(-2, -1)) / self.scale
        if mask is not None:
            attn_mask = mask.unsqueeze(1)
            attn_scores = attn_scores.masked_fill(attn_mask == 0, -1e9)
        attn_weights = F.softmax(attn_scores, dim=-1)
        V_common = torch.matmul(attn_weights, V)
        if mask is not None:
            V_common = V_common * mask.unsqueeze(-1).type_as(V_common)
        V_common = V_common.sum(dim=1)
        if return_scores:
            post_scores = torch.diagonal(attn_weights, dim1=1, dim2=2)
            return V_common, post_scores
        return V_common


class BertEmojiModelWithAttention(nn.Module):
    def __init__(
        self,
        args: ModelArgs,
        emoji_vocab_size: int,
        device: torch.device,
        adaptive_gate_cls,
        mlp_cls,
        emoji_weights: Optional[torch.Tensor] = None,
        is_pretrain_emoji: bool = False,
    ):
        super().__init__()
        self.args = args
        self.device = device
        self.dropout = args.dropout
        self.gru_size = args.gru_size
        self.class_num = args.class_num
        self.bert_dim = 768
        self.emoji_dim = 300

        if is_pretrain_emoji and emoji_weights is not None:
            self.emoji_embed = nn.Embedding.from_pretrained(emoji_weights, freeze=False)
        else:
            self.emoji_embed = nn.Embedding(emoji_vocab_size, self.emoji_dim)

        self.emoji_embed_drop = nn.Dropout(args.dropout)
        self.gru1 = nn.GRU(
            input_size=self.bert_dim,
            hidden_size=self.gru_size,
            num_layers=1,
            bidirectional=True,
            batch_first=True,
        )
        self.gru1_drop = nn.Dropout(args.dropout)
        self.global_attention = GlobalSelfAttentionWithScores(
            input_dim=2 * self.gru_size + self.emoji_dim,
            hidden_dim=2 * self.gru_size,
        )
        self.adaptive_gate_fusion = adaptive_gate_cls(2 * self.gru_size)
        self.class_fc = mlp_cls(
            input_dim=2 * self.gru_size,
            embed_dims=[2 * self.gru_size, self.gru_size, self.gru_size // 2],
            dropout=self.dropout,
            class_num=self.class_num,
        )
        self._init_weights()

    def _init_weights(self) -> None:
        for name, param in self.gru1.named_parameters():
            if "weight" in name:
                nn.init.xavier_uniform_(param)

    def forward(self, bert_embeddings, emoji_ids, post_masks, emoji_masks, return_attention: bool = False):
        B, T, _ = bert_embeddings.size()
        post_lengths = post_masks.sum(dim=1).cpu()
        non_zero_indices = (post_lengths > 0).nonzero(as_tuple=True)[0]
        if len(non_zero_indices) == 0:
            logits = torch.zeros(B, self.class_num, device=self.device)
            if return_attention:
                return logits, torch.zeros(B, T, device=self.device)
            return logits

        valid_bert = bert_embeddings[non_zero_indices]
        valid_lengths = post_lengths[non_zero_indices]
        packed_bert = nn.utils.rnn.pack_padded_sequence(
            valid_bert, valid_lengths, batch_first=True, enforce_sorted=False
        )
        gru1_output, _ = self.gru1(packed_bert)
        gru1_output, _ = nn.utils.rnn.pad_packed_sequence(gru1_output, batch_first=True)
        gru1_output = self.gru1_drop(gru1_output)

        emoji_embeds = self.emoji_embed(emoji_ids)
        emoji_embeds = self.emoji_embed_drop(emoji_embeds)
        emoji_mask_expanded = emoji_masks.unsqueeze(-1).float()
        emoji_embeds_masked = emoji_embeds * emoji_mask_expanded
        emoji_counts = emoji_masks.sum(dim=-1, keepdim=True).clamp(min=1)
        emoji_mean = emoji_embeds_masked.sum(dim=2) / emoji_counts

        max_len = max(int(valid_lengths.max().item()), 1)
        valid_emoji = emoji_mean[non_zero_indices][:, :max_len, :]
        fused_features = torch.cat([gru1_output, valid_emoji], dim=-1)
        valid_post_masks = post_masks[non_zero_indices][:, :max_len]

        last_indices = (
            valid_post_masks.cumsum(dim=1) == valid_post_masks.sum(dim=1, keepdim=True)
        ).float()
        V_short_valid = (gru1_output * last_indices.unsqueeze(-1)).sum(dim=1)
        V_common_valid, post_attn_scores_valid = self.global_attention(
            fused_features, mask=valid_post_masks, return_scores=True
        )

        V_short = torch.zeros(B, 2 * self.gru_size, device=self.device)
        V_common = torch.zeros(B, 2 * self.gru_size, device=self.device)
        V_short[non_zero_indices] = V_short_valid
        V_common[non_zero_indices] = V_common_valid

        post_attn_scores = torch.zeros(B, T, device=self.device)
        post_attn_scores[non_zero_indices, :post_attn_scores_valid.size(1)] = post_attn_scores_valid

        V_final = self.adaptive_gate_fusion(V_short, V_common)
        logits = self.class_fc(V_final)
        if return_attention:
            return logits, post_attn_scores
        return logits


class EmoccInferenceService:
    def __init__(self):
        self.device = torch.device("cpu")
        self._runtimes: Dict[str, LoadedDatasetRuntime] = {}
        self._embedding_indices: Dict[str, Dict[str, Any]] = {}

    @property
    def is_loaded(self) -> bool:
        return bool(self._runtimes)

    def is_dataset_loaded(self, dataset_key: str) -> bool:
        return dataset_key in self._runtimes

    def _load_python_module(self, module_name: str, file_path: Path):
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"无法加载模块: {file_path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module

    def _load_dataset_modules(self, dataset_key: str):
        spec = get_emocc_dataset_spec(dataset_key)
        module_prefix = f"emocc_{dataset_key}"
        model_module = self._load_python_module(
            f"{module_prefix}_model",
            spec.emocc_root() / "Emocc_model" / "model.py",
        )
        emoji_utils_module = self._load_python_module(
            f"{module_prefix}_emoji_utils",
            spec.emocc_root() / "Emocc_model" / "utils" / "emoji_utils.py",
        )
        return model_module, emoji_utils_module

    @staticmethod
    def _normalize_embeddings(bert_embeddings: Any) -> np.ndarray:
        arr = np.asarray(bert_embeddings)
        if arr.ndim == 3 and arr.shape[1] == 1 and arr.shape[2] == 768:
            arr = arr[:, 0, :]
        elif arr.ndim == 3 and arr.shape[0] == 1 and arr.shape[2] == 768:
            arr = arr[0, :, :]
        elif arr.ndim == 1 and arr.size == 768:
            arr = arr.reshape(1, 768)
        return arr.astype(np.float32)

    @staticmethod
    def _hash_user(dataset_key: str, raw_user_id: Any) -> str:
        return hashlib.md5(f"{dataset_key}_{raw_user_id}".encode()).hexdigest()[:12]

    @staticmethod
    def _remove_bom(content: str) -> str:
        if content.startswith("\ufeff"):
            return content[1:]
        return content

    @classmethod
    def _normalize_fieldname(cls, name: Any) -> str:
        return cls._remove_bom(str(name or "")).strip()

    @staticmethod
    def _dataset_csv_relative_path(dataset_key: str) -> str:
        # datasets/ 下主贴与 Emocc 各数据目录 pkl 行序对齐；Weibo 用 weibo_1000（非 weibo_data，后者对齐 FeaLearner）
        mapping = {
            "reddit": "reddit/reddit_500.csv",
            "bigdata": "bigdata/bigdata.csv",
            "sigir": "sigir/sigir.csv",
            "weibo": "weibo/weibo_1000.csv",
        }
        if dataset_key not in mapping:
            raise KeyError(f"不支持的数据集: {dataset_key}")
        return mapping[dataset_key]

    @classmethod
    def _dataset_csv_path(cls, dataset_key: str) -> Path:
        return Path(__file__).resolve().parents[3] / "datasets" / cls._dataset_csv_relative_path(dataset_key)

    @classmethod
    def _read_dataset_csv_rows(cls, dataset_key: str) -> List[Dict[str, str]]:
        csv_path = cls._dataset_csv_path(dataset_key)
        if not csv_path.exists():
            raise FileNotFoundError(f"源数据 CSV 不存在: {csv_path}")
        with open(csv_path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
            reader = csv.DictReader(f)
            rows = []
            for row in reader:
                rows.append({cls._normalize_fieldname(k): v for k, v in row.items()})
        return rows

    @staticmethod
    def _get_source_row_user_id(dataset_key: str, row: Dict[str, str], row_index: int) -> str:
        if dataset_key == "reddit":
            return str(row.get("User", "")).strip()
        if dataset_key in {"bigdata", "weibo"}:
            return str(row.get("user_id", "")).strip()
        if dataset_key == "sigir":
            return f"row_{row_index}"
        raise KeyError(f"不支持的数据集: {dataset_key}")

    @classmethod
    def _parse_source_posts(cls, dataset_key: str, row: Dict[str, str]) -> List[str]:
        post_column = "post_sequence" if dataset_key == "bigdata" else "Post"
        post_str = str(row.get(post_column, "") or "").strip()
        if not post_str:
            return []

        if post_str.startswith("[") and post_str.endswith("]"):
            try:
                parsed = ast.literal_eval(post_str.replace('\\"', '"'))
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            except Exception:
                pass
            items = re.findall(r'["\']([^"\']+)["\']', post_str)
            if items:
                return [item.strip() for item in items if item.strip()]

        if "\n" in post_str:
            parts = [part.strip() for part in post_str.split("\n") if part.strip()]
            if len(parts) > 1:
                return parts

        return [post_str]

    @classmethod
    def _normalize_alignment_text(cls, text: Any) -> str:
        normalized = cls._normalize_post_text(text)
        lowered = normalized.lower()
        if lowered in {"nan", "null", "none"}:
            return ""
        return normalized

    @staticmethod
    def _normalize_post_text(text: Any) -> str:
        normalized = str(text or "")
        try:
            normalized = normalized.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        replacements = {
            "\u2019": "'",
            "\u2018": "'",
            "\u201c": '"',
            "\u201d": '"',
            "\u2026": "...",
            "\xa0": " ",
            "â€™": "'",
            "â€ś": '"',
            "â€?": '"',
        }
        for source, target in replacements.items():
            normalized = normalized.replace(source, target)
        return " ".join(normalized.split()).strip()

    def _load_precomputed_embedding_index(self, dataset_key: str) -> Dict[str, Any]:
        if dataset_key in self._embedding_indices:
            return self._embedding_indices[dataset_key]

        spec = get_emocc_dataset_spec(dataset_key)
        embedding_path = spec.embedding_pickle_path()
        if embedding_path is None:
            raise FileNotFoundError(f"{dataset_key} 未配置预编码嵌入文件")
        if not embedding_path.exists():
            raise FileNotFoundError(f"预编码嵌入文件不存在: {embedding_path}")

        with open(embedding_path, "rb") as f:
            raw = pickle.load(f)

        source_rows = self._read_dataset_csv_rows(dataset_key)
        sample_map: Dict[str, PrecomputedSample] = {}

        def register_sample(row_index: int, raw_user_id: str, embeddings: Any, sample_posts: List[str], mapping_mode: str):
            user_hash = self._hash_user(dataset_key, raw_user_id)
            sample_map[user_hash] = PrecomputedSample(
                dataset_key=dataset_key,
                row_index=row_index,
                raw_user_id=raw_user_id,
                user_hash=user_hash,
                embeddings=np.asarray(embeddings, dtype=np.float32),
                sample_posts=sample_posts,
                mapping_mode=mapping_mode,
            )

        if dataset_key == "reddit":
            if len(raw) != len(source_rows):
                raise ValueError(f"reddit 源 CSV 与 pkl 条数不一致: {len(source_rows)} vs {len(raw)}")
            for idx, (source_row, item) in enumerate(zip(source_rows, raw), start=1):
                raw_user_id = self._get_source_row_user_id(dataset_key, source_row, idx)
                register_sample(idx, raw_user_id, item.get("embeddings", []), self._parse_source_posts(dataset_key, source_row), "csv_row_index")

        elif dataset_key == "weibo":
            if len(raw) != len(source_rows):
                raise ValueError(f"weibo 源 CSV 与 pkl 条数不一致: {len(source_rows)} vs {len(raw)}")
            for idx, (source_row, item) in enumerate(zip(source_rows, raw), start=1):
                raw_user_id = self._get_source_row_user_id(dataset_key, source_row, idx)
                register_sample(idx, raw_user_id, item.get("embeddings", []), self._parse_source_posts(dataset_key, source_row), "csv_row_index")

        elif dataset_key in {"bigdata", "sigir"}:
            dataframe: pd.DataFrame = raw["dataframe"]
            bert_embeddings = raw["bert_embeddings"]
            if len(dataframe) != len(source_rows):
                raise ValueError(f"{dataset_key} 源 CSV 与 pkl dataframe 条数不一致: {len(source_rows)} vs {len(dataframe)}")
            for idx, source_row in enumerate(source_rows, start=1):
                raw_user_id = self._get_source_row_user_id(dataset_key, source_row, idx)
                register_sample(idx, raw_user_id, bert_embeddings[idx - 1], self._parse_source_posts(dataset_key, source_row), "csv_row_index")

        else:
            raise KeyError(f"未支持的数据集: {dataset_key}")

        index: Dict[str, Any] = {"sample_map": sample_map}

        self._embedding_indices[dataset_key] = index
        return index

    def get_precomputed_sample(
        self,
        *,
        user_hash: str,
        dataset_key: str,
    ) -> PrecomputedSample:
        index = self._load_precomputed_embedding_index(dataset_key)
        sample_map = index.get("sample_map") or {}
        sample = sample_map.get(user_hash)
        if sample is None:
            raise KeyError(f"未在 {dataset_key} 预编码样本中找到用户 {user_hash}")
        return sample

    def _build_mapping_info(
        self,
        *,
        dataset_key: str,
        user_hash: str,
        sample: Optional[PrecomputedSample],
        db_posts: List[str],
        sample_posts: List[str],
        embedding_post_count: int,
    ) -> Dict[str, Any]:
        normalized_db_posts = [self._normalize_alignment_text(post) for post in db_posts]
        normalized_sample_posts = [self._normalize_alignment_text(post) for post in sample_posts]
        compare_count = min(len(normalized_db_posts), len(normalized_sample_posts))
        matched_count = 0
        for idx in range(compare_count):
            if normalized_db_posts[idx] == normalized_sample_posts[idx]:
                matched_count += 1

        is_exact_aligned = (
            len(normalized_db_posts) == len(normalized_sample_posts)
            and matched_count == compare_count
        )
        preview_source = "database" if is_exact_aligned else "sample_csv"
        alignment_status = "exact" if is_exact_aligned else ("partial" if matched_count > 0 else "mismatch")

        return {
            "datasetKey": dataset_key,
            "userHash": user_hash,
            "mappingMode": sample.mapping_mode if sample else "unknown",
            "sourceRowIndex": sample.row_index if sample else None,
            "rawUserId": sample.raw_user_id if sample else None,
            "dbPostCount": len(db_posts),
            "samplePostCount": len(sample_posts),
            "embeddingPostCount": embedding_post_count,
            "matchedPostCount": matched_count,
            "isExactAligned": is_exact_aligned,
            "alignmentStatus": alignment_status,
            "attentionPreviewSource": preview_source,
        }

    def load_model(
        self,
        dataset_key: str = "reddit",
        model_path: Optional[str] = None,
        use_pretrained_emoji: bool = True,
        force_reload: bool = False,
    ) -> bool:
        spec = get_emocc_dataset_spec(dataset_key)
        if not force_reload and dataset_key in self._runtimes:
            return True

        try:
            model_module, emoji_utils_module = self._load_dataset_modules(dataset_key)
            adaptive_gate_cls = getattr(model_module, "AdaptiveGateFusion")
            mlp_cls = getattr(model_module, "MultiLayerPerceptron")
            get_emoji_vocabulary = getattr(emoji_utils_module, "get_emoji_vocabulary")
            load_pretrained_emoji_weights = getattr(emoji_utils_module, "load_pretrained_emoji_weights", None)

            model_file = Path(model_path) if model_path else spec.checkpoint_path()
            if not model_file.exists():
                raise FileNotFoundError(f"模型文件未找到: {model_file}")

            emoji_csv = spec.emoji_csv_path()
            if not emoji_csv.exists():
                raise FileNotFoundError(f"Emoji CSV 未找到: {emoji_csv}")

            emoji_vocab, emoji_to_id = get_emoji_vocabulary(str(emoji_csv))
            emoji_weights = None
            emoji2vec_path = spec.emoji2vec_path()
            if (
                use_pretrained_emoji
                and emoji2vec_path.exists()
                and load_pretrained_emoji_weights is not None
            ):
                emoji_weights_np = load_pretrained_emoji_weights(
                    emoji_vocab,
                    str(emoji2vec_path),
                    embedding_dim=300,
                )
                emoji_weights = torch.FloatTensor(emoji_weights_np)

            args = ModelArgs(dropout=0.5, gru_size=128, class_num=spec.class_num)
            model = BertEmojiModelWithAttention(
                args=args,
                emoji_vocab_size=len(emoji_vocab),
                device=self.device,
                adaptive_gate_cls=adaptive_gate_cls,
                mlp_cls=mlp_cls,
                emoji_weights=emoji_weights,
                is_pretrain_emoji=use_pretrained_emoji and emoji_weights is not None,
            )

            checkpoint = torch.load(model_file, map_location=self.device)
            state_dict = checkpoint["model_state_dict"] if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint else checkpoint
            model.load_state_dict(state_dict, strict=False)
            model.to(self.device)
            model.eval()

            runtime = LoadedDatasetRuntime(
                spec=spec,
                model=model,
                emoji_to_id=emoji_to_id,
                model_config={
                    "model_path": str(model_file),
                    "vocab_size": len(emoji_vocab),
                    "emoji_csv": str(emoji_csv),
                    "emoji2vec_path": str(emoji2vec_path) if emoji2vec_path.exists() else None,
                    "use_pretrained_emoji": use_pretrained_emoji and emoji_weights is not None,
                },
            )
            self._runtimes[dataset_key] = runtime
            return True
        except Exception as exc:
            print(f"[EmoccService] 加载 {spec.model_name} 失败: {exc}")
            import traceback

            traceback.print_exc()
            return False

    def predict_single_user(
        self,
        user_hash: str,
        dataset_key: str,
        bert_embeddings: Optional[Any],
        emoji_sequences: List[List[str]],
        post_texts: Optional[List[str]] = None,
    ) -> EmoccInferenceResult:
        spec = get_emocc_dataset_spec(dataset_key)
        if dataset_key not in self._runtimes:
            raise RuntimeError(f"{spec.model_name} 尚未加载")

        runtime = self._runtimes[dataset_key]
        post_texts = post_texts or []

        try:
            sample: Optional[PrecomputedSample] = None
            if bert_embeddings is None:
                sample = self.get_precomputed_sample(user_hash=user_hash, dataset_key=dataset_key)
                bert_embeddings = sample.embeddings
            else:
                try:
                    sample = self.get_precomputed_sample(user_hash=user_hash, dataset_key=dataset_key)
                except Exception:
                    sample = None

            bert_embeddings = self._normalize_embeddings(bert_embeddings)
            if bert_embeddings.ndim != 2:
                raise ValueError(f"预编码嵌入维度异常: {bert_embeddings.shape}")

            valid_row_mask = np.any(np.abs(bert_embeddings) > 1e-8, axis=1)
            if valid_row_mask.any():
                bert_embeddings = bert_embeddings[valid_row_mask]

            T = int(bert_embeddings.shape[0])
            bert_dim = int(bert_embeddings.shape[1]) if bert_embeddings.ndim == 2 and bert_embeddings.shape[1] else 768
            sample_posts = (sample.sample_posts if sample else [])[:T]
            mapping_info = self._build_mapping_info(
                dataset_key=dataset_key,
                user_hash=user_hash,
                sample=sample,
                db_posts=post_texts,
                sample_posts=sample_posts,
                embedding_post_count=T,
            )
            preview_posts = post_texts if mapping_info["isExactAligned"] else sample_posts
            max_posts = min(spec.max_posts, T, len(preview_posts) if preview_posts else T) if T > 0 else 0

            bert_embeds = torch.zeros((1, spec.max_posts, bert_dim), dtype=torch.float32)
            post_mask = torch.zeros((1, spec.max_posts), dtype=torch.float32)
            for idx in range(max_posts):
                bert_embeds[0, idx] = torch.tensor(bert_embeddings[idx], dtype=torch.float32)
                post_mask[0, idx] = 1.0

            emoji_ids = torch.zeros((1, spec.max_posts, spec.max_emojis_per_post), dtype=torch.int64)
            emoji_mask = torch.zeros((1, spec.max_posts, spec.max_emojis_per_post), dtype=torch.float32)
            for post_idx in range(max_posts):
                post_emojis = emoji_sequences[post_idx] if post_idx < len(emoji_sequences) else []
                for emoji_idx, emoji in enumerate(post_emojis[: spec.max_emojis_per_post]):
                    emoji_id = runtime.emoji_to_id.get(emoji, runtime.emoji_to_id.get("<UNK>", 1))
                    emoji_ids[0, post_idx, emoji_idx] = emoji_id
                    emoji_mask[0, post_idx, emoji_idx] = 1.0

            bert_embeds = bert_embeds.to(self.device)
            emoji_ids = emoji_ids.to(self.device)
            post_mask = post_mask.to(self.device)
            emoji_mask = emoji_mask.to(self.device)

            with torch.no_grad():
                logits, attention_scores = runtime.model(
                    bert_embeds,
                    emoji_ids,
                    post_mask,
                    emoji_mask,
                    return_attention=True,
                )

            probs = F.softmax(logits, dim=-1)
            pred_class = int(torch.argmax(probs, dim=-1).item())
            confidence = float(probs[0, pred_class].item())
            risk_level = spec.coarse_risk_mapping.get(pred_class, "medium")
            risk_score = float(spec.risk_score_mapping.get(pred_class, confidence))

            attn_np = attention_scores[0].cpu().numpy()
            post_attention_scores: List[Dict[str, Any]] = []
            for idx in range(max_posts):
                preview = preview_posts[idx] if idx < len(preview_posts) else f"样本帖子 {idx + 1}"
                if len(preview) > 120:
                    preview = preview[:120] + "..."
                post_attention_scores.append(
                    {
                        "post_index": idx,
                        "attention_score": float(attn_np[idx]),
                        "text_preview": preview,
                        "emoji_count": len(emoji_sequences[idx]) if idx < len(emoji_sequences) else 0,
                        "preview_source": mapping_info["attentionPreviewSource"],
                        "is_exact_aligned": mapping_info["isExactAligned"],
                    }
                )
            post_attention_scores.sort(key=lambda item: item["attention_score"], reverse=True)

            return EmoccInferenceResult(
                user_hash=user_hash,
                dataset_key=dataset_key,
                model_name=spec.model_name,
                risk_level=risk_level,
                risk_score=risk_score,
                risk_class=pred_class,
                confidence=confidence,
                post_attention_scores=post_attention_scores,
                model_info={
                    "model_type": "emocc_local",
                    "dataset_key": dataset_key,
                    "display_name": spec.display_name,
                    "class_num": spec.class_num,
                    "class_labels": spec.class_labels,
                    "coarse_risk_mapping": spec.coarse_risk_mapping,
                    "class_probs": probs[0].cpu().tolist(),
                    "performance_metrics": spec.performance_metrics,
                    "total_posts": len(post_texts),
                    "sample_post_count": len(sample_posts),
                    "analyzed_posts": max_posts,
                    "encoder_model_name": spec.encoder_model_name,
                    "mapping_info": mapping_info,
                },
                mapping_info=mapping_info,
            )
        except Exception as exc:
            print(f"[EmoccService] {spec.model_name} 推理失败: {exc}")
            import traceback

            traceback.print_exc()
            return EmoccInferenceResult(
                user_hash=user_hash,
                dataset_key=dataset_key,
                model_name=spec.model_name,
                risk_level="unknown",
                risk_score=0.0,
                risk_class=-1,
                confidence=0.0,
                post_attention_scores=[],
                model_info={"error": str(exc), "dataset_key": dataset_key},
                mapping_info={"datasetKey": dataset_key, "userHash": user_hash, "mappingMode": "error"},
            )

    def describe_model(self, dataset_key: str) -> Dict[str, Any]:
        spec = get_emocc_dataset_spec(dataset_key)
        return {
            "dataset_key": spec.dataset_key,
            "display_name": spec.display_name,
            "model_name": spec.model_name,
            "model_type": "emocc_local",
            "description": spec.description,
            "architecture": {
                "text_encoder": f"{spec.encoder_model_name} → BiGRU",
                "emoji_encoder": "Emoji2Vec embeddings (300dim)",
                "fusion": "Adaptive Gate Fusion + Global Self-Attention",
                "output": f"{spec.class_num} 分类任务",
            },
            "features": spec.features,
            "performance": spec.performance_metrics,
            "supported_datasets": [spec.dataset_key],
            "class_labels": spec.class_labels,
            "coarse_risk_mapping": spec.coarse_risk_mapping,
            "input_format": {
                "post_texts": "List[str]",
                "emoji_sequences": "List[List[str]]",
                "bert_embeddings": "(T, 768) numpy array；默认从预编码 pkl 样本读取",
            },
            "output_format": {
                "risk_level": "high|medium|low",
                "risk_score": "0.0-1.0",
                "risk_class": f"0-{spec.class_num - 1}",
                "post_attention_scores": "List[{post_index, attention_score, text_preview, preview_source}]",
            },
        }

    def list_model_descriptions(self) -> List[Dict[str, Any]]:
        return [self.describe_model(spec.dataset_key) for spec in list_emocc_dataset_specs()]


_emocc_service: Optional[EmoccInferenceService] = None


def get_emocc_service() -> EmoccInferenceService:
    global _emocc_service
    if _emocc_service is None:
        _emocc_service = EmoccInferenceService()
    return _emocc_service


def load_emocc_model(
    dataset_key: str = "reddit",
    model_path: Optional[str] = None,
    use_pretrained_emoji: bool = True,
    force_reload: bool = False,
) -> bool:
    service = get_emocc_service()
    return service.load_model(
        dataset_key=dataset_key,
        model_path=model_path,
        use_pretrained_emoji=use_pretrained_emoji,
        force_reload=force_reload,
    )
