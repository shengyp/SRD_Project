# 模型中心路由：从 MySQL 数据库获取模型和提示词模板
from fastapi import APIRouter, Query, HTTPException, Request, Body
from pydantic import BaseModel
from typing import List, Optional, Any
from datetime import datetime
import re

router = APIRouter(prefix="", tags=["models"])


# ========================
# Pydantic Models
# ========================
class ModelPredictRequest(BaseModel):
    user_hash: Optional[str] = None
    posts: Optional[List[str]] = None


# ========================
# 数据格式转换辅助函数
# ========================
def convert_model_to_camel(row: dict) -> dict:
    """将数据库蛇底命名转换为驼峰命名"""
    mapping = {
        'id': 'id',
        'model_name': 'modelName',
        'model_code': 'modelCode',
        'model_category': 'modelCategory',
        'model_type': 'modelType',
        'provider': 'provider',
        'api_key': 'apiKey',
        'api_base_url': 'apiBaseUrl',
        'config_template': 'configTemplate',
        'ollama_model_name': 'ollamaModelName',
        'ollama_base_url': 'ollamaBaseUrl',
        'model_path': 'modelPath',
        'lora_path': 'loraPath',
        'detection_type': 'detectionType',
        'model_file_path': 'modelFilePath',
        'embedding_file_path': 'embeddingFilePath',
        'supported_datasets': 'supportedDatasets',
        'description': 'description',
        'version': 'version',
        'is_available': 'isAvailable',
        'is_default': 'isDefault',
        'is_builtin': 'isBuiltin',
        'performance_metrics': 'performanceMetrics',
        'status': 'status',
        'error_message': 'errorMessage',
        'last_used_at': 'lastUsedAt',
        'usage_count': 'usageCount',
        'avg_processing_time_ms': 'avgProcessingTimeMs',
        'created_at': 'createdAt',
        'updated_at': 'updatedAt',
    }

    result = {}
    for key, value in row.items():
        new_key = mapping.get(key, key)
        if new_key == 'createdAt' and value:
            if hasattr(value, 'isoformat'):
                result[new_key] = value.isoformat()
            else:
                result[new_key] = str(value)
        elif new_key == 'updatedAt' and value:
            if hasattr(value, 'isoformat'):
                result[new_key] = value.isoformat()
            else:
                result[new_key] = str(value)
        else:
            result[new_key] = value

    # API 模型：检查是否已配置 API Key
    if row.get('model_type') == 'api':
        result['hasApiKey'] = bool(row.get('api_key') and row.get('api_key').strip())
    else:
        result['hasApiKey'] = None

    # 内置本地模型：总是可用（无需额外配置）
    if row.get('is_builtin') and row.get('model_category') == 'detection':
        result['isAvailable'] = True
        result['status'] = 'active'

    return result


def convert_template_to_camel(row: dict) -> dict:
    """将模板数据库蛇底命名转换为驼峰命名"""
    mapping = {
        'id': 'id',
        'name': 'name',
        'task_type': 'taskType',
        'description': 'description',
        'prompt_content': 'promptContent',
        'variables': 'variables',
        'model_id': 'modelId',
        'is_active': 'isActive',
        'usage_count': 'usageCount',
        'created_at': 'createdAt',
        'updated_at': 'updatedAt',
    }
    
    result = {}
    for key, value in row.items():
        new_key = mapping.get(key, key)
        if new_key == 'createdAt' and value:
            if hasattr(value, 'isoformat'):
                result[new_key] = value.isoformat()
            else:
                result[new_key] = str(value)
        elif new_key == 'updatedAt' and value:
            if hasattr(value, 'isoformat'):
                result[new_key] = value.isoformat()
            else:
                result[new_key] = str(value)
        else:
            result[new_key] = value
    return result


def _get_first_value(data: dict, *keys: str, default: Any = None) -> Any:
    """按顺序读取第一个存在且非 None 的字段值。"""
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return default


