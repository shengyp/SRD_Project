import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


_CODE_ALIASES = {
    "PHQ9": "PHQ-9",
    "CSSRS": "C-SSRS",
    "GAD7": "GAD-7",
    "DASS21": "DASS-21",
}

_RISK_ORDER = {
    "normal": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}


def normalize_scale_code(scale_code: str) -> str:
    code = (scale_code or "").strip()
    compact = code.replace("-", "").replace("－", "").upper()
    return _CODE_ALIASES.get(compact, code)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _scales_dir() -> Path:
    return _repo_root() / "scales"


@lru_cache(maxsize=1)
def load_scale_catalog() -> Dict[str, Dict[str, Any]]:
    catalog: Dict[str, Dict[str, Any]] = {}
    for file_path in sorted(_scales_dir().glob("*.json")):
        with file_path.open("r", encoding="utf-8") as fp:
            definition = json.load(fp)
        code = normalize_scale_code(definition.get("code", file_path.stem))
        definition["code"] = code
        catalog[code] = definition
    return catalog


def get_scale_definition(scale_code: str) -> Optional[Dict[str, Any]]:
    return load_scale_catalog().get(normalize_scale_code(scale_code))


def get_all_scale_definitions() -> List[Dict[str, Any]]:
    return list(load_scale_catalog().values())


def get_scale_meta(scale_code: str) -> Optional[Dict[str, Any]]:
    definition = get_scale_definition(scale_code)
    if not definition:
        return None

    thresholds = definition.get("thresholds") or []
    default_threshold = None
    for item in thresholds:
        if item.get("risk_level") in {"medium", "high"}:
            default_threshold = item.get("min")
            break

    question_count = definition.get("total_questions") or len(definition.get("questions") or [])
    return {
        "code": definition["code"],
        "name": definition.get("code", definition["code"]),
        "full_name": definition.get("name") or definition["code"],
        "category": definition.get("category") or "general",
        "question_count": question_count,
        "max_score": definition.get("scoring", {}).get("max_standard_score")
        or definition.get("scoring", {}).get("max_score")
        or question_count * 3,
        "threshold": default_threshold or 0,
        "description": definition.get("purpose") or definition.get("description") or "",
        "estimated_minutes": definition.get("estimated_minutes") or 5,
    }


def _question_map(definition: Dict[str, Any]) -> Dict[int, Dict[str, Any]]:
    return {int(item["id"]): item for item in definition.get("questions") or []}


def _threshold_hit(thresholds: List[Dict[str, Any]], score: float) -> Optional[Dict[str, Any]]:
    for threshold in thresholds:
        if threshold.get("min") <= score <= threshold.get("max"):
            return threshold
    return None


def _best_risk(a: str, b: str) -> str:
    return a if _RISK_ORDER.get(a, -1) >= _RISK_ORDER.get(b, -1) else b


def _normalize_answer_score(scale_code: str, question: Dict[str, Any], raw_score: int) -> int:
    if scale_code == "SDS":
        return raw_score
    if scale_code == "BHS" and question.get("reverse"):
        return 1 - raw_score
    return raw_score


def evaluate_scale_answers(
    scale_code: str,
    answers: List[Dict[str, int]],
) -> Dict[str, Any]:
    definition = get_scale_definition(scale_code)
    if not definition:
        raise ValueError(f"量表 '{scale_code}' 不存在")

    normalized_code = definition["code"]
    question_lookup = _question_map(definition)
    normalized_answers: List[Dict[str, Any]] = []
    total_score = 0

    if normalized_code == "C-SSRS":
        ideation_score = 0
        behavior_score = 0
        for item in answers:
            qid = int(item["qId"])
            raw = int(item["score"])
            if raw > 0:
                if qid <= 4:
                    ideation_score = max(ideation_score, qid)
                else:
                    behavior_score = max(behavior_score, qid - 4)
            normalized_answers.append({
                "qId": qid,
                "score": raw,
                "normalizedScore": raw,
            })
        total_score = behavior_score + 4 if behavior_score > 0 else ideation_score
    else:
        for item in answers:
            qid = int(item["qId"])
            raw = int(item["score"])
            question = question_lookup.get(qid, {})
            normalized = _normalize_answer_score(normalized_code, question, raw)
            normalized_answers.append({
                "qId": qid,
                "score": raw,
                "normalizedScore": normalized,
            })
            total_score += normalized

        if normalized_code == "SDS":
            total_score = round(total_score * 1.25)

    thresholds = definition.get("thresholds") or []
    threshold_hit = _threshold_hit(thresholds, total_score)
    overall_risk = threshold_hit.get("risk_level", "low") if threshold_hit else "low"
    overall_label = threshold_hit.get("label", f"总分 {total_score}") if threshold_hit else f"总分 {total_score}"
    overall_suggestion = threshold_hit.get("suggestion") if threshold_hit else None

    dimension_results: List[Dict[str, Any]] = []
    for dimension in definition.get("scoring", {}).get("dimensions") or []:
        question_ids = {int(qid) for qid in dimension.get("questions") or []}
        dim_score = sum(
            answer["normalizedScore"]
            for answer in normalized_answers
            if answer["qId"] in question_ids
        )
        dim_threshold = _threshold_hit(dimension.get("thresholds") or [], dim_score)
        dim_risk = dim_threshold.get("risk_level", "low") if dim_threshold else "low"
        overall_risk = _best_risk(overall_risk, dim_risk)
        dimension_results.append({
            "id": dimension.get("id"),
            "name": dimension.get("name"),
            "score": dim_score,
            "label": dim_threshold.get("label") if dim_threshold else f"{dim_score}分",
            "riskLevel": dim_risk,
        })

    alerts: List[Dict[str, Any]] = []
    for rule in definition.get("special_rules") or []:
        item_id = int(rule.get("item_id", 0))
        answer = next((a for a in normalized_answers if a["qId"] == item_id), None)
        if not answer:
            continue
        expr = str(rule.get("condition", "")).replace("score", str(answer["score"]))
        try:
            matched = bool(eval(expr, {"__builtins__": {}}, {}))
        except Exception:
            matched = False
        if matched:
            alerts.append({
                "itemId": item_id,
                "action": rule.get("action"),
                "message": rule.get("message"),
            })
            overall_risk = _best_risk(overall_risk, "high")

    if dimension_results:
        dim_text = "；".join(
            f"{item['name']} {item['score']}分（{item['label']}）"
            for item in dimension_results
        )
        summary = f"{definition.get('name') or normalized_code}评估完成，{dim_text}"
    else:
        summary = f"{definition.get('name') or normalized_code}评估完成，{overall_label}"

    return {
        "scaleCode": normalized_code,
        "totalScore": total_score,
        "riskLevel": overall_risk,
        "assessmentResult": {
            "summary": summary,
            "label": overall_label,
            "suggestion": overall_suggestion,
            "dimensions": dimension_results,
            "alerts": alerts,
            "interpretation": definition.get("interpretation"),
        },
        "normalizedAnswers": normalized_answers,
    }
