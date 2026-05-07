from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.services.scale_catalog import (
    evaluate_scale_answers,
    get_all_scale_definitions,
    get_scale_definition,
    get_scale_meta,
    normalize_scale_code,
)

router = APIRouter(prefix="", tags=["scales"])


class ScaleAnswerInput(BaseModel):
    qId: int = Field(validation_alias="qId")
    score: int = Field(validation_alias="score")


class ScaleTaskCreate(BaseModel):
    taskName: Optional[str] = Field(default=None, validation_alias="taskName")
    userHash: str = Field(validation_alias="userHash")
    archiveId: Optional[int] = Field(default=None, validation_alias="archiveId")
    scaleId: str = Field(validation_alias="scaleId")
    dataSource: Optional[str] = Field(default=None, validation_alias="dataSource")


class ScaleTaskSubmit(BaseModel):
    answers: list[ScaleAnswerInput]


def _task_row_to_response(task_row: dict) -> dict:
    return {
        "id": task_row.get("id"),
        "taskName": task_row.get("task_name"),
        "userId": task_row.get("user_id"),
        "userHash": task_row.get("user_hash"),
        "userAlias": task_row.get("user_alias"),
        "archiveId": task_row.get("archive_id"),
        "archiveRiskLevel": task_row.get("archive_risk_level"),
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


@router.get("/api/scale/definitions")
async def get_scale_definitions():
    definitions = get_all_scale_definitions()
    return {"success": True, "data": definitions}


@router.get("/api/scale/definitions/{scale_code}")
async def get_scale_definition_detail(scale_code: str):
    definition = get_scale_definition(scale_code)
    if not definition:
        raise HTTPException(status_code=404, detail="量表不存在")
    return {"success": True, "data": definition}


@router.get("/api/scale/tasks")
async def get_scale_tasks(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    user_hash: Optional[str] = Query(None),
    archive_id: Optional[int] = Query(None),
    data_source: Optional[str] = Query(None),
):
    scale_svc = _get_scale_service(request)
    result = await scale_svc.get_tasks(
        status=status,
        user_hash=user_hash,
        archive_id=archive_id,
        data_source=data_source,
        page=page,
        page_size=limit,
    )
    return {
        "success": True,
        "data": {
            "tasks": [_task_row_to_response(t) for t in result["tasks"]],
            "stats": result["stats"],
        },
    }


@router.post("/api/scale/tasks")
async def create_scale_task(task: ScaleTaskCreate = Body(...), request: Request = None):
    scale_svc = _get_scale_service(request)
    normalized = normalize_scale_code(task.scaleId)
    meta = get_scale_meta(normalized)
    if not meta:
        raise HTTPException(status_code=404, detail=f"量表 '{task.scaleId}' 不存在")

    archive = await scale_svc.find_archive_user(
        user_hash=task.userHash,
        archive_id=task.archiveId,
        data_source=task.dataSource,
    )
    if not archive:
        raise HTTPException(status_code=404, detail="未在心理档案中找到对应用户，请先确认数据源和用户")

    source_label = archive.get("dataset_display_name") or archive.get("dataset_source") or task.dataSource or "unknown"
    task_name = task.taskName or f"{meta['name']}评估任务_{archive['user_id']}"
    task_data = {
        "task_name": task_name,
        "user_id": archive.get("id"),
        "user_hash": archive.get("user_id"),
        "user_alias": archive.get("user_id"),
        "archive_id": archive.get("id"),
        "data_source": archive.get("dataset_source"),
        "data_source_label": source_label,
        "scale_id": None,
        "scale_code": meta["code"],
        "scale_name": meta["name"],
        "scale_full_name": meta["full_name"],
        "scale_category": meta["category"],
        "scale_color": _scale_color(meta["category"]),
        "scale_bg_color": _scale_color(meta["category"]),
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
    scale_svc = _get_scale_service(request)
    task = await scale_svc.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.get("status") == "completed":
        raise HTTPException(status_code=400, detail="该任务已完成，不能重复提交")

    evaluation = evaluate_scale_answers(
        task.get("scale_code", "PHQ-9"),
        [{"qId": item.qId, "score": item.score} for item in submit.answers],
    )

    await scale_svc.submit_task(
        task_id=task_id,
        answers=evaluation["normalizedAnswers"],
        total_score=evaluation["totalScore"],
        risk_level=evaluation["riskLevel"],
        assessment_result=evaluation["assessmentResult"],
    )
    updated_task = await scale_svc.get_task_by_id(task_id)
    return {"success": True, "data": _task_row_to_response(updated_task)}


@router.delete("/api/scale/tasks/{task_id}")
async def delete_scale_task(task_id: int, request: Request):
    scale_svc = _get_scale_service(request)
    deleted = await scale_svc.delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"success": True, "message": "删除成功"}


def _scale_color(category: str) -> str:
    return {
        "suicide": "#ef4444",
        "depression": "#8b5cf6",
        "anxiety": "#3b82f6",
        "hopelessness": "#6366f1",
        "sleep": "#0f766e",
    }.get(category or "", "#3b82f6")
