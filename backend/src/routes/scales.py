# 量表任务管理路由：任务创建、提交、查询、删除
# 量表题目和定义数据由前端本地加载，后端仅管理任务状态和评分结果
from fastapi import APIRouter, Query, HTTPException, Request, Body
from pydantic import BaseModel, Field
from typing import List, Optional

router = APIRouter(prefix="", tags=["scales"])


# ========================
# Pydantic Models
# ========================
class ScaleAnswerInput(BaseModel):
    qId: int = Field(validation_alias="qId")
    score: int = Field(validation_alias="score")


class ScaleTaskCreate(BaseModel):
    userHash: str = Field(validation_alias="userHash")
    archiveId: Optional[int] = Field(default=None, validation_alias="archiveId")
    scaleId: str = Field(validation_alias="scaleId")
    dataSource: Optional[str] = Field(default=None, validation_alias="dataSource")


class ScaleTaskSubmit(BaseModel):
    answers: List[ScaleAnswerInput]


# ========================
# 量表静态配置
# ========================
SCALE_META = {
    'PHQ-9':   {'name': 'PHQ-9', 'full_name': '患者健康问卷-9', 'category': 'depression', 'question_count': 9, 'max_score': 27, 'threshold': 10, 'color': '#9b59b6', 'bg_color': '#9b59b6', 'reverse_questions': []},
    'C-SSRS':  {'name': 'C-SSRS', 'full_name': '哥伦比亚自杀严重程度评定量表', 'category': 'suicide', 'question_count': 6, 'max_score': 6, 'threshold': 3, 'color': '#e74c3c', 'bg_color': '#e74c3c', 'reverse_questions': []},
    'GAD-7':   {'name': 'GAD-7', 'full_name': '广泛性焦虑障碍量表', 'category': 'anxiety', 'question_count': 7, 'max_score': 21, 'threshold': 10, 'color': '#3498db', 'bg_color': '#3498db', 'reverse_questions': []},
    'DASS-21': {'name': 'DASS-21', 'full_name': '抑郁焦虑压力量表-21', 'category': 'depression', 'question_count': 21, 'max_score': 63, 'threshold': 21, 'color': '#e91e63', 'bg_color': '#e91e63', 'reverse_questions': []},
    # SDS: 选项1-4分，反向题公式: 5 - score
    'SDS':     {'name': 'SDS', 'full_name': 'Zung抑郁自评量表', 'category': 'depression', 'question_count': 20, 'max_score': 80, 'threshold': 53, 'color': '#f39c12', 'bg_color': '#f39c12', 'reverse_questions': [2, 5, 6, 11, 12, 14, 16, 17, 18, 20], 'option_max': 4},
    # BHS: 选项0-1分（是=1, 否=0），反向题公式: 1 - score
    'BHS':     {'name': 'BHS', 'full_name': '贝克绝望量表', 'category': 'hopelessness', 'question_count': 20, 'max_score': 20, 'threshold': 9, 'color': '#8e44ad', 'bg_color': '#8e44ad', 'reverse_questions': [1, 3, 5, 6, 8, 10, 13, 15, 19], 'option_max': 1},
}


def _normalize_scale_code(scale_code: str) -> str:
    code = scale_code.strip()
    no_hyphen = code.replace("-", "").replace("－", "")
    mapping = {
        "PHQ9": "PHQ-9",
        "CSSRS": "C-SSRS",
        "GAD7": "GAD-7",
        "DASS21": "DASS-21",
    }
    return mapping.get(no_hyphen, code)


def _get_scale_meta(scale_code: str) -> Optional[dict]:
    normalized = _normalize_scale_code(scale_code)
    return SCALE_META.get(normalized)


def _normalize_score(scale_code: str, raw_score: int, question_id: int) -> int:
    """对单个选项分进行归一化处理（含反向计分）

    前端传入的是选项的原始 value（SDS: 1-4, BHS: 0-1, 其他: 0-3），
    后端根据量表类型和题目编号判断是否反向计分，返回归一化后的分值。
    """
    normalized = _normalize_scale_code(scale_code)
    meta = SCALE_META.get(normalized)
    if not meta:
        return raw_score

    reverse_q = meta.get('reverse_questions', [])
    if question_id not in reverse_q:
        return raw_score

    option_max = meta.get('option_max', 3)
    return option_max + 1 - raw_score