def _build_model_code(model_data: dict) -> str:
    """为模型生成稳定的 model_code，避免前端未传时插入失败。"""
    raw_value = _get_first_value(
        model_data,
        'modelCode', 'model_code',
        'ollamaModelName', 'ollama_model_name',
        'modelName', 'model_name',
        default='model'
    )
    normalized = re.sub(r'[^a-z0-9]+', '-', str(raw_value).strip().lower())
    normalized = normalized.strip('-') or 'model'
    suffix = datetime.now().strftime('%Y%m%d%H%M%S%f')
    return f"{normalized}-{suffix}"


def _normalize_template_payload(template_data: dict) -> dict:
    """兼容前端 camelCase 和后端 snake_case。"""
    normalized = dict(template_data)
    field_mapping = {
        'taskType': 'task_type',
        'promptContent': 'prompt_content',
        'modelId': 'model_id',
        'isActive': 'is_active',
    }
    for camel_key, snake_key in field_mapping.items():
        if camel_key in template_data and snake_key not in normalized:
            normalized[snake_key] = template_data[camel_key]
    return normalized


# ========================
# Routes
# 注意：FastAPI 按定义顺序匹配路由，必须将具体路径放在参数路径前面！
# 路由顺序：越具体的路径（无参数）越靠前，带 {xxx} 参数的路径越靠后
# ========================

# ===== A. 无路径参数的具体路由（必须放在所有 {model_id} 路由前面） =====

# A1. 获取所有模型列表
@router.get("/api/models")
async def get_models(
    request: Request,
    category: Optional[str] = Query(None, description="模型分类过滤 (api/local_llm/detection)"),
    model_type: Optional[str] = Query(None, description="模型类型过滤"),
    status: Optional[str] = Query(None, description="状态过滤 (active/inactive/error)"),
):
    """获取所有模型列表"""
    model_svc = request.app.state.model_service
    
    try:
        models = await model_svc.get_models(
            category=category,
            model_type=model_type,
            status=status
        )
        
        # 转换为驼峰命名
        models_camel = [convert_model_to_camel(m) for m in models]
        
        return {
            "success": True,
            "data": models_camel
        }
    except Exception as e:
        print(f"获取模型失败: {e}")
        return {
            "success": True,
            "data": []
        }


# A2. 获取提示词模板列表
@router.get("/api/models/templates")
async def get_model_templates(
    request: Request,
    task_type: Optional[str] = Query(None, description="任务类型过滤"),
    model_id: Optional[int] = Query(None, description="模型ID过滤"),
):
    """获取提示词模板列表"""
    model_svc = request.app.state.model_service
    
    try:
        templates = await model_svc.get_templates(
            task_type=task_type,
            model_id=model_id
        )
        
        # 转换为驼峰命名
        templates_camel = [convert_template_to_camel(t) for t in templates]
        
        return {
            "success": True,
            "data": templates_camel
        }
    except Exception as e:
        print(f"获取模板失败: {e}")
        return {
            "success": True,
            "data": []
        }


