"""
使用各数据集训练脚本中保存的最佳权重，对「完整」嵌入数据 + 特征表做批量预测。

推荐部署根目录为 **Fealeaner/**（与本脚本同级），目录结构示例：
  Fealeaner/
    predict_with_bestmodel.py
    FeaLearner/weibo|reddit|bigdata|sigir/auto_select/   汇总后的模型代码（预测时优先加载）
    data/          嵌入 pkl
    feature_data/  特征 csv
    bestmodel/     权重 pth

若 FeaLearner 放在仓库根（与 Fealeaner 文件夹并列），本脚本在 Fealeaner 内运行时也会自动到上一级查找。

数据目录约定（默认相对**本脚本所在目录**，即 Fealeaner）：
- data/          放各数据集的 BERT 嵌入 pkl（文件名可区分来源）
- feature_data/  放各数据集的特征 CSV（列数与训练时一致；脚本会将标签列拼到特征后构造 Dataset）
- bestmodel/     放各数据集训练得到的最佳权重 .pth

后端 FeaLearner 服务（fealearner_service）会优先从仓库根 **Emocc/<数据集>/data/** 加载
reddit / sigir / bigdata 的嵌入 pkl（与 Emocc 部署一致）；weibo 仍用 **Fealeaner/data/user_post_embeddings_bert_wwm.pkl**。

仓库 **datasets/weibo/** 与上述 pkl 的对应关系（行序须一致，勿与 Emocc 子集混用）：
  - weibo_1000.csv          → 对齐 Emocc-Weibo（Emocc/weibo/data 下 pkl）
  - weibo_data.csv          → 对齐 FeaLearner-Weibo（本目录 data/user_post_embeddings_bert_wwm.pkl）

默认文件名对照：
  weibo   data/user_post_embeddings_bert_wwm.pkl    feature_data/feature_weibo_2.csv    bestmodel/weibo_best_model.pth
  reddit  data/reddit_bert_embeddings.pkl            feature_data/feature_reddit_500.csv   bestmodel/my_reddit_model.pth
  bigdata data/bigdata_bert_embeddings.pkl          feature_data/feature_bigdata.csv      bestmodel/my_bigdata_model.pth
  sigir   data/sigir_bert_embeddings.pkl            feature_data/feature_sigir.csv       bestmodel/my_sigir_model.pth

单用户 / 单条样本（须指定单个 --dataset，不能与 all 同用）：
  python predict_with_bestmodel.py --dataset weibo --sample_index 0
  python predict_with_bestmodel.py --dataset weibo --person_id 1234567890
  （person_id 会在 pkl 条目的 user_id / user 等字段或特征表 user_id 等列中查找）

离线部署：在仓库根目录执行
  python package_prediction_bundle.py
会生成 prediction_bundle/（含本脚本与各子项目 auto_select 代码拷贝）。
将 data/、feature_data/、bestmodel/ 一并放入该目录后，在 prediction_bundle 内运行本脚本即可。

用法示例：
  python predict_with_bestmodel.py --dataset weibo
  python predict_with_bestmodel.py --dataset all
  python predict_with_bestmodel.py --dataset reddit ^
    --data_embeddings D:/path/custom.pkl ^
    --data_features D:/path/custom.csv ^
    --checkpoint D:/path/my_reddit_model.pth
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pickle
import random
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader
from tqdm import tqdm


_ROOT = Path(__file__).resolve().parent


def _resolve_auto_select_dir(dataset: str) -> Path:
    """
    优先使用仓库根目录下汇总的 FeaLearner/<dataset>/auto_select/，
    否则回退到传统路径 <dataset>/auto_select/（脚本目录或上一级目录）。
    """
    script_dir = Path(__file__).resolve().parent
    candidates = [
        script_dir / "FeaLearner" / dataset / "auto_select",
        script_dir.parent / "FeaLearner" / dataset / "auto_select",
        script_dir / dataset / "auto_select",
        script_dir.parent / dataset / "auto_select",
    ]
    main_py = f"{dataset}.py"
    for sub in candidates:
        if (sub / main_py).is_file():
            return sub
    tried = "\n  ".join(str(c / main_py) for c in candidates)
    raise FileNotFoundError(f"未找到训练脚本 {main_py}，已尝试：\n  {tried}")


def _set_seed(seed: int) -> None:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
    np.random.seed(seed)
    random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


def _load_train_module(dataset: str):
    """加载 auto_select/<dataset>.py（需能 import tools / twomoe）；优先 FeaLearner 汇总目录。"""
    sub = _resolve_auto_select_dir(dataset)
    path = sub / f"{dataset}.py"
    pkg = str(sub)
    if pkg not in sys.path:
        sys.path.insert(0, pkg)
    spec = importlib.util.spec_from_file_location(f"{dataset}_train", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _read_embeddings_pkl(path: Path) -> List[Dict[str, Any]]:
    with open(path, "rb") as f:
        raw = pickle.load(f)

    if isinstance(raw, list):
        return raw

    if isinstance(raw, dict) and "dataframe" in raw and "bert_embeddings" in raw:
        df = raw["dataframe"]
        bert_embeddings = raw["bert_embeddings"]
        if len(df) != len(bert_embeddings):
            raise ValueError(
                f"pkl 中 dataframe 行数 {len(df)} 与 bert_embeddings 数量 {len(bert_embeddings)} 不一致: {path}"
            )

        label_col = None
        for candidate in ("label", "Label", "suicide_risk"):
            if candidate in df.columns:
                label_col = candidate
                break
        if label_col is None:
            raise KeyError(f"无法在 pkl dataframe 中找到标签列(label/Label/suicide_risk): {path}")

        id_col = None
        for candidate in ("user_id", "user", "author_id", "author", "id"):
            if candidate in df.columns:
                id_col = candidate
                break

        normalized: List[Dict[str, Any]] = []
        for idx, emb in enumerate(bert_embeddings):
            row = df.iloc[idx]
            record: Dict[str, Any] = {
                "label": int(row[label_col]),
                "embeddings": emb,
            }
            if id_col is not None:
                record[id_col] = str(row[id_col]).strip()
            else:
                record["id"] = f"row_{idx + 1}"
            normalized.append(record)
        return normalized

    raise TypeError(f"不支持的 embeddings pkl 结构: {type(raw).__name__} @ {path}")


def _default_paths(dataset: str) -> Tuple[Path, Path, Path]:
    """返回 (embeddings, features, checkpoint)。data/、feature_data/、bestmodel/ 均在仓库根目录下。"""
    _d = _ROOT / "data"
    _f = _ROOT / "feature_data"
    _b = _ROOT / "bestmodel"
    if dataset == "weibo":
        return (
            _d / "user_post_embeddings_bert_wwm.pkl",
            _f / "feature_weibo_2.csv",
            _b / "my_weibo_model.pth",
        )
    if dataset == "reddit":
        return (
            _d / "reddit_bert_embeddings.pkl",
            _f / "feature_reddit_500.csv",
            _b / "my_reddit_model.pth",
        )
    if dataset == "bigdata":
        return (
            _d / "bigdata_bert_embeddings.pkl",
            _f / "feature_bigdata.csv",
            _b / "my_bigdata_model.pth",
        )
    if dataset == "sigir":
        return (
            _d / "sigir_bert_embeddings.pkl",
            _f / "feature_sigir.csv",
            _b / "my_sigir_model.pth",
        )
    raise ValueError(f"未知数据集: {dataset}")


def _model_config(dataset: str) -> Dict[str, Any]:
    """与各 train 脚本 parse_args / 模型构造保持一致。"""
    if dataset == "weibo":
        return {
            "features_dic": {"pos": 57, "tfidf": 50, "nrc": 10, "sui": 13},
            "classnum": 2,
            "max_len": 100,
            "hidden_size": 128,
            "cv_d_model": 128,
            "cv_heads": 2,
            "batch_size": 8,
            "embed_size": 768,
            "use_cv": True,
        }
    if dataset == "reddit":
        return {
            "features_dic": {"pos": 36, "tidif": 50, "nrc": 10, "sui": 4},
            "classnum": 5,
            "max_len": 200,
            "hidden_size": 128,
            "cv_d_model": 128,
            "cv_heads": 4,
            "batch_size": 16,
            "embed_size": 768,
            "use_cv": True,
        }
    if dataset == "bigdata":
        return {
            "features_dic": {"pos": 36, "tidif": 50, "nrc": 10, "sui": 4},
            "classnum": 4,
            "max_len": 5,
            "hidden_size": 256,
            "batch_size": 4,
            "embed_size": 768,
            "use_cv": False,
        }
    if dataset == "sigir":
        return {
            "features_dic": {"pos": 36, "tidif": 50, "nrc": 10, "sui": 4},
            "classnum": 2,
            "max_len": 300,
            "hidden_size": 128,
            "cv_d_model": 128,
            "cv_heads": 8,
            "batch_size": 32,
            "embed_size": 768,
            "use_cv": True,
        }
    raise ValueError(f"未知数据集: {dataset}")


# pkl 中常见「人」标识字段（按顺序尝试）
_EMBEDDING_ID_KEYS: Tuple[str, ...] = (
    "user_id",
    "user",
    "author",
    "author_id",
    "reddit_id",
    "name",
    "id",
)

# 特征表里可能存在的 ID 列（仅用于 --person_id 在 pkl 无 id 时的补充查找）
_FEATURE_ID_COLUMNS: Tuple[str, ...] = (
    "user_id",
    "user",
    "author_id",
    "author",
    "reddit_id",
    "id",
)


def _embedding_record_id(rec: Dict[str, Any]) -> Optional[str]:
    for k in _EMBEDDING_ID_KEYS:
        if k in rec and rec[k] is not None and str(rec[k]).strip() != "":
            return str(rec[k]).strip()
    return None


def _resolve_sample_index(
    bert_embeddings: List[Dict[str, Any]],
    features_only: pd.DataFrame,
    sample_index: Optional[int],
    person_id: Optional[str],
) -> Tuple[int, Optional[str]]:
    """返回 (行索引, 展示用 id 字符串)。"""
    n = len(bert_embeddings)
    if sample_index is not None and person_id is not None:
        raise ValueError("请只指定 --sample_index 或 --person_id 其中之一。")
    if sample_index is None and person_id is None:
        raise ValueError("内部错误：单样本模式需指定 sample_index 或 person_id。")

    if sample_index is not None:
        if sample_index < 0 or sample_index >= n:
            raise ValueError(f"sample_index 必须在 [0, {n - 1}] 内，当前为 {sample_index}。")
        rid = _embedding_record_id(bert_embeddings[sample_index])
        return sample_index, rid

    target = str(person_id).strip()
    for i, rec in enumerate(bert_embeddings):
        rid = _embedding_record_id(rec)
        if rid is None:
            continue
        if rid == target:
            return i, rid
        try:
            if float(rid) == float(target):
                return i, rid
        except (ValueError, TypeError):
            pass

    for col in _FEATURE_ID_COLUMNS:
        if col not in features_only.columns:
            continue
        colvals = features_only[col].astype(str).str.strip()
        hits = np.where(colvals.values == target)[0]
        if len(hits) == 1:
            i = int(hits[0])
            rid = _embedding_record_id(bert_embeddings[i]) or target
            return i, rid
        if len(hits) > 1:
            raise ValueError(f"特征表列 {col!r} 中 person_id={target!r} 匹配到 {len(hits)} 行，无法唯一定位。")

    raise ValueError(
        f"未找到 person_id={target!r}：pkl 各条无匹配 id 字段，特征表也无 "
        f"{list(_FEATURE_ID_COLUMNS)} 中任一列的匹配。可改用 --sample_index。"
    )


def _load_aligned(
    dataset: str,
    emb_path: Path,
    feat_path: Path,
    seed: int,
) -> Tuple[Any, Dict[str, Any], pd.DataFrame, List[Any], int, List[Dict[str, Any]], pd.DataFrame]:
    """
    返回 mod, cfg, features_labels（特征+labels 列）, posts, features_dim,
    原始 bert_embeddings 列表, 仅特征的 DataFrame（与 pkl 行对齐）。
    """
    _set_seed(seed)
    mod = _load_train_module(dataset)
    cfg = _model_config(dataset)

    bert_embeddings = _read_embeddings_pkl(emb_path)
    labels_list: List[Any] = []
    posts: List[Any] = []
    for i in range(len(bert_embeddings)):
        labels_list.append(bert_embeddings[i]["label"])
        posts.append(bert_embeddings[i]["embeddings"])

    features = pd.read_csv(feat_path)
    features_dim = features.shape[1]
    labels_df = pd.DataFrame(labels_list, columns=["labels"])
    if len(features) != len(labels_df):
        raise ValueError(
            f"特征行数 {len(features)} 与嵌入样本数 {len(labels_df)} 不一致，请检查 data 与 feature_data 是否配对。"
        )
    features_labels = pd.concat([features, labels_df], axis=1)
    return mod, cfg, features_labels, posts, features_dim, bert_embeddings, features


def _build_model(mod: Any, dataset: str, features_dim: int, cfg: Dict[str, Any]) -> torch.nn.Module:
    fd = cfg["features_dic"]
    if cfg["use_cv"]:
        return mod.MyLSTMATT(
            features_dic=fd,
            class_num=cfg["classnum"],
            engine_dim=features_dim,
            embedding_dim=cfg["embed_size"],
            hidden_dim=cfg["hidden_size"],
            lstm_layer=2,
            max_len=cfg["max_len"],
            cv_d_model=cfg["cv_d_model"],
            cv_heads=cfg["cv_heads"],
        )
    return mod.MyLSTMATT(
        features_dic=fd,
        class_num=cfg["classnum"],
        engine_dim=features_dim,
        embedding_dim=cfg["embed_size"],
        hidden_dim=cfg["hidden_size"],
        lstm_layer=2,
    )


def _build_model_from_state(
    dataset: str,
    mod: Any,
    cfg: Dict[str, Any],
    features_dim: int,
    state: Dict[str, Any],
) -> tuple[torch.nn.Module, Dict[str, Any], str]:
    """
    基于 checkpoint 键名/形状构建可匹配的模型。
    主要处理 weibo 历史权重（旧版 BiLSTM+Attention）与新版结构的兼容。
    """
    # 默认：按当前数据集配置建模
    model = _build_model(mod, dataset, features_dim, cfg)
    build_info = "default"

    if dataset not in ("weibo", "bigdata"):
        return model, cfg, build_info

    # 老版 Weibo 权重特征：包含 attention.w_omega / u_omega
    has_legacy_attn = any(k.startswith("historic_model.attention.") for k in state.keys())
    has_cv_branch = any(k.startswith("historic_model.cross_variable_attention.") for k in state.keys())

    # bigdata 若权重是新版（含 CV 分支），切到新版架构构建
    if dataset == "bigdata" and has_cv_branch:
        cv_mod = _load_train_module("reddit")
        inferred_embed = cfg["embed_size"]
        inferred_hidden = cfg["hidden_size"]
        inferred_max_len = cfg["max_len"]
        inferred_cv_d_model = 128

        lstm_ih = state.get("historic_model.lstm.weight_ih_l0")
        if isinstance(lstm_ih, torch.Tensor) and lstm_ih.ndim == 2:
            inferred_embed = int(lstm_ih.shape[1])

        lstm_hh = state.get("historic_model.lstm.weight_hh_l0")
        if isinstance(lstm_hh, torch.Tensor) and lstm_hh.ndim == 2:
            inferred_hidden = int(lstm_hh.shape[0] // 4)

        wqv = state.get("historic_model.cross_variable_attention.WQv.weight")
        if isinstance(wqv, torch.Tensor) and wqv.ndim == 2:
            inferred_max_len = int(wqv.shape[1])

        wov = state.get("historic_model.cross_variable_attention.WOv.weight")
        if isinstance(wov, torch.Tensor) and wov.ndim == 2:
            inferred_cv_d_model = int(wov.shape[0])

        cv_cfg = dict(cfg)
        cv_cfg["embed_size"] = inferred_embed
        cv_cfg["hidden_size"] = inferred_hidden
        cv_cfg["max_len"] = inferred_max_len
        cv_cfg["cv_d_model"] = inferred_cv_d_model
        cv_cfg["cv_heads"] = 4 if inferred_cv_d_model % 4 == 0 else 2
        cv_cfg["use_cv"] = True

        model = cv_mod.MyLSTMATT(
            features_dic=cv_cfg["features_dic"],
            class_num=cv_cfg["classnum"],
            engine_dim=features_dim,
            embedding_dim=cv_cfg["embed_size"],
            hidden_dim=cv_cfg["hidden_size"],
            lstm_layer=2,
            max_len=cv_cfg["max_len"],
            cv_d_model=cv_cfg["cv_d_model"],
            cv_heads=cv_cfg["cv_heads"],
        )
        build_info = (
            f"bigdata_cv( embed={inferred_embed}, hidden={inferred_hidden}, "
            f"max_len={inferred_max_len}, cv_d_model={inferred_cv_d_model}, cv_heads={cv_cfg['cv_heads']} )"
        )
        return model, cv_cfg, build_info

    if dataset == "bigdata":
        return model, cfg, build_info

    if not has_legacy_attn:
        return model, cfg, build_info

    # 旧版结构更接近 bigdata 的 MyLSTMATT
    legacy_mod = _load_train_module("bigdata")
    inferred_embed = cfg["embed_size"]
    inferred_hidden = cfg["hidden_size"]

    lstm_ih = state.get("historic_model.lstm.weight_ih_l0")
    if isinstance(lstm_ih, torch.Tensor) and lstm_ih.ndim == 2:
        inferred_embed = int(lstm_ih.shape[1])

    lstm_hh = state.get("historic_model.lstm.weight_hh_l0")
    if isinstance(lstm_hh, torch.Tensor) and lstm_hh.ndim == 2:
        inferred_hidden = int(lstm_hh.shape[0] // 4)

    legacy_cfg = dict(cfg)
    legacy_cfg["embed_size"] = inferred_embed
    legacy_cfg["hidden_size"] = inferred_hidden
    legacy_cfg["use_cv"] = False

    model = legacy_mod.MyLSTMATT(
        features_dic=legacy_cfg["features_dic"],
        class_num=legacy_cfg["classnum"],
        engine_dim=features_dim,
        embedding_dim=legacy_cfg["embed_size"],
        hidden_dim=legacy_cfg["hidden_size"],
        lstm_layer=2,
    )
    build_info = f"legacy_weibo(bigdata-arch, embed={inferred_embed}, hidden={inferred_hidden})"
    return model, legacy_cfg, build_info


def predict_one_person(
    dataset: str,
    emb_path: Path,
    feat_path: Path,
    ckpt_path: Path,
    sample_index: Optional[int],
    person_id: Optional[str],
    output_path: Optional[Path],
    seed: int,
) -> Dict[str, Any]:
    mod, cfg, features_labels, posts, features_dim, bert_embeddings, features_only = _load_aligned(
        dataset, emb_path, feat_path, seed
    )
    idx, rid = _resolve_sample_index(bert_embeddings, features_only, sample_index, person_id)

    sub_labels = features_labels.iloc[[idx]].reset_index(drop=True)
    sub_posts = [posts[idx]]

    if dataset == "weibo":
        DatasetCls = mod.WeiboDataset
        collate_fn: Callable = mod.pad_collate_weibo
        ds = DatasetCls(sub_labels, sub_posts, days=cfg["max_len"])
    else:
        DatasetCls = mod.RedditDataset
        collate_fn = mod.pad_collate_reddit
        ds = DatasetCls(sub_labels, sub_posts, days=cfg["max_len"])

    loader = DataLoader(ds, batch_size=1, shuffle=False, collate_fn=collate_fn)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    state = torch.load(ckpt_path, map_location=device)
    model, cfg_used, build_info = _build_model_from_state(dataset, mod, cfg, features_dim, state)
    model.load_state_dict(state)
    model.to(device)
    model.eval()

    batch = next(iter(loader))
    labels_b, tweets, lengths, features_b = batch
    labels_b = labels_b.to(device)
    tweets = tweets.to(device)
    lengths = lengths.to(device)
    features_b = features_b.to(device)

    with torch.no_grad():
        logits = model(tweets, lengths, labels_b, features_b)
        probs = torch.softmax(logits, dim=1)
        pred = int(torch.argmax(logits, dim=1).item())
        true_label = int(labels_b.item())

    n_cls = cfg_used["classnum"]
    prob_list = probs.cpu().numpy().reshape(-1).tolist()
    result: Dict[str, Any] = {
        "dataset": dataset,
        "sample_index": idx,
        "person_id": rid if rid is not None else None,
        "true_label": true_label,
        "pred_label": pred,
        "probabilities": {f"class_{c}": prob_list[c] for c in range(n_cls)},
    }

    line = json.dumps(result, ensure_ascii=False)
    print(f"[{dataset}] 单样本预测: {line}")
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(line + "\n")
        print(f"已写入: {output_path}")

    return result


def predict_one_dataset(
    dataset: str,
    emb_path: Path,
    feat_path: Path,
    ckpt_path: Path,
    output_csv: Optional[Path],
    batch_size: Optional[int],
    seed: int,
) -> Path:
    mod, cfg, features_labels, posts, features_dim, _, _ = _load_aligned(dataset, emb_path, feat_path, seed)
    bs = batch_size if batch_size is not None else cfg["batch_size"]

    if dataset == "weibo":
        DatasetCls = mod.WeiboDataset
        collate_fn: Callable = mod.pad_collate_weibo
        ds = DatasetCls(features_labels, posts, days=cfg["max_len"])
    else:
        DatasetCls = mod.RedditDataset
        collate_fn = mod.pad_collate_reddit
        ds = DatasetCls(features_labels, posts, days=cfg["max_len"])

    loader = DataLoader(ds, batch_size=bs, shuffle=False, collate_fn=collate_fn)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    state = torch.load(ckpt_path, map_location=device)
    model, cfg_used, build_info = _build_model_from_state(dataset, mod, cfg, features_dim, state)
    print(f"[{dataset}] 模型构建模式: {build_info}")
    model.load_state_dict(state)
    model.to(device)
    model.eval()

    all_preds: List[int] = []
    all_probs: List[np.ndarray] = []
    all_true: List[int] = []

    with torch.no_grad():
        for batch in tqdm(loader, desc=f"预测 {dataset}"):
            labels_b, tweets, lengths, features_b = batch
            labels_b = labels_b.to(device)
            tweets = tweets.to(device)
            lengths = lengths.to(device)
            features_b = features_b.to(device)
            logits = model(tweets, lengths, labels_b, features_b)
            probs = torch.softmax(logits, dim=1)
            preds = torch.argmax(logits, dim=1)
            all_preds.extend(preds.cpu().numpy().tolist())
            all_probs.extend(probs.cpu().numpy())
            all_true.extend(labels_b.cpu().numpy().tolist())

    out = pd.DataFrame(
        {
            "index": np.arange(len(all_preds)),
            "true_label": all_true,
            "pred_label": all_preds,
        }
    )
    # 附加各类别概率列
    n_cls = cfg_used["classnum"]
    prob_mat = np.stack(all_probs, axis=0)
    for c in range(n_cls):
        out[f"prob_class_{c}"] = prob_mat[:, c]

    if output_csv is None:
        output_csv = _ROOT / f"predictions_{dataset}.csv"
    out.to_csv(output_csv, index=False)
    acc = float(np.mean(np.array(all_preds) == np.array(all_true)))
    print(f"[{dataset}] 样本数={len(all_preds)} 准确率={acc:.4f} 结果已写入: {output_csv}")
    return output_csv


def parse_args():
    p = argparse.ArgumentParser(description="使用 best checkpoint 对完整数据集预测")
    p.add_argument(
        "--dataset",
        type=str,
        default="all",
        choices=["all", "weibo", "reddit", "bigdata", "sigir"],
        help="要预测的数据集；all 表示四个都跑",
    )
    p.add_argument("--data_embeddings", type=str, default=None, help="覆盖：BERT 嵌入 pkl")
    p.add_argument("--data_features", type=str, default=None, help="覆盖：特征 CSV")
    p.add_argument("--checkpoint", type=str, default=None, help="覆盖：模型权重 .pth")
    p.add_argument("--output", type=str, default=None, help="全量预测：输出 CSV；单样本：输出一行 JSON 文本文件")
    p.add_argument("--batch_size", type=int, default=None, help="覆盖默认 batch size")
    p.add_argument("--seed", type=int, default=24)
    p.add_argument(
        "--sample_index",
        type=int,
        default=None,
        help="只预测第 i 条样本（与 pkl、特征表行号对齐，从 0 起）；与 --person_id 二选一",
    )
    p.add_argument(
        "--person_id",
        type=str,
        default=None,
        help="按「人」标识筛选一条样本：先在 pkl 的 user_id/user 等字段查找，再在特征表 id 列查找；与 --sample_index 二选一",
    )
    return p.parse_args()


def main():
    args = parse_args()
    single_mode = args.sample_index is not None or args.person_id is not None
    if single_mode and args.sample_index is not None and args.person_id is not None:
        raise SystemExit("请勿同时指定 --sample_index 与 --person_id。")
    if args.person_id is not None and not str(args.person_id).strip():
        raise SystemExit("--person_id 不能为空字符串。")
    if single_mode and args.dataset == "all":
        raise SystemExit("单样本预测请指定具体数据集（不能使用 --dataset all）。")
    if single_mode and args.batch_size is not None:
        raise SystemExit("单样本预测无需 --batch_size。")

    targets: List[str]
    if args.dataset == "all":
        targets = ["weibo", "reddit", "bigdata", "sigir"]
    else:
        targets = [args.dataset]

    if len(targets) > 1 and (args.data_embeddings or args.data_features or args.checkpoint or args.output):
        raise SystemExit("与 --dataset all 联用时请勿使用路径覆盖参数（请逐个数据集单独运行）。")

    for ds in targets:
        d_emb, d_feat, d_ckpt = _default_paths(ds)
        emb = Path(args.data_embeddings) if args.data_embeddings else d_emb
        feat = Path(args.data_features) if args.data_features else d_feat
        ckpt = Path(args.checkpoint) if args.checkpoint else d_ckpt
        out_path = Path(args.output) if args.output else None

        for path, name in [(emb, "data_embeddings"), (feat, "data_features"), (ckpt, "checkpoint")]:
            if not path.is_file():
                print(f"[{ds}] 警告: {name} 不存在: {path}（请放置文件或传参覆盖）")

        if single_mode:
            predict_one_person(
                ds,
                emb,
                feat,
                ckpt,
                args.sample_index,
                args.person_id,
                out_path,
                args.seed,
            )
        else:
            predict_one_dataset(ds, emb, feat, ckpt, out_path, args.batch_size, args.seed)


if __name__ == "__main__":
    main()