def _calculate_total_score(scale_code: str, answers: List[ScaleAnswerInput]) -> int:
    """计算量表总分，自动处理反向计分

    C-SSRS 特殊处理：模块化评分，取最高阳性条目编号
    """
    normalized = _normalize_scale_code(scale_code)

    if normalized == "C-SSRS":
        # C-SSRS: 取最高阳性条目的严重程度编号
        # 意念模块：1-4题，按严重程度递增
        # 行为模块：5-6题，任一阳性表示高风险
        ideation_score = 0
        behavior_score = 0

        for a in answers:
            q_id = a.qId
            score = a.score
            if score > 0:
                if q_id <= 4:
                    ideation_score = max(ideation_score, q_id)
                else:
                    behavior_score = max(behavior_score, q_id - 4)  # Q5=1, Q6=2

        # 综合风险评分
        # 0=无风险, 1-2=低风险(意念1-2), 3-4=中风险(意念3-4), 5-6=高风险(行为)
        return behavior_score > 0 and behavior_score + 4 or ideation_score

    # SDS/BHS/PHQ-9/GAD-7/DASS-21: 直接求和（含反向题处理）
    total = 0
    for a in answers:
        total += _normalize_score(scale_code, a.score, a.qId)
    return total


def _score_to_risk_level(score: float, scale_code: str) -> str:
    normalized = _normalize_scale_code(scale_code)
    if normalized == "PHQ-9":
        if score >= 20: return "high"
        elif score >= 10: return "medium"
        elif score >= 5: return "low"
        return "normal"
    elif normalized == "C-SSRS":
        if score >= 4: return "high"
        elif score >= 2: return "medium"
        elif score >= 1: return "low"
        return "normal"
    elif normalized == "GAD-7":
        if score >= 15: return "high"
        elif score >= 10: return "medium"
        elif score >= 5: return "low"
        return "normal"
    elif normalized == "DASS-21":
        if score >= 61: return "high"
        elif score >= 41: return "medium"
        elif score >= 21: return "low"
        return "normal"
    elif normalized == "SDS":
        if score >= 73: return "high"
        elif score >= 63: return "medium"
        elif score >= 53: return "low"
        return "normal"
    elif normalized == "BHS":
        if score >= 15: return "high"
        elif score >= 9: return "medium"
        elif score >= 4: return "low"
        return "normal"
    else:
        if score >= 60: return "high"
        elif score >= 50: return "medium"
        return "low"


def _build_assessment_result(scale_code: str, total_score: int, answers: List[ScaleAnswerInput]) -> str:
    normalized = _normalize_scale_code(scale_code)

    if normalized == "PHQ-9":
        if total_score <= 4:
            return "无或极轻微抑郁，建议保持心理健康"
        elif total_score <= 9:
            return "轻度抑郁，建议关注情绪变化"
        elif total_score <= 14:
            return "中度抑郁，建议咨询心理医生"
        elif total_score <= 19:
            return "中重度抑郁，建议及时就医"
        return "重度抑郁，需要专业治疗，请尽快就医"

    elif normalized == "GAD-7":
        if total_score <= 4:
            return "无焦虑症状"
        elif total_score <= 9:
            return "轻度焦虑，建议自我调适"
        elif total_score <= 14:
            return "中度焦虑，建议心理咨询"
        return "重度焦虑，需要专业干预"

    elif normalized == "C-SSRS":
        positive_count = sum(1 for a in answers if _normalize_score(scale_code, a.score, a.qId) > 0)
        if positive_count >= 4:
            return "高自杀风险，建议立即专业干预"
        elif positive_count >= 2:
            return "中等自杀风险，建议及时就医"
        elif positive_count >= 1:
            return "低自杀风险，建议持续关注"
        return "无自杀风险迹象"

    elif normalized == "DASS-21":
        if total_score <= 20:
            return "正常范围"
        elif total_score <= 40:
            return "轻度抑郁/焦虑/压力"
        elif total_score <= 60:
            return "中度抑郁/焦虑/压力，建议心理咨询"
        return "重度抑郁/焦虑/压力，需要专业治疗"

    elif normalized == "SDS":
        if total_score <= 52:
            return "正常范围"
        elif total_score <= 62:
            return "轻度抑郁，建议心理疏导"
        elif total_score <= 72:
            return "中度抑郁，建议药物干预联合心理治疗"
        return "重度抑郁，建议立即寻求专业心理/精神科帮助"

    elif normalized == "BHS":
        if total_score <= 3:
            return "正常范围，无明显绝望感"
        elif total_score <= 8:
            return "轻度绝望，建议关注心理健康"
        elif total_score <= 14:
            return "中度绝望，建议进行心理评估和干预"
        return "重度绝望，高自杀风险信号，建议立即进行专项自杀风险评估"

    return f"评估完成，总分 {total_score} 分"