# A3. 模型性能对比
@router.get("/api/models/compare")
async def compare_models(
    request: Request,
    model_ids: Optional[str] = Query(None, description="模型ID列表，逗号分隔"),
):
    """模型性能对比"""
    model_svc = request.app.state.model_service
    
    try:
        if model_ids:
            ids = [int(m.strip()) for m in model_ids.split(",")]
        else:
            models = await model_svc.get_models(category='detection')
            ids = [m['id'] for m in models]
        
        models_data = []
        for mid in ids:
            model = await model_svc.get_model_by_id(mid)
            if model:
                metrics = model.get('performance_metrics', {})
                models_data.append({
                    "id": model['id'],
                    "name": model['model_name'],
                    "metrics": metrics or {}
                })
        
        dimensions = ["准确率", "精确率", "召回率", "F1分数", "AUC"]
        
        radar_data = {
            "dimensions": dimensions,
            "models": []
        }
        
        for m in models_data:
            metrics = m["metrics"]
            radar_data["models"].append({
                "name": m["name"],
                "values": [
                    metrics.get("accuracy", 0) if isinstance(metrics, dict) else 0,
                    metrics.get("precision", 0) if isinstance(metrics, dict) else 0,
                    metrics.get("recall", 0) if isinstance(metrics, dict) else 0,
                    metrics.get("f1", 0) if isinstance(metrics, dict) else 0,
                    metrics.get("auc", 0) if isinstance(metrics, dict) else 0
                ]
            })
        
        return {
            "success": True,
            "data": {
                "models": models_data,
                "radar_data": radar_data
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"模型对比失败: {str(e)}")


# A4. 获取推理历史记录
@router.get("/api/models/inference-history")
async def get_inference_history(
    model_id: Optional[str] = Query(None, description="模型ID"),
    limit: int = Query(20, ge=1, le=100),
):
    """获取推理历史记录"""
    import random
    history = [
        {
            "id": f"inf_{i}",
            "model_id": "emoji",
            "user_hash": f"user_{i:04d}",
            "post_count": random.randint(5, 20),
            "risk_score": round(random.uniform(0.1, 0.95), 4),
            "inference_time_ms": random.randint(20, 80),
            "created_at": f"2026-03-{28-i%5+1:02d}T{10+i%12:02d}:{i%60:02d}:00Z"
        }
        for i in range(min(limit, 20))
    ]

    if model_id:
        history = [h for h in history if h.get("model_id") == model_id]

    return {
        "success": True,
        "data": {
            "history": history,
            "total": len(history)
        }
    }


# A5. Ollama 服务健康检查
@router.get("/api/models/ollama/status")
async def get_ollama_status(
    request: Request,
    base_url: Optional[str] = Query(None, description="Ollama 服务地址，默认 http://localhost:11434"),
):
    """获取 Ollama 服务健康状态和已安装模型列表"""
    model_svc = request.app.state.model_service
    default_url = base_url or 'http://localhost:11434'

    try:
        status = await model_svc.check_ollama_health(default_url)
        return {
            "success": True,
            "data": status
        }
    except Exception as e:
        return {
            "success": True,
            "data": {
                "success": False,
                "available": False,
                "base_url": default_url,
                "error": str(e),
                "models": []
            }
        }


# A6. Ollama 已安装模型列表
@router.get("/api/models/ollama/models")
async def list_ollama_installed_models(
    request: Request,
    base_url: Optional[str] = Query(None, description="Ollama 服务地址，默认 http://localhost:11434"),
):
    """获取 Ollama 服务上已安装的模型列表"""
    model_svc = request.app.state.model_service
    default_url = base_url or 'http://localhost:11434'

    try:
        result = await model_svc.list_ollama_available_models(default_url)
        return {
            "success": result.get('success', False),
            "data": {
                "models": result.get('models', []),
                "base_url": default_url
            },
            "error": result.get('error')
        }
    except Exception as e:
        return {
            "success": False,
            "data": {
                "models": [],
                "base_url": default_url
            },
            "error": str(e)
        }


# A7. 获取已配置的 Ollama 模型
@router.get("/api/models/ollama/configured")
async def get_configured_ollama_models(request: Request):
    """获取系统中已配置的 Ollama 模型列表"""
    model_svc = request.app.state.model_service

    try:
        models = await model_svc.get_ollama_models()
        result = []
        for m in models:
            result.append({
                'id': m.get('id'),
                'modelName': m.get('model_name'),
                'modelCode': m.get('model_code'),
                'ollamaModelName': m.get('ollama_model_name'),
                'ollamaBaseUrl': m.get('ollama_base_url'),
                'description': m.get('description'),
                'status': m.get('status'),
                'usageCount': m.get('usage_count')
            })
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        print(f"获取配置的 Ollama 模型失败: {e}")
        return {
            "success": True,
            "data": []
        }


# A8. 获取支持的模型提供商
@router.get("/api/models/providers")
async def get_model_providers(request: Request):
    """获取支持的模型提供商列表"""
    model_svc = request.app.state.model_service

    try:
        providers = await model_svc.list_providers()
        return {
            "success": True,
            "data": providers
        }
    except Exception as e:
        print(f"获取模型提供商失败: {e}")
        return {
            "success": True,
            "data": []
        }


# A9. 获取已配置的 API 模型
@router.get("/api/models/api/configured")
async def get_configured_api_models(request: Request):
    """获取系统中已配置的 API 模型列表"""
    model_svc = request.app.state.model_service

    try:
        models = await model_svc.get_api_models()
        result = []
        for m in models:
            result.append({
                'id': m.get('id'),
                'modelName': m.get('model_name'),
                'modelCode': m.get('model_code'),
                'provider': m.get('provider'),
                'apiBaseUrl': m.get('api_base_url'),
                'description': m.get('description'),
                'status': m.get('status'),
                'usageCount': m.get('usage_count')
            })
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        print(f"获取配置的 API 模型失败: {e}")
        return {
            "success": True,
            "data": []
        }


# ===== B. 带参数的路由（必须在所有具体路径路由之后） =====

# B1. 获取模型详细信息
@router.get("/api/models/{model_id}")
async def get_model_detail(request: Request, model_id: int):
    """获取模型详细信息"""
    model_svc = request.app.state.model_service
    
    try:
        model = await model_svc.get_model_by_id(model_id)
        if not model:
            raise HTTPException(status_code=404, detail="模型不存在")
        
        return {
            "success": True,
            "data": convert_model_to_camel(model)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取模型详情失败: {str(e)}")


# B2. 创建新模型
@router.post("/api/models")
async def create_model(request: Request, model_data: dict = Body(...)):
    """创建新模型"""
    model_svc = request.app.state.model_service
    mysql_pool = request.app.state.mysql_db
    
    try:
        import json
        db_data = {
            'model_name': _get_first_value(model_data, 'modelName', 'model_name'),
            'model_code': _get_first_value(model_data, 'modelCode', 'model_code') or _build_model_code(model_data),
            'model_category': _get_first_value(model_data, 'modelCategory', 'model_category'),
            'model_type': _get_first_value(model_data, 'modelType', 'model_type'),
            'provider': model_data.get('provider'),
            'api_key': _get_first_value(model_data, 'apiKey', 'api_key'),
            'api_base_url': _get_first_value(model_data, 'apiBaseUrl', 'api_base_url'),
            'config_template': _get_first_value(model_data, 'configTemplate', 'config_template'),
            'ollama_model_name': _get_first_value(model_data, 'ollamaModelName', 'ollama_model_name'),
            'ollama_base_url': _get_first_value(model_data, 'ollamaBaseUrl', 'ollama_base_url'),
            'model_path': _get_first_value(model_data, 'modelPath', 'model_path'),
            'lora_path': _get_first_value(model_data, 'loraPath', 'lora_path'),
            'detection_type': _get_first_value(model_data, 'detectionType', 'detection_type'),
            'model_file_path': _get_first_value(model_data, 'modelFilePath', 'model_file_path'),
            'embedding_file_path': _get_first_value(model_data, 'embeddingFilePath', 'embedding_file_path'),
            'supported_datasets': json.dumps(_get_first_value(model_data, 'supportedDatasets', 'supported_datasets')) if _get_first_value(model_data, 'supportedDatasets', 'supported_datasets') else None,
            'description': model_data.get('description'),
            'is_available': _get_first_value(model_data, 'isAvailable', 'is_available', default=True),
            'status': model_data.get('status', 'active'),
        }
        
        db_data = {k: v for k, v in db_data.items() if v is not None}
        
        async with mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                columns = ', '.join(db_data.keys())
                placeholders = ', '.join(['%s'] * len(db_data))
                sql = f"INSERT INTO models ({columns}) VALUES ({placeholders})"
                await cursor.execute(sql, list(db_data.values()))
                await conn.commit()
                model_id = cursor.lastrowid
        
        model = await model_svc.get_model_by_id(model_id)
        return {
            "success": True,
            "data": convert_model_to_camel(model)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建模型失败: {str(e)}")


# B3. 更新模型
@router.put("/api/models/{model_id}")
async def update_model(request: Request, model_id: int, model_data: dict = Body(...)):
    """更新模型"""
    model_svc = request.app.state.model_service
    mysql_pool = request.app.state.mysql_db
    
    try:
        import json
        db_data = {}
        if 'modelName' in model_data:
            db_data['model_name'] = model_data['modelName']
        if 'modelCode' in model_data:
            db_data['model_code'] = model_data['modelCode']
        if 'provider' in model_data:
            db_data['provider'] = model_data['provider']
        if 'apiKey' in model_data:
            db_data['api_key'] = model_data['apiKey']
        if 'apiBaseUrl' in model_data:
            db_data['api_base_url'] = model_data['apiBaseUrl']
        if 'configTemplate' in model_data:
            db_data['config_template'] = model_data['configTemplate']
        if 'ollamaModelName' in model_data:
            db_data['ollama_model_name'] = model_data['ollamaModelName']
        if 'ollamaBaseUrl' in model_data:
            db_data['ollama_base_url'] = model_data['ollamaBaseUrl']
        if 'modelPath' in model_data:
            db_data['model_path'] = model_data['modelPath']
        if 'loraPath' in model_data:
            db_data['lora_path'] = model_data['loraPath']
        if 'detectionType' in model_data:
            db_data['detection_type'] = model_data['detectionType']
        if 'modelFilePath' in model_data:
            db_data['model_file_path'] = model_data['modelFilePath']
        if 'modelCategory' in model_data:
            db_data['model_category'] = model_data['modelCategory']
        if 'modelType' in model_data:
            db_data['model_type'] = model_data['modelType']
        if 'embeddingFilePath' in model_data:
            db_data['embedding_file_path'] = model_data['embeddingFilePath']
        if 'supportedDatasets' in model_data:
            db_data['supported_datasets'] = json.dumps(model_data['supportedDatasets'])
        if 'description' in model_data:
            db_data['description'] = model_data['description']
        if 'isAvailable' in model_data:
            db_data['is_available'] = model_data['isAvailable']
        if 'status' in model_data:
            db_data['status'] = model_data['status']
        
        if not db_data:
            raise HTTPException(status_code=400, detail="没有需要更新的字段")
        
        async with mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                set_clause = ', '.join([f"{k} = %s" for k in db_data.keys()])
                sql = f"UPDATE models SET {set_clause} WHERE id = %s"
                await cursor.execute(sql, list(db_data.values()) + [model_id])
                await conn.commit()
        
        model = await model_svc.get_model_by_id(model_id)
        if not model:
            raise HTTPException(status_code=404, detail="模型不存在")
        
        return {
            "success": True,
            "data": convert_model_to_camel(model)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新模型失败: {str(e)}")


# B4. 删除模型
@router.delete("/api/models/{model_id}")
async def delete_model(request: Request, model_id: int):
    """删除模型（内置模型禁止删除）"""
    model_svc = request.app.state.model_service
    mysql_pool = request.app.state.mysql_db

    try:
        model = await model_svc.get_model_by_id(model_id)
        if not model:
            raise HTTPException(status_code=404, detail="模型不存在")

        if model.get('is_builtin'):
            raise HTTPException(
                status_code=403,
                detail=f"「{model.get('model_name', '内置模型')}」是系统预置模型，禁止删除。"
            )

        async with mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("DELETE FROM models WHERE id = %s", (model_id,))
                await conn.commit()

        return {"success": True, "message": "模型删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除模型失败: {str(e)}")


# B4b. 单独配置 API Key（仅更新 API Key 字段，适用于预置 API 模型模板）
@router.put("/api/models/{model_id}/api-key")
async def update_model_api_key(request: Request, model_id: int, key_data: dict = Body(...)):
    """仅更新模型的 API Key，适用于预置 API 模型模板"""
    model_svc = request.app.state.model_service
    mysql_pool = request.app.state.mysql_db

    try:
        model = await model_svc.get_model_by_id(model_id)
        if not model:
            raise HTTPException(status_code=404, detail="模型不存在")

        if model.get('model_type') != 'api':
            raise HTTPException(status_code=400, detail="仅 API 模型支持配置 API Key")

        api_key = str(_get_first_value(key_data, 'apiKey', 'api_key', default='') or '').strip()

        async with mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "UPDATE models SET api_key = %s, status = %s WHERE id = %s",
                    (api_key, 'active' if api_key else 'inactive', model_id)
                )
                await conn.commit()

        updated = await model_svc.get_model_by_id(model_id)
        return {
            "success": True,
            "data": convert_model_to_camel(updated),
            "message": "API Key 配置成功" if api_key else "API Key 已清除"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"配置 API Key 失败: {str(e)}")


# B5. 模型预测接口
@router.post("/api/models/predict")
async def model_predict(request: Request, predict_req: ModelPredictRequest = Body(...)):
    """模型预测接口"""
    model_svc = request.app.state.model_service
    
    posts = predict_req.posts
    if not posts and predict_req.user_hash:
        user_svc = request.app.state.user_service
        try:
            user_detail = await user_svc.get_user_detail(predict_req.user_hash)
            posts = [p.get("text", "") for p in user_detail.get("posts", [])]
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"用户不存在: {str(e)}")
    
    if not posts:
        raise HTTPException(status_code=400, detail="没有可用的帖子数据")
    
    import random
    
    emoji_score = max(0.1, min(0.95, 0.5 - random.uniform(-0.5, 0.5)))
    
    def score_to_level(score):
        if score >= 0.7:
            return "high"
        elif score >= 0.4:
            return "medium"
        return "low"
    
    return {
        "success": True,
        "data": {
            "user_hash": predict_req.user_hash,
            "post_count": len(posts),
            "predictions": {
                "emoji": {
                    "risk_level": score_to_level(emoji_score),
                    "risk_score": round(emoji_score, 4)
                }
            },
            "timestamp": datetime.now().isoformat()
        }
    }


# ===== C. 模板相关路由（带 template_id 参数） =====

# C1. 获取模板详细信息
@router.get("/api/models/templates/{template_id}")
async def get_template_detail(request: Request, template_id: int):
    """获取模板详细信息"""
    model_svc = request.app.state.model_service
    
    try:
        template = await model_svc.get_template_by_id(template_id)
        if not template:
            raise HTTPException(status_code=404, detail="模板不存在")
        
        return {
            "success": True,
            "data": convert_template_to_camel(template)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取模板详情失败: {str(e)}")


# C2. 创建新提示词模板
@router.post("/api/models/templates")
async def create_template(request: Request, template_data: dict = Body(...)):
    """创建新提示词模板"""
    model_svc = request.app.state.model_service

    try:
        template_data = _normalize_template_payload(template_data)
        required = ['name', 'task_type']
        for field in required:
            if not template_data.get(field):
                raise HTTPException(status_code=400, detail=f"缺少必填字段: {field}")

        template = await model_svc.create_template(template_data)
        return {"success": True, "data": convert_template_to_camel(template)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建模板失败: {str(e)}")


# C3. 更新提示词模板
@router.put("/api/models/templates/{template_id}")
async def update_template(request: Request, template_id: int, template_data: dict = Body(...)):
    """更新提示词模板"""
    model_svc = request.app.state.model_service

    try:
        template_data = _normalize_template_payload(template_data)
        template = await model_svc.update_template(template_id, template_data)
        if not template:
            raise HTTPException(status_code=404, detail="模板不存在")
        return {"success": True, "data": convert_template_to_camel(template)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新模板失败: {str(e)}")


# C4. 删除提示词模板
@router.delete("/api/models/templates/{template_id}")
async def delete_template(request: Request, template_id: int):
    """删除提示词模板"""
    model_svc = request.app.state.model_service

    try:
        deleted = await model_svc.delete_template(template_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="模板不存在或已删除")
        return {"success": True, "message": "模板已删除"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除模板失败: {str(e)}")


# ===== D. 模型测试和推理路由（带 model_id 参数） =====

# D1. 测试模型连接
@router.post("/api/models/{model_id}/test")
async def test_model_connection(
    request: Request,
    model_id: int,
    test_prompt: Optional[str] = Body("请只回复：OK", description="测试提示词"),
):
    """测试模型连接是否可用"""
    model_svc = request.app.state.model_service

    try:
        model_config = await model_svc.get_model_for_inference(model_id)

        if not model_config:
            raise HTTPException(status_code=404, detail="模型不存在或未激活")

        model_type = model_config.get('model_type')

        if model_type == 'ollama':
            result = model_svc.call_ollama_model(
                model_config,
                prompt=test_prompt,
                system_prompt="你是一个测试助手。"
            )

            return {
                "success": result.get('success', False),
                "data": {
                    "model_id": model_id,
                    "model_name": model_config.get('model_name'),
                    "model_type": model_type,
                    "response": result.get('response'),
                    "error": result.get('error')
                }
            }

        elif model_type == 'api':
            result = model_svc.call_api_model(
                model_config,
                prompt=test_prompt,
                system_prompt="你是一个测试助手。"
            )

            return {
                "success": result.get('success', False),
                "data": {
                    "model_id": model_id,
                    "model_name": model_config.get('model_name'),
                    "model_type": model_type,
                    "provider": model_config.get('provider', ''),
                    "response": result.get('response'),
                    "error": result.get('error')
                }
            }

        return {
            "success": True,
            "data": {
                "model_id": model_id,
                "model_name": model_config.get('model_name'),
                "model_type": model_type,
                "response": None,
                "error": f"模型类型 {model_type} 暂不支持在线测试"
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"测试模型失败: {e}")
        return {
            "success": False,
            "data": {
                "model_id": model_id,
                "error": str(e)
            }
        }


# D2. 调用模型推理
@router.post("/api/models/{model_id}/call")
async def call_model_inference(
    request: Request,
    model_id: int,
    inference_data: dict = Body(...),
):
    """调用模型进行推理"""
    model_svc = request.app.state.model_service

    try:
        model_config = await model_svc.get_model_for_inference(model_id)

        if not model_config:
            raise HTTPException(status_code=404, detail="模型不存在或未激活")

        prompt = inference_data.get('prompt')
        if not prompt:
            raise HTTPException(status_code=400, detail="缺少必填参数: prompt")

        system_prompt = inference_data.get('system_prompt', "你是一个有用的AI助手。")

        model_type = model_config.get('model_type')
        result = None

        if model_type == 'ollama':
            result = model_svc.call_ollama_model(
                model_config,
                prompt=prompt,
                system_prompt=system_prompt
            )

        elif model_type == 'api':
            result = model_svc.call_api_model(
                model_config,
                prompt=prompt,
                system_prompt=system_prompt
            )

        else:
            return {
                "success": False,
                "data": {
                    "model_id": model_id,
                    "model_name": model_config.get('model_name'),
                    "model_type": model_type,
                    "response": None,
                    "error": f"模型类型 {model_type} 暂不支持在线推理"
                }
            }

        if result and result.get('success'):
            await model_svc.update_model_usage(model_id, 100)

        return {
            "success": result.get('success', False) if result else False,
            "data": {
                "model_id": model_id,
                "model_name": model_config.get('model_name'),
                "model_type": model_type,
                "response": result.get('response') if result else None,
                "error": result.get('error') if result else "未知错误"
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"模型推理失败: {e}")
        return {
            "success": False,
            "data": {
                "model_id": model_id,
                "error": str(e)
            }
        }
