# -*- coding: utf-8 -*-
"""
心理档案数据导入路由

本路由为四个内置数据系列提供统一的模板元信息、模板下载、上传解析与导入能力：
- reddit
- bigdata
- sigir
- weibo
"""
import csv
import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from src.services.dataset_csv_service import calculate_importance_score

router = APIRouter(prefix="/api/upload", tags=["upload-archive"])

_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_PROJECT_ROOT = os.path.dirname(_BACKEND_ROOT)
ARCHIVES_DIR = os.path.join(_BACKEND_ROOT, "uploads", "archives")
DATASET_TEMPLATE_DIR = os.path.join(_PROJECT_ROOT, "datasets", "archives")

ALLOWED_EXTENSIONS = {"csv", "txt", "xlsx"}
MAX_FILE_SIZE = 50 * 1024 * 1024

os.makedirs(ARCHIVES_DIR, exist_ok=True)
os.makedirs(DATASET_TEMPLATE_DIR, exist_ok=True)


@dataclass
class ParsedArchiveRecord:
    user_id: str
    posts: List[str]
    label: int
    raw_row: Dict[str, Any]
    timestamps: List[Optional[str]] = field(default_factory=list)
    emoji_sequences: List[Optional[str]] = field(default_factory=list)


BUILTIN_TEMPLATE_SPECS: Dict[str, Dict[str, Any]] = {
    "reddit": {
        "displayName": "Reddit系列",
        "description": "对应 reddit_500.csv 的主贴文格式。",
        "requiredColumns": [
            {"name": "User", "description": "用户ID"},
            {"name": "Post", "description": "Python list 字符串；列表每个元素视为 1 帖"},
            {"name": "Label", "description": "五分类风险标签 0..4"},
        ],
        "optionalColumns": [
            {"name": "EmojiSequence", "description": "可选；与帖子顺序对齐的 emoji 信息"},
        ],
        "postSplitRule": "读取 Post 列的 Python list 字符串，列表中的每个元素都作为一条独立贴文导入。",
        "riskLabels": {"0": "无风险", "1": "极低风险", "2": "低风险", "3": "中风险", "4": "高风险"},
        "sampleRows": [
            {
                "User": "user-001",
                "Post": "['first reddit post', 'second reddit post']",
                "Label": "2",
                "EmojiSequence": "calm,worried",
            }
        ],
        "templateFiles": {
            "excel": "reddit_导入模板.xlsx",
            "csv": "reddit_导入模板.csv",
            "txt": "reddit_导入模板.txt",
        },
    },
    "bigdata": {
        "displayName": "Bigdata系列",
        "description": "对应 bigdata.csv 的主贴文格式。",
        "requiredColumns": [
            {"name": "user_id", "description": "用户ID"},
            {"name": "created_utc", "description": "与帖子顺序对齐的时间戳列表"},
            {"name": "post_sequence", "description": "Python list 字符串；列表每个元素视为 1 帖"},
            {"name": "suicide_risk", "description": "四分类风险标签 0..3"},
        ],
        "optionalColumns": [
            {"name": "emjio_sequenc", "description": "与原始 bigdata_emoji_batch.csv 保持一致的拼写"},
            {"name": "emjio_sequence", "description": "兼容拼写；与帖子顺序对齐的 emoji 信息"},
        ],
        "postSplitRule": "读取 post_sequence 列的列表字符串，列表中的每个元素都作为一条独立贴文导入；created_utc 按相同位置对齐。",
        "riskLabels": {"0": "无风险", "1": "低风险", "2": "中风险", "3": "高风险"},
        "sampleRows": [
            {
                "user_id": "user_001",
                "created_utc": "[Timestamp('2021-04-26 06:44:18'), Timestamp('2021-05-01 05:57:38')]",
                "post_sequence": '["first bigdata post", "second bigdata post"]',
                "suicide_risk": "2",
                "emjio_sequenc": "sad,panic",
            }
        ],
        "templateFiles": {
            "excel": "bigdata_导入模板.xlsx",
            "csv": "bigdata_导入模板.csv",
            "txt": "bigdata_导入模板.txt",
        },
    },
    "sigir": {
        "displayName": "SIGIR系列",
        "description": "对应 sigir.csv 的主贴文格式。",
        "requiredColumns": [
            {"name": "Post", "description": "单条贴文文本；每行就是 1 个用户、1 条贴文"},
            {"name": "Label", "description": "二分类风险标签 0/1"},
        ],
        "optionalColumns": [
            {"name": "EmojiSequence", "description": "可选；该条贴文的 emoji 信息"},
        ],
        "postSplitRule": "SIGIR 不提供显式用户ID；导入时按“行号 + 贴文内容哈希”生成稳定 user_id。每行只导入 1 帖。",
        "riskLabels": {"0": "无风险", "1": "高风险"},
        "sampleRows": [
            {
                "Post": "what's wrong with me",
                "Label": "1",
                "EmojiSequence": "sad",
            }
        ],
        "templateFiles": {
            "excel": "sigir_导入模板.xlsx",
            "csv": "sigir_导入模板.csv",
            "txt": "sigir_导入模板.txt",
        },
    },
    "weibo": {
        "displayName": "Weibo系列",
        "description": "对应 weibo_1000.csv 的主贴文格式。",
        "requiredColumns": [
            {"name": "user_id", "description": "用户ID"},
            {"name": "Post", "description": "多行文本；按换行拆分，每行视为 1 帖"},
            {"name": "label", "description": "二分类风险标签 0/1"},
        ],
        "optionalColumns": [
            {"name": "emoji_sequence", "description": "按逗号分段，与换行拆出的帖子顺序对齐"},
        ],
        "postSplitRule": "读取 Post 列中的多行文本，按换行拆分，每一行都作为一条独立贴文导入。",
        "riskLabels": {"0": "无风险", "1": "高风险"},
        "sampleRows": [
            {
                "user_id": "n-0002",
                "Post": "第一条微博\\n第二条微博",
                "label": "1",
                "emoji_sequence": "calm,worried",
            }
        ],
        "templateFiles": {
            "excel": "weibo_导入模板.xlsx",
            "csv": "weibo_导入模板.csv",
            "txt": "weibo_导入模板.txt",
        },
    },
}