def _task_row_to_response(task_row: dict) -> dict:
    return {
        "id": task_row.get("id"),
        "taskName": task_row.get("task_name"),
        "userHash": task_row.get("user_hash"),
        "userAlias": task_row.get("user_alias"),
        "archiveId": task_row.get("archive_id"),
        "dataSource": task_row.get("data_source"),
        "dataSourceLabel": task_row.get("data_source_label"),
        "scaleId": task_row.get("scale_id"),
        "scaleCode": task_row.get("scale_code"),
        "scaleName": task_row.get("scale_name"),
        "scaleFullName": task_row.get("scale_full_name"),
        "scaleCategory": task_row.get("scale_category"),
        "scaleColor": task_row.get("scale_color"),
        "scaleBgColor": task_row.get("scale_bg_color"),
        "status": task_row.get("status"),
        "progress": task_row.get("progress", 0),
        "totalQuestions": task_row.get("total_questions") or 0,
        "answeredQuestions": task_row.get("answered_questions") or 0,
        "answers": task_row.get("answers"),
        "totalScore": task_row.get("total_score"),
        "riskLevel": task_row.get("risk_level"),
        "assessmentResult": task_row.get("assessment_result"),
        "startedAt": task_row.get("started_at"),
        "completedAt": task_row.get("completed_at"),
        "expiredAt": task_row.get("expired_at"),
        "createdAt": task_row.get("created_at"),
    }


def _get_scale_service(request: Request):
    return request.app.state.scale_service


# ========================
# Routes
# ========================

@router.get("/api/scale/tasks")
async def get_scale_tasks(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
):
    scale_svc = _get_scale_service(request)
    result = await scale_svc.get_tasks(status=status, page=page, page_size=limit)
    return {
        "success": True,
        "data": {
            "tasks": [_task_row_to_response(t) for t in result["tasks"]],
            "stats": result["stats"],
        }
    }


@router.post("/api/scale/tasks")
async def create_scale_task(task: ScaleTaskCreate = Body(...), request: Request = None):
    scale_svc = _get_scale_service(request)
    normalized = _normalize_scale_code(task.scaleId)
    meta = _get_scale_meta(normalized)
    if not meta:
        raise HTTPException(status_code=404, detail=f"量表 '{task.scaleId}' 不存在")

    task_data = {
        "user_hash": task.userHash,
        "user_alias": None,
        "archive_id": task.archiveId,
        "data_source": task.dataSource,
        "data_source_label": task.dataSource,
        "scale_code": normalized,
        "scale_name": meta["name"],
        "scale_full_name": meta["full_name"],
        "scale_category": meta["category"],
        "scale_color": meta["color"],
        "scale_bg_color": meta["bg_color"],
        "total_questions": meta["question_count"],
    }

    task_id = await scale_svc.create_task(task_data)
    created_task = await scale_svc.get_task_by_id(task_id)
    return {"success": True, "data": _task_row_to_response(created_task)}


@router.get("/api/scale/tasks/{task_id}")
async def get_scale_task_detail(task_id: int, request: Request):
    scale_svc = _get_scale_service(request)
    task = await scale_svc.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"success": True, "data": _task_row_to_response(task)}


@router.post("/api/scale/tasks/{task_id}/submit")
async def submit_scale_answers(task_id: int, submit: ScaleTaskSubmit = Body(...), request: Request = None):
    """提交量表答案

    风险计算逻辑统一由后端处理，前端直接使用 task.riskLevel。
    自动处理 SDS/BHS 的反向计分题目。
    """
    scale_svc = _get_scale_service(request)
    task = await scale_svc.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.get("status") == "completed":
        raise HTTPException(status_code=400, detail="该任务已完成，不能重复提交")

    scale_code = task.get("scale_code", "PHQ-9")

    # 后端统一计算归一化总分（含反向题处理）
    total_score = _calculate_total_score(scale_code, submit.answers)

    # 保存原始答案（前端传来的选项 value）
    answers_list = [{"qId": a.qId, "score": a.score} for a in submit.answers]

    risk_level = _score_to_risk_level(total_score, scale_code)
    assessment_result = _build_assessment_result(scale_code, total_score, submit.answers)

    await scale_svc.submit_task(task_id, answers_list, total_score, risk_level, assessment_result)
    updated_task = await scale_svc.get_task_by_id(task_id)
    return {"success": True, "data": _task_row_to_response(updated_task)}


@router.delete("/api/scale/tasks/{task_id}")
async def delete_scale_task(task_id: int, request: Request):
    scale_svc = _get_scale_service(request)
    deleted = await scale_svc.delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"success": True, "message": "删除成功"}
