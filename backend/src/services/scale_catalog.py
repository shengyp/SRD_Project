import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


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
    scoring = definition.get("scoring", {})
    return {
        "code": definition["code"],
        "name": definition.get("name") or definition["code"],
        "full_name": definition.get("full_name") or definition.get("name") or definition["code"],
        "category": definition.get("category") or "general",
        "system_classification": definition.get("system_classification") or {},
        "question_count": question_count,
        "max_score": scoring.get("max_standard_score")
        or scoring.get("max_score")
        or question_count * 3,
        "threshold": default_threshold or 0,
        "description": definition.get("purpose") or definition.get("description") or "",
        "estimated_minutes": definition.get("estimated_minutes") or 5,
        "source_url": definition.get("source_url"),
        "original_paper": definition.get("original_paper"),
        "license_note": definition.get("license_note"),
        "validated_population": definition.get("validated_population"),
        "screening_only": bool(definition.get("screening_only", False)),
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


def _unique_keep_order(items: List[str]) -> List[str]:
    seen = set()
    result: List[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _base_assessment_payload(definition: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "summary": "",
        "label": "",
        "suggestion": None,
        "dimensions": [],
        "alerts": [],
        "interpretation": definition.get("interpretation"),
        "systemClassification": definition.get("system_classification") or {},
        "authority": {
            "sourceUrl": definition.get("source_url"),
            "originalPaper": definition.get("original_paper"),
            "licenseNote": definition.get("license_note"),
            "validatedPopulation": definition.get("validated_population"),
            "screeningOnly": bool(definition.get("screening_only", False)),
        },
        "recommendedActions": [],
        "recommendedNextScales": [],
        "workflowSignals": {
            "needsFollowUp": False,
            "needsCrisisIntervention": False,
            "sleepSignal": False,
            "profileOnly": False,
        },
    }


def _evaluate_cssrs(
    definition: Dict[str, Any],
    answers: List[Dict[str, int]],
) -> Dict[str, Any]:
    normalized_answers: List[Dict[str, Any]] = []
    answer_map: Dict[int, int] = {}
    ideation_score = 0
    highest_positive_item = 0

    for item in answers:
        qid = int(item["qId"])
        raw = int(item["score"])
        answer_map[qid] = raw
        if raw > 0:
            highest_positive_item = max(highest_positive_item, qid)
            if qid <= 4:
                ideation_score = max(ideation_score, qid)
        normalized_answers.append({
            "qId": qid,
            "score": raw,
            "normalizedScore": raw,
        })

    behavior_preparatory = bool(answer_map.get(5, 0) > 0)
    behavior_attempt = bool(answer_map.get(6, 0) > 0)
    high_risk_positive = any(answer_map.get(qid, 0) > 0 for qid in (3, 4, 5, 6))

    risk_label = "低风险"
    risk_level = "low"
    suggestion = "常规随访，提供心理健康支持。"

    if behavior_attempt or behavior_preparatory:
        risk_label = "极高风险"
        risk_level = "high"
        suggestion = "存在自杀相关行为信号，需立即启动危机干预流程并联系专业人员。"
    elif answer_map.get(4, 0) > 0 or answer_map.get(3, 0) > 0:
        risk_label = "高风险"
        risk_level = "high"
        suggestion = "存在高危自杀意念信号，需立即进行人工复核与临床评估。"
    elif answer_map.get(2, 0) > 0 or answer_map.get(1, 0) > 0:
        risk_label = "中风险"
        risk_level = "medium"
        suggestion = "存在自杀相关想法，建议加强随访并评估保护因素。"

    alerts: List[Dict[str, Any]] = []
    if high_risk_positive:
        alerts.append({
            "itemId": highest_positive_item,
            "action": "crisis_intervention",
            "message": "C-SSRS 高危条目阳性，建议立即进入危机干预流程。",
        })

    recommended_actions = []
    if high_risk_positive:
        recommended_actions.append("立即启动危机干预流，并安排人工复核/临床评估。")
    elif risk_level == "medium":
        recommended_actions.append("进入中风险随访，结合保护因素与现实支持系统继续评估。")
    else:
        recommended_actions.append("保留常规随访与心理支持。")

    assessment = _base_assessment_payload(definition)
    assessment["summary"] = f"{definition.get('name') or 'C-SSRS'}评估完成，当前判定为{risk_label}。"
    assessment["label"] = risk_label
    assessment["suggestion"] = suggestion
    assessment["alerts"] = alerts
    assessment["dimensions"] = [
        {
            "id": "ideation",
            "name": "自杀意念",
            "score": ideation_score,
            "label": f"{ideation_score}级" if ideation_score else "未见阳性",
            "riskLevel": "high" if ideation_score >= 3 else ("medium" if ideation_score >= 1 else "low"),
        },
        {
            "id": "behavior",
            "name": "自杀行为",
            "score": int(behavior_preparatory) + int(behavior_attempt),
            "label": "存在行为阳性" if (behavior_preparatory or behavior_attempt) else "未见行为阳性",
            "riskLevel": "high" if (behavior_preparatory or behavior_attempt) else "low",
        },
    ]
    assessment["recommendedActions"] = recommended_actions
    assessment["workflowSignals"] = {
        "needsFollowUp": risk_level in {"medium", "high"},
        "needsCrisisIntervention": high_risk_positive,
        "sleepSignal": False,
        "profileOnly": False,
    }
    assessment["highestPositiveItem"] = highest_positive_item
    assessment["branchingSummary"] = {
        "ideationSeverity": ideation_score,
        "preparatoryBehavior": behavior_preparatory,
        "attemptHistory": behavior_attempt,
        "highRiskPositive": high_risk_positive,
    }

    return {
        "scaleCode": definition["code"],
        "totalScore": highest_positive_item,
        "riskLevel": risk_level,
        "assessmentResult": assessment,
        "normalizedAnswers": normalized_answers,
    }


def _apply_scale_workflow_rules(
    definition: Dict[str, Any],
    total_score: int,
    answer_map: Dict[int, int],
    overall_risk: str,
    alerts: List[Dict[str, Any]],
) -> Tuple[str, Dict[str, Any], List[str], List[str]]:
    code = definition["code"]
    workflow_signals = {
        "needsFollowUp": False,
        "needsCrisisIntervention": False,
        "sleepSignal": False,
        "profileOnly": False,
    }
    recommended_actions: List[str] = []
    next_scales: List[str] = []

    if code == "PHQ-9":
        if int(answer_map.get(9, 0)) > 0:
            alerts.append({
                "itemId": 9,
                "action": "recommend_cssrs",
                "message": "PHQ-9 第9题大于0，建议立即补做 C-SSRS 进行专项自杀风险复核。",
            })
            next_scales.append("C-SSRS")
            recommended_actions.append("补做 C-SSRS 专项风险量表。")
            overall_risk = _best_risk(overall_risk, "medium")
        if total_score >= 10:
            workflow_signals["needsFollowUp"] = True
            recommended_actions.append("进入中风险随访，并建议进一步专业评估。")

    if code == "GAD-7" and total_score >= 10:
        workflow_signals["needsFollowUp"] = True
        recommended_actions.append("进入中风险随访，关注压力源与功能受损情况。")

    if code == "ISI" and total_score >= 10:
        workflow_signals["sleepSignal"] = True
        alerts.append({
            "itemId": 0,
            "action": "sleep_signal",
            "message": "ISI 得分达到 10 分及以上，建议标记为睡眠异常线索并结合情绪量表联动分析。",
        })
        recommended_actions.append("标记睡眠异常线索，并结合情绪/风险模块继续观察。")

    if code == "DASS-21":
        workflow_signals["profileOnly"] = True
        recommended_actions.append("DASS-21 用于情绪状态画像，不单独作为危机判定依据。")

    return overall_risk, workflow_signals, _unique_keep_order(recommended_actions), _unique_keep_order(next_scales)


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
    if normalized_code == "C-SSRS":
        return _evaluate_cssrs(definition, answers)

    question_lookup = _question_map(definition)
    normalized_answers: List[Dict[str, Any]] = []
    answer_map: Dict[int, int] = {}
    total_score = 0
    for item in answers:
        qid = int(item["qId"])
        raw = int(item["score"])
        answer_map[qid] = raw
        question = question_lookup.get(qid, {})
        normalized = _normalize_answer_score(normalized_code, question, raw)
        normalized_answers.append({
            "qId": qid,
            "score": raw,
            "normalizedScore": normalized,
        })
        total_score += normalized
    if normalized_code == "DASS-21":
        total_score = 0
    elif normalized_code == "SDS":
        total_score = round(total_score * 1.25)

    thresholds = definition.get("thresholds") or []
    threshold_hit = _threshold_hit(thresholds, total_score)
    overall_risk = threshold_hit.get("risk_level", "low") if threshold_hit else "low"
    overall_label = threshold_hit.get("label", f"总分 {total_score}") if threshold_hit else f"总分 {total_score}"
    overall_suggestion = threshold_hit.get("suggestion") if threshold_hit else None

    dimension_results: List[Dict[str, Any]] = []
    for dimension in definition.get("scoring", {}).get("dimensions") or []:
        question_ids = {int(qid) for qid in dimension.get("questions") or []}
        raw_dim_score = sum(
            answer["normalizedScore"]
            for answer in normalized_answers
            if answer["qId"] in question_ids
        )
        multiplier = int(dimension.get("multiplier") or 1)
        dim_score = raw_dim_score * multiplier
        total_score += dim_score
        dim_threshold = _threshold_hit(dimension.get("thresholds") or [], dim_score)
        dim_risk = dim_threshold.get("risk_level", "low") if dim_threshold else "low"
        overall_risk = _best_risk(overall_risk, dim_risk)
        dimension_results.append({
            "id": dimension.get("id"),
            "name": dimension.get("name"),
            "rawScore": raw_dim_score,
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

    overall_risk, workflow_signals, recommended_actions, next_scales = _apply_scale_workflow_rules(
        definition=definition,
        total_score=total_score,
        answer_map=answer_map,
        overall_risk=overall_risk,
        alerts=alerts,
    )

    if dimension_results:
        if not thresholds:
            overall_label = "多维情绪画像"
        dim_text = "；".join(
            f"{item['name']} {item['score']}分（{item['label']}）"
            for item in dimension_results
        )
        summary = f"{definition.get('name') or normalized_code}评估完成，{dim_text}"
    else:
        summary = f"{definition.get('name') or normalized_code}评估完成，{overall_label}"

    if workflow_signals["needsFollowUp"] and not overall_suggestion:
        overall_suggestion = "建议进入中风险随访，并结合专业评估进一步确认。"
    if workflow_signals["sleepSignal"] and not overall_suggestion:
        overall_suggestion = "建议关注睡眠异常线索，并结合情绪状态继续观察。"
    if workflow_signals["profileOnly"]:
        overall_suggestion = "该量表用于情绪状态画像，不单独作为危机判定依据。"

    assessment = _base_assessment_payload(definition)
    assessment.update({
        "summary": summary,
        "label": overall_label,
        "suggestion": overall_suggestion,
        "dimensions": dimension_results,
        "alerts": alerts,
        "recommendedActions": recommended_actions,
        "recommendedNextScales": next_scales,
        "workflowSignals": workflow_signals,
    })

    return {
        "scaleCode": normalized_code,
        "totalScore": total_score,
        "riskLevel": overall_risk,
        "assessmentResult": assessment,
        "normalizedAnswers": normalized_answers,
    }