def _get_mysql_pool(request: Request):
    if not hasattr(request.app.state, "mysql_db") or request.app.state.mysql_db is None:
        raise HTTPException(status_code=503, detail="数据库连接不可用")
    return request.app.state.mysql_db


def get_file_ext(filename: str) -> str:
    return os.path.splitext(filename)[1].lstrip(".").lower()


def sanitize_filename(filename: str) -> str:
    filename = filename.replace("/", "_").replace("\\", "_")
    filename = re.sub(r'[<>:"|?*]', "_", filename)
    if len(filename) > 200:
        name, ext = os.path.splitext(filename)
        filename = name[: 200 - len(ext)] + ext
    return filename


def generate_dataset_key(filename: str) -> str:
    name = os.path.splitext(filename)[0]
    name = "".join(c if c.isalnum() else "_" for c in name)
    ts = hashlib.md5(str(uuid.uuid4()).encode()).hexdigest()[:6]
    return f"custom_{name}_{ts}"


def _normalize_key(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_row_keys(row: Dict[str, Any]) -> Dict[str, str]:
    normalized: Dict[str, str] = {}
    for key, value in row.items():
        normalized[_normalize_key(key)] = "" if value is None else str(value)
    return normalized


def _read_delimited_rows(file_path: str) -> Tuple[List[Dict[str, str]], List[str]]:
    with open(file_path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        delimiter = "\t" if "\t" in sample.splitlines()[0] else ","
        reader = csv.DictReader(f, delimiter=delimiter)
        rows = [dict(row) for row in reader]
        return rows, reader.fieldnames or []


def _read_excel_rows(file_path: str) -> Tuple[List[Dict[str, str]], List[str]]:
    df = pd.read_excel(file_path, dtype=str).fillna("")
    rows = [
        {str(col): "" if value is None else str(value) for col, value in row.items()}
        for row in df.to_dict(orient="records")
    ]
    return rows, [str(col) for col in df.columns.tolist()]


def _load_rows(file_path: str) -> Tuple[List[Dict[str, str]], List[str]]:
    ext = get_file_ext(file_path)
    if ext in {"csv", "txt"}:
        return _read_delimited_rows(file_path)
    if ext == "xlsx":
        return _read_excel_rows(file_path)
    raise ValueError(f"不支持的文件类型: .{ext}")


def _parse_label(value: Any, field_name: str, row_index: int) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        raise ValueError(f"第 {row_index} 行的 {field_name} 不是合法数字标签: {value}")


def _extract_quoted_items(raw_text: str) -> List[str]:
    items = re.findall(r'["\']([^"\']+)["\']', raw_text)
    return [item.strip() for item in items if item and item.strip()]


def _parse_python_list_field(raw_text: str, allow_recover: bool = False) -> List[str]:
    if raw_text is None:
        return []
    text = str(raw_text).strip()
    if not text:
        return []

    if text.startswith("[") and text.endswith("]"):
        try:
            import ast

            cleaned = text.replace('\\"', '"')
            parsed = ast.literal_eval(cleaned)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except Exception:
            if not allow_recover:
                raise

        recovered = _extract_quoted_items(text)
        if recovered:
            return recovered
        if allow_recover:
            inner = text[1:-1].strip()
            if not inner:
                return []
            parts = [part.strip().strip('"').strip("'") for part in inner.split('", "')]
            parts = [part for part in parts if part]
            if parts:
                return parts
        raise ValueError(f"列表字段解析失败: {text[:120]}")

    return [text]


def _parse_newline_posts(raw_text: str) -> List[str]:
    if raw_text is None:
        return []
    text = str(raw_text).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    parts = [part.strip() for part in text.split("\n") if part.strip()]
    return parts if parts else [text]


def _parse_emoji_sequence(raw_text: Any) -> List[str]:
    if raw_text is None:
        return []
    text = str(raw_text).strip()
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            return _parse_python_list_field(text, allow_recover=True)
        except Exception:
            pass
    return [part.strip() for part in text.split(",") if part and part.strip()]


def _parse_timestamp_list(raw_text: Any) -> List[str]:
    if raw_text is None:
        return []
    text = str(raw_text).strip()
    if not text:
        return []

    matches = re.findall(r"Timestamp\('([^']+)'\)", text)
    if matches:
        return matches

    if text.startswith("[") and text.endswith("]"):
        try:
            values = _parse_python_list_field(text, allow_recover=True)
            return [value for value in values if value]
        except Exception:
            pass

    return [text]


def _align_values(values: List[Any], total_posts: int) -> List[Optional[str]]:
    if total_posts <= 0:
        return []
    normalized = [None if value in (None, "") else str(value) for value in values]
    if not normalized:
        return [None] * total_posts
    if len(normalized) == total_posts:
        return normalized
    if len(normalized) == 1:
        return normalized * total_posts
    if len(normalized) < total_posts:
        return normalized + [None] * (total_posts - len(normalized))
    return normalized[:total_posts]


def _build_record(
    user_id: str,
    posts: List[str],
    label: int,
    raw_row: Dict[str, Any],
    timestamps: Optional[List[str]] = None,
    emoji_sequences: Optional[List[str]] = None,
) -> ParsedArchiveRecord:
    clean_posts = [str(post).strip() for post in posts if str(post).strip()]
    timestamp_values = _align_values(timestamps or [], len(clean_posts))
    emoji_values = _align_values(emoji_sequences or [], len(clean_posts))
    return ParsedArchiveRecord(
        user_id=user_id,
        posts=clean_posts,
        label=label,
        raw_row=raw_row,
        timestamps=timestamp_values,
        emoji_sequences=emoji_values,
    )


def _parse_reddit_row(row: Dict[str, str], row_index: int) -> ParsedArchiveRecord:
    user_id = row.get("user", "").strip()
    if not user_id:
        raise ValueError(f"第 {row_index} 行缺少 User")
    posts = _parse_python_list_field(row.get("post", ""), allow_recover=False)
    label = _parse_label(row.get("label", ""), "Label", row_index)
    emoji_sequences = _parse_emoji_sequence(row.get("emojisequence", ""))
    return _build_record(user_id, posts, label, row, emoji_sequences=emoji_sequences)


def _parse_bigdata_row(row: Dict[str, str], row_index: int) -> ParsedArchiveRecord:
    user_id = row.get("user_id", "").strip()
    if not user_id:
        raise ValueError(f"第 {row_index} 行缺少 user_id")
    posts = _parse_python_list_field(row.get("post_sequence", ""), allow_recover=True)
    label = _parse_label(row.get("suicide_risk", ""), "suicide_risk", row_index)
    timestamps = _parse_timestamp_list(row.get("created_utc", ""))
    emoji_raw = row.get("emjio_sequenc", "") or row.get("emjio_sequence", "")
    emoji_sequences = _parse_emoji_sequence(emoji_raw)
    return _build_record(user_id, posts, label, row, timestamps=timestamps, emoji_sequences=emoji_sequences)


def _parse_sigir_row(row: Dict[str, str], row_index: int) -> ParsedArchiveRecord:
    post_text = row.get("post", "").strip()
    posts = [post_text]
    label = _parse_label(row.get("label", ""), "Label", row_index)
    digest = hashlib.md5(post_text.encode("utf-8")).hexdigest()[:8]
    return _build_record(f"sigir_row_{row_index}_{digest}", posts, label, row)


def _parse_weibo_row(row: Dict[str, str], row_index: int) -> ParsedArchiveRecord:
    user_id = row.get("user_id", "").strip()
    if not user_id:
        raise ValueError(f"第 {row_index} 行缺少 user_id")
    posts = _parse_newline_posts(row.get("post", ""))
    label = _parse_label(row.get("label", ""), "label", row_index)
    emoji_sequences = _parse_emoji_sequence(row.get("emoji_sequence", ""))
    return _build_record(user_id, posts, label, row, emoji_sequences=emoji_sequences)


def _build_parser_map():
    return {
        "reddit": _parse_reddit_row,
        "bigdata": _parse_bigdata_row,
        "sigir": _parse_sigir_row,
        "weibo": _parse_weibo_row,
    }


def _validate_required_columns(data_source: str, headers: List[str]) -> List[str]:
    spec = BUILTIN_TEMPLATE_SPECS.get(data_source)
    if not spec:
        raise ValueError(f"未知数据源: {data_source}")
    required = {_normalize_key(col["name"]) for col in spec["requiredColumns"]}
    actual = {_normalize_key(header) for header in headers}
    missing = sorted(required - actual)
    if missing:
        pretty = ", ".join(col["name"] for col in spec["requiredColumns"])
        raise ValueError(
            f"{spec['displayName']} 导入格式不匹配，缺少字段: {', '.join(missing)}。"
            f" 该系列要求字段为: {pretty}"
        )
    return list(actual)


def parse_archive_file(file_path: str, data_source: str) -> Tuple[List[ParsedArchiveRecord], Dict[str, Any]]:
    source = _normalize_key(data_source)
    parser_map = _build_parser_map()
    if source not in parser_map:
        raise ValueError(f"不支持的数据源: {data_source}")

    rows, headers = _load_rows(file_path)
    _validate_required_columns(source, headers)

    parser = parser_map[source]
    records: List[ParsedArchiveRecord] = []

    for row_index, raw_row in enumerate(rows, start=1):
        normalized = _normalize_row_keys(raw_row)
        record = parser(normalized, row_index)
        if not record.posts:
            raise ValueError(f"第 {row_index} 行没有解析出任何贴文")
        records.append(record)

    total_posts = sum(len(record.posts) for record in records)
    risk_dist: Dict[str, int] = {}
    for record in records:
        label_name = _label_to_name_by_source(record.label, source)
        risk_dist[label_name] = risk_dist.get(label_name, 0) + 1

    stats = {
        "total_users": len(records),
        "total_posts": total_posts,
        "risk_distribution": risk_dist,
        "columns": headers,
    }
    return records, stats


def _label_to_name(label: int) -> str:
    label_map = {
        0: "无风险",
        1: "极低风险",
        2: "低风险",
        3: "中风险",
        4: "高风险",
    }
    return label_map.get(label, f"风险{label}")


def _label_to_name_by_source(label: int, data_source: str) -> str:
    fine_labels, _, _ = _build_risk_schema(data_source, [ParsedArchiveRecord(user_id="", posts=[""], label=label, raw_row={})])
    return fine_labels.get(str(label), f"风险{label}")


def _build_risk_schema(data_source: str, records: List[ParsedArchiveRecord]) -> Tuple[Dict[str, str], Dict[str, str], int]:
    max_label = max((record.label for record in records), default=0)
    source = _normalize_key(data_source)

    if source in {"sigir", "weibo"} or max_label <= 1:
        fine_labels = {"0": "无风险", "1": "高风险"}
        coarse_risk_mapping = {"0": "low", "1": "high"}
        class_count = 2
    elif source == "bigdata":
        fine_labels = {"0": "无风险", "1": "低风险", "2": "中风险", "3": "高风险"}
        coarse_risk_mapping = {"0": "low", "1": "low", "2": "medium", "3": "high"}
        class_count = 4
    else:
        fine_labels = {"0": "无风险", "1": "极低风险", "2": "低风险", "3": "中风险", "4": "高风险"}
        coarse_risk_mapping = {"0": "low", "1": "low", "2": "low", "3": "medium", "4": "high"}
        class_count = 5

    return fine_labels, coarse_risk_mapping, class_count


def _detect_language(data_source: str) -> str:
    return "zh" if _normalize_key(data_source) == "weibo" else "en"


def _has_timestamps(records: List[ParsedArchiveRecord]) -> bool:
    return any(any(value for value in record.timestamps) for record in records)


def _has_emojis(records: List[ParsedArchiveRecord]) -> bool:
    return any(any(value for value in record.emoji_sequences) for record in records)


def _importance_level(score: float) -> str:
    if score >= 0.7:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def _normalize_importance_scores(raw_scores: List[float]) -> List[float]:
    if not raw_scores:
        return []
    if len(raw_scores) == 1:
        return [1.0]

    total = sum(score for score in raw_scores if score > 0)
    if total <= 0:
        equal_score = 1.0 / len(raw_scores)
        return [round(equal_score, 4) for _ in raw_scores]

    normalized = [round(max(score, 0.0) / total, 4) for score in raw_scores]
    drift = round(1.0 - sum(normalized), 4)
    if normalized:
        normalized[-1] = round(normalized[-1] + drift, 4)
    return normalized


def _build_template_response() -> Dict[str, Any]:
    sources: Dict[str, Any] = {}
    for source, spec in BUILTIN_TEMPLATE_SPECS.items():
        sources[source] = {
            "source": source,
            "displayName": spec["displayName"],
            "description": spec["description"],
            "requiredColumns": spec["requiredColumns"],
            "optionalColumns": spec["optionalColumns"],
            "postSplitRule": spec["postSplitRule"],
            "riskLabels": spec["riskLabels"],
            "sampleRows": spec["sampleRows"],
            "downloads": {
                "excel": f"/api/upload/archive/templates/{source}/excel",
                "csv": f"/api/upload/archive/templates/{source}/csv",
                "txt": f"/api/upload/archive/templates/{source}/txt",
            },
        }
    return {"sources": sources}


@router.get("/archive/templates")
async def get_archive_templates():
    return {"success": True, "data": _build_template_response()}


@router.get("/archive/templates/{data_source}/{template_type}")
async def download_archive_template(data_source: str, template_type: str):
    source = _normalize_key(data_source)
    template_kind = _normalize_key(template_type)
    spec = BUILTIN_TEMPLATE_SPECS.get(source)
    if not spec:
        raise HTTPException(status_code=404, detail=f"未知数据源: {data_source}")

    file_key = "excel" if template_kind == "excel" else "txt" if template_kind == "txt" else "csv"
    file_name = spec["templateFiles"].get(file_key)
    file_path = os.path.join(DATASET_TEMPLATE_DIR, file_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"模板文件不存在: {file_name}")

    media_type = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if file_name.endswith(".xlsx")
        else "text/plain; charset=utf-8"
    )
    return FileResponse(path=file_path, filename=file_name, media_type=media_type)


@router.post("/archive")
async def upload_archive(
    request: Request,
    file: UploadFile = File(..., description="上传的档案数据文件（CSV/TXT/Excel）"),
    data_source: str = Form("custom", description="数据来源标识"),
):
    source = _normalize_key(data_source)
    if source not in BUILTIN_TEMPLATE_SPECS:
        raise HTTPException(status_code=400, detail=f"请选择有效数据源: {', '.join(BUILTIN_TEMPLATE_SPECS.keys())}")

    ext = get_file_ext(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: .{ext}，仅支持 {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    original_name = sanitize_filename(file.filename or f"unknown.{ext}")
    unique_id = str(uuid.uuid4())[:8]
    saved_name = f"{unique_id}_{original_name}"
    saved_path = os.path.join(ARCHIVES_DIR, saved_name)

    try:
        with open(saved_path, "wb") as buffer:
            chunk_size = 1024 * 1024
            written = 0
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_FILE_SIZE:
                    buffer.close()
                    os.remove(saved_path)
                    raise HTTPException(status_code=413, detail=f"文件大小超过 {MAX_FILE_SIZE // (1024 * 1024)}MB 限制")
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {exc}")

    try:
        records, stats = parse_archive_file(saved_path, source)
    except Exception as exc:
        if os.path.exists(saved_path):
            os.remove(saved_path)
        raise HTTPException(status_code=400, detail=f"文件解析失败: {exc}")

    if not records:
        if os.path.exists(saved_path):
            os.remove(saved_path)
        raise HTTPException(status_code=400, detail="文件中没有有效数据")

    dataset_key = generate_dataset_key(original_name)
    preview = []
    for record in records:
        preview.append(
            {
                "userId": record.user_id,
                "postCount": len(record.posts),
                "riskLabel": _label_to_name_by_source(record.label, source),
                "riskValue": record.label,
                "firstPost": record.posts[0][:80] + "..." if record.posts and len(record.posts[0]) > 80 else (record.posts[0] if record.posts else ""),
            }
        )

    return {
        "success": True,
        "data": {
            "datasetKey": dataset_key,
            "fileName": original_name,
            "savedName": saved_name,
            "filePath": f"/uploads/archives/{saved_name}",
            "totalUsers": stats["total_users"],
            "totalPosts": stats["total_posts"],
            "riskDistribution": stats["risk_distribution"],
            "columns": stats["columns"],
            "preview": preview,
            "template": _build_template_response()["sources"][source],
            "uploadedAt": datetime.now().isoformat(),
        },
    }


@router.post("/archive/confirm")
async def confirm_archive_import(request: Request, import_data: dict):
    dataset_key = import_data.get("datasetKey")
    file_path = import_data.get("filePath")
    data_source = _normalize_key(import_data.get("dataSource", "reddit"))
    accepted_records = import_data.get("acceptedRecords", [])
    is_manual_annotation = import_data.get("isManualAnnotation", False)

    if not dataset_key or not file_path:
        raise HTTPException(status_code=400, detail="缺少必要参数")
    if data_source not in BUILTIN_TEMPLATE_SPECS:
        raise HTTPException(status_code=400, detail=f"未知数据源: {data_source}")

    if file_path.startswith("/"):
        full_path = os.path.join(_BACKEND_ROOT, file_path.lstrip("/"))
    else:
        full_path = os.path.join(ARCHIVES_DIR, file_path)

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="文件不存在，请重新上传")

    records, stats = parse_archive_file(full_path, data_source)
    if accepted_records:
        records_to_import = [record for record in records if record.user_id in accepted_records]
    else:
        records_to_import = records

    fine_labels, coarse_risk_mapping, class_count = _build_risk_schema(data_source, records_to_import)
    fine_risk_dist: Dict[str, int] = {}
    coarse_risk_dist = {"low": 0, "medium": 0, "high": 0}
    for record in records_to_import:
        label_name = _label_to_name_by_source(record.label, data_source)
        fine_risk_dist[label_name] = fine_risk_dist.get(label_name, 0) + 1
        coarse_risk_dist[coarse_risk_mapping.get(str(record.label), "low")] += 1

    has_timestamp = _has_timestamps(records_to_import)
    has_emojis = _has_emojis(records_to_import)

    mysql_pool = _get_mysql_pool(request)
    batch_code = f"BATCH_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"

    try:
        async with mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")

                display_name = os.path.splitext(os.path.basename(full_path))[0]
                await cursor.execute(
                    """
                    INSERT INTO dataset_profile (
                        dataset_key, display_name, description,
                        total_users, total_posts, is_builtin,
                        fine_labels, class_count,
                        coarse_risk_mapping,
                        language, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        display_name = VALUES(display_name),
                        total_users = VALUES(total_users),
                        total_posts = VALUES(total_posts),
                        is_builtin = VALUES(is_builtin),
                        fine_labels = VALUES(fine_labels),
                        class_count = VALUES(class_count),
                        coarse_risk_mapping = VALUES(coarse_risk_mapping),
                        updated_at = VALUES(updated_at)
                    """,
                    (
                        dataset_key,
                        display_name,
                        f"导入自文件: {os.path.basename(full_path)}",
                        len(records_to_import),
                        sum(len(record.posts) for record in records_to_import),
                        0,
                        json.dumps(fine_labels, ensure_ascii=False),
                        class_count,
                        json.dumps(coarse_risk_mapping, ensure_ascii=False),
                        _detect_language(data_source),
                        datetime.now(),
                        datetime.now(),
                    ),
                )

                await cursor.execute(
                    """
                    INSERT INTO archive_import_batch (
                        batch_code, dataset_key, original_filename, file_format,
                        total_rows, unique_users, unique_posts,
                        fine_risk_distribution, fine_class_count, fine_labels,
                        coarse_risk_mapping, coarse_risk_distribution,
                        post_count, is_manual_annotation, has_timestamp, has_emojis,
                        accepted_rows, rejected_rows, status, committed_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        batch_code,
                        dataset_key,
                        os.path.basename(full_path),
                        get_file_ext(full_path),
                        len(records),
                        stats["total_users"],
                        stats["total_posts"],
                        json.dumps(fine_risk_dist, ensure_ascii=False),
                        class_count,
                        json.dumps(fine_labels, ensure_ascii=False),
                        json.dumps(coarse_risk_mapping, ensure_ascii=False),
                        json.dumps(coarse_risk_dist, ensure_ascii=False),
                        1,
                        is_manual_annotation,
                        has_timestamp,
                        has_emojis,
                        len(records_to_import),
                        len(records) - len(records_to_import),
                        "committed",
                        datetime.now(),
                    ),
                )
                batch_id = cursor.lastrowid

                for record in records_to_import:
                    risk_level = coarse_risk_mapping.get(str(record.label), "low")
                    post_timestamp_start = next((ts for ts in record.timestamps if ts), None)
                    post_timestamp_end = next((ts for ts in reversed(record.timestamps) if ts), None)
                    raw_scores = [calculate_importance_score(post) for post in record.posts]
                    scores = _normalize_importance_scores(raw_scores)
                    avg_importance_score = round(sum(scores) / len(scores), 4) if scores else 0.0
                    top_posts_summary = [
                        {
                            "postIndex": post_idx + 1,
                            "content": post[:120],
                            "importanceScore": round(score, 4),
                        }
                        for post_idx, score, post in sorted(
                            [(idx, score, post) for idx, (score, post) in enumerate(zip(scores, record.posts))],
                            key=lambda item: item[1],
                            reverse=True,
                        )[:3]
                    ]

                    archive_params = (
                        record.user_id,
                        data_source,
                        len(record.posts),
                        risk_level,
                        record.label,
                        record.label,
                        1 if has_timestamp else 0,
                        1 if has_emojis else 0,
                        batch_id,
                        datetime.now(),
                        post_timestamp_start,
                        post_timestamp_end,
                        avg_importance_score,
                        json.dumps(top_posts_summary, ensure_ascii=False),
                        "ready",
                    )
                    try:
                        await cursor.execute(
                            """
                            INSERT INTO psychological_archives (
                                user_id, dataset_source, post_count, risk_level, risk_value,
                                label, has_timestamp, has_emojis, import_batch_id, import_timestamp,
                                post_timestamp_start, post_timestamp_end, avg_importance_score, top_posts_summary, status
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE
                                post_count = VALUES(post_count),
                                risk_level = VALUES(risk_level),
                                risk_value = VALUES(risk_value),
                                label = VALUES(label),
                                has_timestamp = VALUES(has_timestamp),
                                has_emojis = VALUES(has_emojis),
                                import_batch_id = VALUES(import_batch_id),
                                import_timestamp = VALUES(import_timestamp),
                                post_timestamp_start = VALUES(post_timestamp_start),
                                post_timestamp_end = VALUES(post_timestamp_end),
                                avg_importance_score = VALUES(avg_importance_score),
                                top_posts_summary = VALUES(top_posts_summary),
                                status = 'ready'
                            """,
                            archive_params,
                        )
                    except Exception as exc:
                        raise ValueError(
                            f"档案写入失败 user_id={record.user_id}, data_source={data_source}, "
                            f"top_posts_summary={archive_params[13]} :: {exc}"
                        ) from exc

                    archive_id = cursor.lastrowid
                    if not archive_id:
                        await cursor.execute(
                            "SELECT id FROM psychological_archives WHERE user_id = %s AND dataset_source = %s LIMIT 1",
                            (record.user_id, data_source),
                        )
                        existing = await cursor.fetchone()
                        archive_id = existing[0] if existing else None
                    if not archive_id:
                        raise ValueError(f"无法定位导入后的档案ID: {record.user_id}")

                    for idx, post_content in enumerate(record.posts):
                        score = scores[idx] if idx < len(scores) else 0.0
                        importance_level = _importance_level(score)
                        post_timestamp = record.timestamps[idx] if idx < len(record.timestamps) else None
                        emoji_sequence = record.emoji_sequences[idx] if idx < len(record.emoji_sequences) else None
                        emoji_count = len([part for part in str(emoji_sequence or "").split(",") if part.strip()]) if emoji_sequence else 0

                        try:
                            await cursor.execute(
                                """
                                INSERT INTO user_posts (
                                    archive_id, user_id, post_index, content, sentiment_score, importance_score,
                                    importance_level, micro_expressions, post_timestamp, emoji_count,
                                    emoji_sequence, fine_risk_value, review_status
                                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                ON DUPLICATE KEY UPDATE
                                    content = VALUES(content),
                                    importance_score = VALUES(importance_score),
                                    importance_level = VALUES(importance_level),
                                    post_timestamp = VALUES(post_timestamp),
                                    emoji_count = VALUES(emoji_count),
                                    emoji_sequence = VALUES(emoji_sequence),
                                    fine_risk_value = VALUES(fine_risk_value),
                                    review_status = VALUES(review_status)
                                """,
                                (
                                    archive_id,
                                    record.user_id,
                                    idx + 1,
                                    post_content,
                                    None,
                                    score,
                                    importance_level,
                                    None,
                                    post_timestamp,
                                    emoji_count,
                                    emoji_sequence,
                                    record.label,
                                    "accepted",
                                ),
                            )
                        except Exception as exc:
                            raise ValueError(
                                f"贴文写入失败 user_id={record.user_id}, post_index={idx + 1}, "
                                f"content={post_content[:60]} :: {exc}"
                            ) from exc

                await conn.commit()

        try:
            home_svc = getattr(request.app.state, "home_service", None)
            if home_svc:
                await home_svc.get_home_stats(force_refresh=True)
        except Exception as refresh_err:
            print(f"[WARN] 刷新首页统计失败: {refresh_err}")

        return {
            "success": True,
            "data": {
                "message": "导入成功",
                "datasetKey": dataset_key,
                "batchCode": batch_code,
                "totalUsers": len(records_to_import),
                "totalPosts": sum(len(record.posts) for record in records_to_import),
                "riskDistribution": coarse_risk_dist,
            },
        }
    except Exception as exc:
        try:
            async with mysql_pool.acquire() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute(
                        "UPDATE archive_import_batch SET status = 'failed', error_message = %s WHERE batch_code = %s",
                        (str(exc), batch_code),
                    )
                    await conn.commit()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"数据库导入失败: {exc}")


@router.get("/archive/datasets")
async def list_uploaded_datasets():
    if not os.path.exists(ARCHIVES_DIR):
        return {"success": True, "data": []}

    datasets = []
    for fname in os.listdir(ARCHIVES_DIR):
        fpath = os.path.join(ARCHIVES_DIR, fname)
        if not os.path.isfile(fpath):
            continue

        datasets.append(
            {
                "fileName": fname,
                "filePath": f"/uploads/archives/{fname}",
                "fileSize": os.path.getsize(fpath),
            }
        )
    return {"success": True, "data": datasets}


@router.delete("/archive/datasets/{filename}")
async def delete_uploaded_dataset(filename: str):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="无效的文件名")

    file_path = os.path.join(ARCHIVES_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    try:
        os.remove(file_path)
        return {"success": True, "message": "文件已删除"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"删除失败: {exc}")
