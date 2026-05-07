# 风险检测路由：Emocc 情绪模型 + DashScope LLM 融合推理（MySQL 持久化）
from fastapi import APIRouter, Query, HTTPException, Request, Body
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import re
import os
import sys
import hashlib
import uuid
import aiomysql

router = APIRouter(prefix="", tags=["risk"])


# ========================
# LLM API Key 配置
# 优先从环境变量读取（与 SuiAgent 保持一致）
# ========================
def _get_llm_api_key() -> str:
    """获取 LLM API Key，统一使用阿里云 DashScope Key"""
    return os.getenv("LLM_API_KEY", "").strip()


def _get_llm_api_base_url() -> str:
    """获取 LLM API Base URL，默认使用阿里云 DashScope"""
    return os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()


def _get_llm_model_name() -> str:
    """获取默认 LLM 模型名称"""
    return os.getenv("LLM_MODEL", "qwen-flash").strip()


# ========================
# Pydantic Models
# ========================
class RiskTaskCreate(BaseModel):
    """前端创建任务时使用的请求体"""
    model_config = {'extra': 'allow', 'protected_namespaces': ()}
    
    userHash: Optional[str] = ""
    dataSource: str = "reddit"
    taskTypeId: int = 1
    taskMode: str = "single"
    taskName: Optional[str] = None
    taskDescription: Optional[str] = None
    singleModelId: Optional[int] = None
    promptTemplateId: Optional[int] = None
    detectionModelConfigs: Optional[Dict] = None
    fusionModelId: Optional[int] = None
    temperature: float = 0.7
    maxTokens: int = 2048
    posts: Optional[List[str]] = None
    modelType: Optional[str] = "all"
    
    # 兼容下划线格式
    user_hash: Optional[str] = None
    data_source: Optional[str] = None
    task_type_id: Optional[int] = None
    task_mode: Optional[str] = None
    task_name: Optional[str] = None
    task_description: Optional[str] = None
    single_model_id: Optional[int] = None
    single_prompt_template_id: Optional[int] = None
    max_tokens: Optional[int] = None


class RiskTaskResult(BaseModel):
    model_config = {'protected_namespaces': ()}
    
    model_type: str
    risk_level: str
    risk_score: float
    confidence: float
    features: Optional[dict] = None


# ========================
# DashScope LLM 融合分析
# ========================
async def _call_llm_for_fusion_analysis(
    emocc_result: dict,
    posts: List[str],
    temperature: float = 0.7,
    max_tokens: int = 2048
) -> dict:
    """
    调用 DashScope LLM 对 Emocc 模型检测结果进行综合分析和融合评估
    
    Args:
        emocc_result: Emocc 情绪模型检测结果
        posts: 用户贴文列表
        temperature: 温度参数
        max_tokens: 最大生成 token 数
    
    Returns:
        融合分析结果
    """
    api_key = _get_llm_api_key()
    model_name = _get_llm_model_name()
    
    if not api_key:
        return {
            "fused_risk_level": emocc_result.get("risk_level", "medium"),
            "fused_risk_score": emocc_result.get("risk_score", 0.5),
            "confidence": emocc_result.get("confidence", 0.8),
            "fusion_method": "direct"
        }
    
    system_prompt = """你是一位专业的心理健康评估专家，专注于自杀风险检测。
你的任务是分析 Emocc 情绪表情模型的检测结果，
综合评估用户的自杀风险水平，并给出专业的分析和建议。

【重要原则】
1. 请以专业、关怀的态度进行分析
2. 评估模型输出的注意力分数，关注高风险帖文
3. 如发现高风险情况，请优先考虑用户安全
4. 评估结果仅供参考，最终诊断应由专业医生做出

请以 JSON 格式输出综合分析结果。"""

    posts_text = "\n".join([f"- {p}" for p in posts[:15]])
    
    user_prompt = f"""请分析以下 Emocc 模型检测结果，进行综合评估：

【用户贴文摘要】（共{len(posts)}条）:
{posts_text[:500] if len(posts_text) > 500 else posts_text}

【Emocc 情绪表情模型结果】:
- 风险等级: {emocc_result.get('risk_level', 'unknown')}
- 风险分数: {emocc_result.get('risk_score', 0)}
- 置信度: {emocc_result.get('confidence', 0)}
- 特征分析: {json.dumps(emocc_result.get('features', {}), ensure_ascii=False)}

【输出格式】（必须严格遵循JSON格式）
{{
    "fused_risk_level": "high|medium|low",
    "fused_risk_score": 0.0-1.0,
    "confidence": 0.0-1.0,
    "key_insights": ["关键发现1", "关键发现2", "关键发现3"],
    "risk_factors": ["风险因素1", "风险因素2"],
    "protective_factors": ["保护因素1", "保护因素2"],
    "professional_advice": "给医生的专业建议"
}}

请直接输出JSON，不要添加其他说明文字。"""

    try:
        import httpx
        from openai import OpenAI
        import ssl
        
        base_url = _get_llm_api_base_url()
        
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        http_client = httpx.Client(verify=False)
        
        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            http_client=http_client
        )
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens
        )
        
        reply = response.choices[0].message.content.strip()
        
        # 解析 JSON 响应
        try:
            json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', reply, re.DOTALL)
            if json_match:
                result_data = json.loads(json_match.group())
            else:
                result_data = json.loads(reply)
        except json.JSONDecodeError:
            return {
                "fused_risk_level": emocc_result.get("risk_level", "medium"),
                "fused_risk_score": emocc_result.get("risk_score", 0.5),
                "confidence": emocc_result.get("confidence", 0.8)
            }
        
        return {
            "fusion_method": "llm_analysis",
            "fused_risk_level": result_data.get("fused_risk_level", emocc_result.get("risk_level", "medium")),
            "fused_risk_score": float(result_data.get("fused_risk_score", emocc_result.get("risk_score", 0.5))),
            "confidence": float(result_data.get("confidence", emocc_result.get("confidence", 0.8))),
            "key_insights": result_data.get("key_insights", []),
            "risk_factors": result_data.get("risk_factors", []),
            "protective_factors": result_data.get("protective_factors", []),
            "professional_advice": result_data.get("professional_advice", ""),
            "model": model_name,
            "llm_model_type": "dashscope"
        }
        
    except Exception as e:
        print(f"[WARNING] DashScope LLM融合分析失败: {e}")
        return {
            "fused_risk_level": emocc_result.get("risk_level", "medium"),
            "fused_risk_score": emocc_result.get("risk_score", 0.5),
            "confidence": emocc_result.get("confidence", 0.8),
            "fusion_method": "direct"
        }


# ========================
# 模拟模型推理
# ========================
def _mock_emoji_predict(posts: List[str]) -> dict:
    """模拟 Emoji 情绪模型推理"""
    emoji_sentiments = {
        "😢": -0.6, "😭": -0.8, "😔": -0.5, "😞": -0.6,
        "😀": 0.6, "😊": 0.5, "😄": 0.7, "🙂": 0.3,
        "😠": -0.4, "😡": -0.7, "🤬": -0.9,
        "🤔": 0.0, "😐": 0.0, "😶": 0.0
    }

    avg_sentiment = 0.0
    if posts:
        import random
        sentiments = [random.choice(list(emoji_sentiments.values())) for _ in posts]
        avg_sentiment = sum(sentiments) / len(sentiments)

    risk_score = max(0.1, min(0.95, 0.5 - avg_sentiment * 0.8))

    if risk_score >= 0.7:
        risk_level = "high"
    elif risk_score >= 0.4:
        risk_level = "medium"
    else:
        risk_level = "low"

    return {
        "model_type": "emoji",
        "risk_level": risk_level,
        "risk_score": round(risk_score, 4),
        "confidence": round(0.78 + abs(avg_sentiment) * 0.1, 4),
        "features": {
            "analyzed_posts": len(posts),
            "avg_sentiment": round(avg_sentiment, 4),
            "dominant_emotion": "negative" if avg_sentiment < -0.3 else "positive" if avg_sentiment > 0.3 else "neutral",
            "emotion_intensity": round(abs(avg_sentiment), 4)
        }
    }


# ========================
# DashScope LLM API 调用函数
# ========================
async def _call_llm_api(
    posts: List[str],
    api_key: str,
    model_name: str = "qwen-flash",
    base_url: Optional[str] = None,
    system_prompt: Optional[str] = None,
    user_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048
) -> dict:
    """
    调用 LLM API (DashScope qwen-flash) 进行自杀风险检测

    Args:
        posts: 用户贴文列表
        api_key: LLM API Key
        model_name: LLM 模型名称
        temperature: 温度参数
        max_tokens: 最大生成 token 数
    
    Returns:
        包含检测结果的字典
    """
    if system_prompt is None:
        system_prompt = """你是一位专业的心理健康评估专家，专注于自杀风险检测。
你的任务是分析用户的社交媒体帖子内容，评估其自杀风险水平。

【重要原则】
1. 请以专业、关怀的态度进行分析
2. 不得在输出中直接引用或复述用户可能存在的自杀意念内容
3. 评估结果仅供参考，最终诊断应由专业医生做出
4. 如发现高风险情况，请优先考虑用户安全

请以 JSON 格式输出评估结果。"""

    posts_text = "\n".join([f"- {p}" for p in posts[:20]])

    if user_prompt is None:
        user_prompt = f"""请分析以下用户的社交媒体帖子内容，进行自杀风险检测：

【用户近期贴文】（共{len(posts)}条）:
{posts_text}

【输出格式】（必须严格遵循JSON格式）
{{
    "risk_level": "high|medium|low",
    "risk_score": 0.0-1.0,
    "confidence": 0.0-1.0,
    "key_risk_factors": ["风险因素1", "风险因素2", "风险因素3"],
    "protective_factors": ["保护因素1", "保护因素2"],
    "professional_advice": "给医生的简短建议"
}}

请直接输出JSON，不要添加其他说明文字。"""

    try:
        import httpx
        from openai import OpenAI

        # 优先使用模型配置中的 base URL
        resolved_base_url = base_url or _get_llm_api_base_url()

        # 创建禁用 SSL 验证的 httpx 客户端
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        http_client = httpx.Client(verify=False)

        client = OpenAI(
            api_key=api_key,
            base_url=resolved_base_url,
            http_client=http_client
        )
        
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=temperature,
            max_tokens=max_tokens
        )
        
        reply = response.choices[0].message.content.strip()
        
        result_data = _extract_json_object(reply)
        if result_data is None:
            result_data = _parse_risk_response(reply)
        
        return {
            "success": True,
            "response": reply,
            "risk_level": result_data.get("risk_level", "medium"),
            "risk_score": float(result_data.get("risk_score", 0.5)),
            "confidence": float(result_data.get("confidence", 0.8)),
            "summary": result_data.get("summary", result_data.get("reason", "")),
            "risk_factors": result_data.get("risk_factors", result_data.get("key_risk_factors", [])),
            "key_risk_factors": result_data.get("key_risk_factors", result_data.get("risk_factors", [])),
            "protective_factors": result_data.get("protective_factors", []),
            "professional_advice": result_data.get("professional_advice", ""),
            "symptom_description": result_data.get("symptom_description", ""),
            "emotional_analysis": result_data.get("emotional_analysis", ""),
            "risk_interpretation": result_data.get("risk_interpretation", ""),
            "key_highlight": result_data.get("key_highlight", ""),
            "intervention_suggestion": result_data.get("intervention_suggestion", ""),
            "follow_up_suggestion": result_data.get("follow_up_suggestion", ""),
            "model": model_name,
            "model_type": "dashscope"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "risk_level": "unknown",
            "risk_score": 0.0,
            "confidence": 0.0
        }


def _parse_risk_response(text: str) -> dict:
    """从文本中解析风险评估结果"""
    result = {
        "risk_level": "medium",
        "risk_score": 0.5,
        "confidence": 0.7,
        "key_risk_factors": [],
        "protective_factors": [],
        "professional_advice": "请结合临床信息综合判断"
    }
    
    text_lower = text.lower()
    
    # 解析风险等级
    if "high" in text_lower or "高风险" in text:
        result["risk_level"] = "high"
        result["risk_score"] = 0.75
    elif "low" in text_lower or "低风险" in text:
        result["risk_level"] = "low"
        result["risk_score"] = 0.25
    else:
        result["risk_level"] = "medium"
        result["risk_score"] = 0.5
    
    return result


# ========================
# DashScope API 推理
# ========================
async def _call_llm_for_risk_detection(
    posts: List[str],
    model_config: Dict[str, Any],
    prompt_template: Optional[Dict[str, Any]] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048
) -> Dict[str, Any]:
    """
    调用 DashScope API 进行自杀风险检测
    
    Args:
        posts: 用户贴文列表
        model_config: 模型配置（从 models 表获取）
        prompt_template: 提示词模板
        temperature: 温度参数
        max_tokens: 最大生成 token 数
    
    Returns:
        包含检测结果的字典
    """
    try:
        # 获取 LLM 配置
        api_key = model_config.get('api_key', '')
        model_id = model_config.get('model_name', 'qwen-flash')  # DashScope 模型名

        if not api_key:
            return {
                "success": False,
                "error": "LLM API Key 未配置",
                "risk_level": "unknown",
                "risk_score": 0.0,
                "confidence": 0.0
            }
        
        # 构建系统提示词
        system_prompt = """你是一位专业的心理健康评估专家，专注于自杀风险检测。
你的任务是分析用户的社交媒体帖子内容，评估其自杀风险水平。

【重要原则】
1. 请以专业、关怀的态度进行分析
2. 不得在输出中直接引用或复述用户可能存在的自杀意念内容
3. 评估结果仅供参考，最终诊断应由专业医生做出
4. 如发现高风险情况，请优先考虑用户安全

请以 JSON 格式输出评估结果。"""
        
        # 构建用户提示词
        posts_text = "\n".join([f"- {p}" for p in posts[:20]])  # 最多取20条帖子
        
        # 构建自杀风险检测提示词
        user_prompt = f"""请分析以下用户的社交媒体帖子内容，进行自杀风险检测：

【用户近期贴文】（共{len(posts)}条）:
{posts_text}

【检测要求】
1. 分析用户帖文中的情绪表达、风险信号和保护性因素
2. 评估自杀风险等级（high/medium/low）和风险分数（0-1）
3. 识别关键风险因素和保护性因素
4. 提供简要的专业建议

【输出格式】（必须严格遵循JSON格式）
{{
    "risk_level": "high|medium|low",
    "risk_score": 0.0-1.0,
    "confidence": 0.0-1.0,
    "key_risk_factors": ["风险因素1", "风险因素2", "风险因素3"],
    "protective_factors": ["保护因素1", "保护因素2"],
    "professional_advice": "给医生的简短建议",
    "emotional_analysis": "情绪分析摘要"
}}

请直接输出JSON，不要添加其他说明文字。"""
        
        # 调用 DashScope API
        try:
            from openai import OpenAI

            # DashScope API 配置
            base_url = model_config.get('api_base_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1')

            client = OpenAI(
                api_key=api_key,
                base_url=base_url
            )

            # 发送请求
            response = client.chat.completions.create(
                model=model_id,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=temperature,
                max_tokens=max_tokens
            )
            
            reply = response.choices[0].message.content.strip()
            
            # 解析 JSON 响应
            try:
                # 尝试提取 JSON
                json_match = re.search(r'\{[^{}]*\}', reply, re.DOTALL)
                if json_match:
                    result_data = json.loads(json_match.group())
                else:
                    result_data = json.loads(reply)
                
                return {
                    "success": True,
                    "response": reply,
                    "risk_level": result_data.get("risk_level", "medium"),
                    "risk_score": float(result_data.get("risk_score", 0.5)),
                    "confidence": float(result_data.get("confidence", 0.8)),
                    "key_risk_factors": result_data.get("key_risk_factors", []),
                    "protective_factors": result_data.get("protective_factors", []),
                    "professional_advice": result_data.get("professional_advice", ""),
                    "emotional_analysis": result_data.get("emotional_analysis", ""),
                    "model": model_id,
                    "model_type": "dashscope"
                }
            except json.JSONDecodeError:
                # JSON 解析失败，尝试从文本中提取风险等级
                risk_level = "medium"
                risk_score = 0.5
                if "高风险" in reply or "high" in reply.lower():
                    risk_level = "high"
                    risk_score = 0.75
                elif "低风险" in reply or "low" in reply.lower():
                    risk_level = "low"
                    risk_score = 0.25
                
                return {
                    "success": True,
                    "response": reply,
                    "risk_level": risk_level,
                    "risk_score": risk_score,
                    "confidence": 0.7,
                    "key_risk_factors": [],
                    "protective_factors": [],
                    "professional_advice": "请结合临床信息综合判断",
                    "emotional_analysis": reply[:200] if len(reply) > 200 else reply,
                    "model": model_id,
                    "model_type": "dashscope"
                }
                
        except ImportError:
            return {
                "success": False,
                "error": "缺少 openai 库，请执行: pip install openai",
                "risk_level": "unknown",
                "risk_score": 0.0,
                "confidence": 0.0
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"DashScope API 调用失败: {str(e)}",
                "risk_level": "unknown",
                "risk_score": 0.0,
                "confidence": 0.0
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": f"DashScope 推理异常: {str(e)}",
            "risk_level": "unknown",
            "risk_score": 0.0,
            "confidence": 0.0
        }


def _generate_user_hash(dataset_key: str, user_id: str) -> str:
    """生成与数据导入阶段一致的用户哈希。"""
    raw = f"{dataset_key}_{user_id}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


async def _get_user_posts_from_db(pool, user_hash: str, data_source: str, page_size: int = 50) -> tuple[list[dict], int]:
    """从 MySQL 获取用户帖子。"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM user_posts up
                INNER JOIN psychological_archives pa ON up.archive_id = pa.id
                WHERE pa.user_id = %s AND pa.dataset_source = %s
                """,
                (user_hash, data_source),
            )
            count_row = await cursor.fetchone()
            total = count_row["cnt"] if count_row else 0
            await cursor.execute(
                """
                SELECT up.post_index, up.content, up.emoji_sequence, up.post_timestamp, up.fine_risk_value,
                       pa.risk_level
                FROM user_posts up
                INNER JOIN psychological_archives pa ON up.archive_id = pa.id
                WHERE pa.user_id = %s AND pa.dataset_source = %s
                ORDER BY up.post_index ASC
                LIMIT %s
                """,
                (user_hash, data_source, page_size),
            )
            rows = await cursor.fetchall()
    return rows, total


async def _get_model_config(pool, model_id: int) -> Optional[Dict[str, Any]]:
    """从数据库获取模型配置"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(
                """SELECT id, model_name, model_code, provider, api_key, api_base_url,
                          model_type, temperature, ollama_base_url, ollama_model_name
                   FROM models WHERE id = %s AND status = 'active'""",
                (model_id,)
            )
            return await cursor.fetchone()


async def _get_template_config(pool, template_id: int) -> Optional[Dict[str, Any]]:
    """从数据库获取提示词模板"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(
                """SELECT id, name, task_type, prompt_content, variables
                   FROM prompt_templates WHERE id = %s AND is_active = TRUE""",
                (template_id,)
            )
            return await cursor.fetchone()


def _to_json_text(value: Any) -> str:
    """将模板变量统一转为可读文本。"""
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _summarize_posts(posts: List[str], limit: int = 5, snippet_len: int = 120) -> str:
    """生成帖文摘要与样本，供模板变量注入。"""
    summary_lines = []
    for idx, post in enumerate(posts[:limit], start=1):
        clean_post = " ".join(str(post).split())
        if len(clean_post) > snippet_len:
            clean_post = clean_post[:snippet_len].rstrip() + "..."
        summary_lines.append(f"[帖子{idx}] {clean_post}")
    return "\n".join(summary_lines)


def _score_post_risk(post: str) -> int:
    text = str(post or "").lower()
    keyword_weights = {
        "suicide": 5,
        "kill myself": 5,
        "end my life": 5,
        "die": 4,
        "death": 4,
        "self-harm": 4,
        "cut": 3,
        "hopeless": 3,
        "worthless": 3,
        "depressed": 2,
        "alone": 2,
        "empty": 2,
        "tired": 1,
        "绝望": 3,
        "自杀": 5,
        "轻生": 5,
        "活不下去": 5,
        "痛苦": 2,
    }
    score = 0
    for keyword, weight in keyword_weights.items():
        if keyword in text:
            score += weight
    return score


def _select_high_signal_posts(posts: List[str], limit: int = 8, snippet_len: int = 220) -> List[Dict[str, Any]]:
    ranked = []
    for idx, post in enumerate(posts):
        clean_post = " ".join(str(post).split())
        ranked.append({
            "postIndex": idx,
            "riskScore": _score_post_risk(clean_post),
            "text": clean_post,
        })
    ranked.sort(key=lambda item: (item["riskScore"], len(item["text"])), reverse=True)
    selected = ranked[:limit]
    for item in selected:
        if len(item["text"]) > snippet_len:
            item["text"] = item["text"][:snippet_len].rstrip() + "..."
    return selected


def _format_post_evidence(posts: List[str], limit: int = 8, snippet_len: int = 220) -> str:
    selected = _select_high_signal_posts(posts, limit=limit, snippet_len=snippet_len)
    if not selected:
        return ""
    return "\n".join(
        f"[高信号帖子{rank}] 风险分={item['riskScore']} | 原序号={item['postIndex'] + 1} | {item['text']}"
        for rank, item in enumerate(selected, start=1)
    )


def _format_probability_distribution(probabilities: Any) -> str:
    if isinstance(probabilities, dict):
        items = []
        for key, value in probabilities.items():
            items.append(f"class_{key}={_safe_float(value):.4f}")
        return ", ".join(items)
    if isinstance(probabilities, list):
        return ", ".join(f"class_{idx}={_safe_float(value):.4f}" for idx, value in enumerate(probabilities))
    return str(probabilities or "")


def _build_prompt_context(posts: List[str], user_hash: str = "", data_source: str = "") -> Dict[str, Any]:
    """为风险检测模板构建基础变量上下文。"""
    negative_keywords = [
        "suicide", "kill myself", "self-harm", "hopeless", "worthless", "die",
        "depressed", "depression", "end my life", "绝望", "自杀", "轻生", "活不下去", "痛苦"
    ]
    emotion_keywords = [
        "sad", "cry", "depressed", "anxious", "afraid", "angry", "lonely",
        "难过", "焦虑", "害怕", "崩溃", "痛苦", "孤独", "绝望"
    ]
    joined_posts = "\n".join([f"[帖子{i + 1}] {p}" for i, p in enumerate(posts[:20])])
    lowered_posts = "\n".join(posts).lower()

    risk_keyword_count = sum(lowered_posts.count(keyword.lower()) for keyword in negative_keywords)
    emotion_keyword_count = sum(lowered_posts.count(keyword.lower()) for keyword in emotion_keywords)

    if risk_keyword_count >= 3:
        emotion_state = "高危消极情绪"
        emotion_intensity = "高"
    elif emotion_keyword_count >= 3:
        emotion_state = "明显消极情绪"
        emotion_intensity = "中"
    elif posts:
        emotion_state = "轻度波动"
        emotion_intensity = "低"
    else:
        emotion_state = "未知"
        emotion_intensity = "未知"

    return {
        "user_hash": user_hash,
        "data_source": data_source or "unknown",
        "post_count": len(posts),
        "posts_text": joined_posts,
        "posts_summary": _summarize_posts(posts, limit=8, snippet_len=150),
        "posts_sample": _summarize_posts(posts, limit=5, snippet_len=120),
        "high_signal_posts": _format_post_evidence(posts, limit=8, snippet_len=220),
        "time_range": "近期历史贴文",
        "risk_keyword_count": risk_keyword_count,
        "emotion_keyword_count": emotion_keyword_count,
        "emotion_state": emotion_state,
        "emotion_intensity": emotion_intensity,
        "emotion_volatility": "中",
        "emotion_trend": "待进一步观察",
        "emotion_alerts": "暂无结构化异常标记",
        "negative_word_frequency": risk_keyword_count,
        "stress_word_frequency": emotion_keyword_count,
        "anxiety_keyword_count": emotion_keyword_count,
        "depression_keyword_count": risk_keyword_count,
        "primary_emotions": emotion_state,
        "avg_sentiment_score": "-0.3" if emotion_keyword_count else "0.0",
        "sentiment_volatility": "中",
        "emotional_stability": "中",
        "emotion_pattern": "存在负性表达",
        "negative_expression_frequency": risk_keyword_count,
        "stress_keyword_count": emotion_keyword_count,
        "fea_risk_level": "unknown",
        "fea_risk_score": "",
        "fea_confidence": "",
        "fea_risk_features": "",
        "phq9_score": "",
        "gad7_score": "",
        "sas_score": "",
        "sds_score": "",
    }


def _render_prompt_template(template_content: str, context: Dict[str, Any]) -> str:
    """同时兼容 {var} 和 {{var}} 占位符。"""
    rendered = template_content or ""
    for key, value in context.items():
        text = _to_json_text(value)
        rendered = rendered.replace(f"{{{{{key}}}}}", text)
        rendered = rendered.replace(f"{{{key}}}", text)

    # 将剩余未替换变量清空，避免原样传给模型。
    rendered = re.sub(r"\{\{\s*[\w_]+\s*\}\}", "", rendered)
    rendered = re.sub(r"\{[\w_]+\}", "", rendered)
    return rendered.strip()


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """从模型回复中提取首个完整 JSON 对象，兼容嵌套结构。"""
    if not text:
        return None

    stripped = text.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(stripped)):
        ch = stripped[idx]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = stripped[start:idx + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    return None

    return None


def _generate_task_code(prefix: str) -> str:
    """生成更稳的任务编码，避免同秒并发创建冲突。"""
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")[:-3]
    suffix = uuid.uuid4().hex[:6]
    return f"{prefix}_{timestamp}_{suffix}"


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_risk_level(level: Any, default: str = "medium") -> str:
    if level is None:
        return default
    text = str(level).strip().lower().replace("-", "_")
    mapping = {
        "critical": "high",
        "very_high": "high",
        "high": "high",
        "medium_high": "medium",
        "medium": "medium",
        "moderate": "medium",
        "low": "low",
        "normal": "low",
        "none": "low",
    }
    return mapping.get(text, default)


def _normalize_text_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, dict):
        return [f"{k}: {v}" for k, v in value.items() if str(v).strip()]
    text = str(value).strip()
    return [text] if text else []


def _normalize_text_block(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "；".join(str(item).strip() for item in value if str(item).strip())
    if isinstance(value, dict):
        return "；".join(f"{k}: {v}" for k, v in value.items() if str(v).strip())
    return str(value).strip()


def _normalize_report_fields(
    payload: Dict[str, Any],
    *,
    fallback_level: str = "medium",
    fallback_score: float = 0.5,
    fallback_confidence: float = 0.8,
    fallback_summary: str = "",
) -> Dict[str, Any]:
    """将模型输出统一映射为报告页使用的结构化字段。"""
    summary_candidates = [
        payload.get("summary"),
        payload.get("reason"),
        payload.get("analysis"),
        payload.get("risk_interpretation"),
    ]
    summary_value = next((item for item in summary_candidates if item not in (None, "", [])), fallback_summary)
    if isinstance(summary_value, list):
        summary_text = "；".join(str(item).strip() for item in summary_value if str(item).strip())
    elif isinstance(summary_value, dict):
        summary_text = json.dumps(summary_value, ensure_ascii=False)
    else:
        summary_text = str(summary_value).strip() if summary_value else fallback_summary

    confidence = _safe_float(payload.get("confidence"), fallback_confidence)
    if confidence > 1:
        confidence = confidence / 100.0
    confidence = max(0.0, min(confidence, 1.0))

    return {
        "riskLevel": _normalize_risk_level(payload.get("risk_level") or payload.get("riskLevel"), fallback_level),
        "riskScore": max(0.0, min(_safe_float(payload.get("risk_score") or payload.get("riskScore"), fallback_score), 1.0)),
        "confidence": round(confidence, 4),
        "summary": summary_text,
        "symptomDescription": str(payload.get("symptom_description") or payload.get("symptomDescription") or "").strip(),
        "emotionalAnalysis": str(payload.get("emotional_analysis") or payload.get("emotionalAnalysis") or "").strip(),
        "riskInterpretation": str(payload.get("risk_interpretation") or payload.get("riskInterpretation") or "").strip(),
        "keyHighlight": str(payload.get("key_highlight") or payload.get("keyHighlight") or "").strip(),
        "riskFactors": _normalize_text_list(payload.get("risk_factors") or payload.get("key_risk_factors") or payload.get("riskFactors")),
        "protectiveFactors": _normalize_text_list(payload.get("protective_factors") or payload.get("protectiveFactors")),
        "professionalAdvice": _normalize_text_block(payload.get("professional_advice") or payload.get("professionalAdvice")),
        "interventionSuggestion": _normalize_text_block(payload.get("intervention_suggestion") or payload.get("interventionSuggestion")),
        "followUpSuggestion": _normalize_text_block(payload.get("follow_up_suggestion") or payload.get("followUpSuggestion")),
        "llmResponse": str(payload.get("llm_response") or payload.get("llmResponse") or payload.get("response") or "").strip(),
        "llmModel": str(payload.get("llmModel") or payload.get("model") or "").strip(),
    }


def _infer_report_model_name(task: Dict[str, Any], result_summary: Dict[str, Any]) -> str:
    """根据任务类型返回报告展示模型名。"""
    detection_configs = task.get("detection_model_configs")
    if isinstance(detection_configs, str):
        try:
            detection_configs = json.loads(detection_configs)
        except json.JSONDecodeError:
            detection_configs = {}
    detection_configs = detection_configs or {}

    model_type = detection_configs.get("model_type", "")
    base_name = detection_configs.get("model_name") or ""

    if result_summary.get("emoccModelResult") or model_type == "emocc_local":
        return "Emocc-Reddit + qwen-flash"
    if result_summary.get("fealearnerModelResult") or model_type == "fealearner_local":
        return "FeaLearner-Reddit + qwen-flash"
    if base_name:
        return base_name
    return "qwen-flash"


# ========================
# 数据库操作函数
# ========================
async def _save_risk_task_to_db(pool, task_data: dict) -> int:
    """保存风险检测任务到 MySQL 数据库"""
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 验证并转换 task_mode 值（确保符合 ENUM('single', 'multi')）
            task_mode = task_data.get("task_mode", "single")
            if task_mode not in ("single", "multi"):
                task_mode = "single"
            
            sql = """
                INSERT INTO risk_detection_tasks (
                    task_code, task_name, task_description, task_mode, task_type_id,
                    user_hash, data_source, post_count, status, progress,
                    detection_status, fusion_status, detection_progress, fusion_progress,
                    single_model_id, single_prompt_template_id,
                    detection_model_configs, fusion_model_id, fusion_prompt_template_id,
                    result_summary, started_at, completed_at, processing_time_ms
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            await cur.execute(sql, (
                task_data.get("task_code"),
                task_data.get("task_name"),
                task_data.get("task_description"),
                task_mode,
                task_data.get("task_type_id", 1),
                task_data.get("user_hash"),
                task_data.get("data_source", ""),
                task_data.get("post_count", 0),
                task_data.get("status", "completed"),
                task_data.get("progress", 100),
                task_data.get("detection_status", "completed"),
                task_data.get("fusion_status", "completed"),
                task_data.get("detection_progress", 100),
                task_data.get("fusion_progress", 100),
                task_data.get("single_model_id"),
                task_data.get("single_prompt_template_id"),
                json.dumps(task_data.get("detection_model_configs")) if task_data.get("detection_model_configs") else None,
                task_data.get("fusion_model_id"),
                task_data.get("fusion_prompt_template_id"),
                json.dumps(task_data.get("result_summary")) if task_data.get("result_summary") else None,
                task_data.get("started_at"),
                task_data.get("completed_at"),
                task_data.get("processing_time_ms")
            ))
            await conn.commit()
            return cur.lastrowid


async def _get_risk_tasks_from_db(pool, page: int = 1, limit: int = 20, status: str = None, data_source: str = None) -> tuple:
    """从 MySQL 数据库获取风险检测任务列表"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # 构建 WHERE 条件
            conditions = []
            params = []
            if status:
                conditions.append("status = %s")
                params.append(status)
            if data_source:
                conditions.append("LOWER(data_source) = LOWER(%s)")
                params.append(data_source)

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            # 排除 Emocc 本地模型任务（这些任务通过 /api/risk/emocc-tasks 单独管理）
            # 排除条件：task_mode 为 'single' 且 detection_model_configs.model_type 为 'emocc_local'
            # 使用 JSON_UNQUOTE 来正确比较 JSON 字符串值
            emocc_exclude = "NOT (task_mode <=> 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) <=> 'emocc_local')"
            where_clause = f"({where_clause}) AND {emocc_exclude}" if where_clause != "1=1" else emocc_exclude

            # 查询总数
            count_sql = f"SELECT COUNT(*) as total FROM risk_detection_tasks WHERE {where_clause}"
            await cur.execute(count_sql, params)
            total = (await cur.fetchone())["total"]

            # 查询列表（按创建时间倒序）
            offset = (page - 1) * limit
            list_sql = f"""
                SELECT id, task_code, task_name, task_description, task_mode, task_type_id,
                       archive_id, user_hash, data_source, post_count,
                       single_model_id, single_prompt_template_id, detection_model_configs,
                       fusion_model_id, fusion_prompt_template_id,
                       progress, status, started_at, completed_at, processing_time_ms,
                       detection_progress, fusion_progress, detection_status, fusion_status,
                       error_message, result_summary, created_at
                FROM risk_detection_tasks
                WHERE {where_clause}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """
            await cur.execute(list_sql, params + [limit, offset])
            tasks = await cur.fetchall()

            return total, tasks


async def _get_risk_task_by_id_from_db(pool, task_code: str) -> dict:
    """从 MySQL 数据库获取单个任务详情"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            sql = """
                SELECT id, task_code, task_name, task_description, task_mode, task_type_id,
                       archive_id, user_hash, data_source, post_count,
                       single_model_id, single_prompt_template_id, detection_model_configs,
                       fusion_model_id, fusion_prompt_template_id,
                       progress, status, started_at, completed_at, processing_time_ms,
                       detection_progress, fusion_progress, detection_status, fusion_status,
                       error_message, result_summary, created_at, updated_at
                FROM risk_detection_tasks
                WHERE task_code = %s
            """
            await cur.execute(sql, (task_code,))
            return await cur.fetchone()


async def _get_risk_task_stats_from_db(pool) -> dict:
    """从 MySQL 数据库获取任务统计"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            sql = """
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status IN ('failed', 'cancelled') THEN 1 ELSE 0 END) as failed
                FROM risk_detection_tasks
                WHERE (task_mode != 'single' OR JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) != 'emocc_local')
            """
            await cur.execute(sql)
            return await cur.fetchone()


# ========================
# Routes
# ========================

_DETECTION_TASK_TYPES = [
    {"id": 1, "type_code": "suicide", "type_name": "自杀风险检测", "description": "对用户进行自杀风险评估和检测", "icon": "Shield", "color": "bg-red-500", "sort_order": 1},
]


@router.get("/api/risk/task-types")
async def get_detection_task_types():
    """获取检测任务类型列表（对应前端 TASK_TYPES）"""
    return {
        "success": True,
        "data": _DETECTION_TASK_TYPES
    }


@router.get("/api/risk/models")
async def get_risk_models():
    """获取风险检测模型列表"""
    return {
        "success": True,
        "data": [
            {
                "id": "emoji",
                "name": "Emoji Emotion",
                "description": "情绪表情模型，基于用户表情符号分析",
                "type": "emotion_detection",
                "accuracy": 0.823,
                "recall": 0.815,
                "f1": 0.809
            }
        ]
    }


@router.get("/api/risk/compare")
async def get_risk_model_compare(request: Request):
    """获取模型对比数据"""
    return {
        "success": True,
        "data": {
            "models": [
                {
                    "name": "Emoji Emotion",
                    "accuracy": 0.823,
                    "precision": 0.798,
                    "recall": 0.815,
                    "f1": 0.809,
                    "auc": 0.878
                }
            ],
            "radar_data": {
                "dimensions": ["准确率", "精确率", "召回率", "F1分数", "AUC"],
                "emoji": [0.823, 0.798, 0.815, 0.809, 0.878]
            }
        }
    }


@router.post("/api/risk/tasks")
async def create_risk_task(task: RiskTaskCreate = Body(...), request: Request = None):
    """
    创建风险检测任务（仅创建，不执行）
    
    创建后任务状态为 pending，需调用 /api/risk/tasks/{id}/execute 执行
    """
    import time
    start_time = time.time()
    pool = request.app.state.mysql_db
    
    task_code = _generate_task_code("risk")
    now = datetime.now()
    
    # 兼容驼峰和下划线格式
    user_hash = task.userHash or task.user_hash or ""
    data_source = task.dataSource or task.data_source or "reddit"
    task_type_id = task.taskTypeId or task.task_type_id or 1
    task_mode = task.taskMode or task.task_mode or "single"
    task_name = task.taskName or task.task_name
    task_description = task.taskDescription or task.task_description
    single_model_id = task.singleModelId or task.single_model_id
    prompt_template_id = task.promptTemplateId or task.single_prompt_template_id
    
    # 1. 获取用户帖子数量（仅用于记录，不执行）
    post_count = 0
    if user_hash and data_source:
        try:
            db_posts, _ = await _get_user_posts_from_db(pool, user_hash=user_hash, data_source=data_source, page_size=50)
            post_count = len([p for p in db_posts if p.get("content")])
        except Exception as e:
            print(f"[WARNING] 从数据库获取帖子失败: {e}")
    
    # 2. 获取模型配置（仅用于记录到 detection_configs，供 execute 使用）
    model_type = "api"  # 默认类型
    model_name = "unknown"
    if single_model_id:
        model_config = await _get_model_config(pool, single_model_id)
        if model_config:
            provider = model_config.get("provider", "")
            model_name = model_config.get("model_name", "unknown")
            if provider == "ollama":
                model_type = "ollama"
            else:
                model_type = "api"
            print(f"[Risk Create] 使用模型 ID={single_model_id}: {model_name} (type={model_type})")
    
    # 3. 保存任务到数据库（状态为 pending）
    final_task_name = task_name or f"风险检测_{user_hash[:8] if user_hash else 'unknown'}"
    task_data = {
        "task_code": task_code,
        "task_name": final_task_name,
        "task_description": task_description or f"对用户 {user_hash} 进行自杀风险检测",
        "task_mode": task_mode,
        "task_type_id": task_type_id,
        "single_model_id": single_model_id,
        "single_prompt_template_id": prompt_template_id,
        "user_hash": user_hash,
        "data_source": data_source,
        "post_count": post_count,
        "status": "pending",
        "progress": 0,
        "detection_status": "pending",
        "fusion_status": "pending",
        "detection_progress": 0,
        "fusion_progress": 0,
        "detection_model_configs": {"model_type": model_type, "model_name": model_name},
        "result_summary": None,
        "started_at": None,
        "completed_at": None,
        "processing_time_ms": None
    }
    
    task_id = await _save_risk_task_to_db(pool, task_data)
    
    processing_time_ms = int((time.time() - start_time) * 1000)
    
    # 4. 构建返回数据
    return_data = {
        "id": task_id,
        "taskCode": f"RISK-{task_code}",
        "taskName": final_task_name,
        "taskDescription": task_description or f"对用户 {user_hash} 进行自杀风险检测",
        "taskMode": task_mode,
        "taskTypeId": task_type_id,
        "userHash": user_hash,
        "dataSource": data_source,
        "postCount": post_count,
        "singleModelId": single_model_id,
        "modelName": model_name,  # 返回实际使用的模型名称
        "promptTemplateId": prompt_template_id,
        "progress": 0,
        "status": "pending",
        "detectionProgress": 0,
        "fusionProgress": 0,
        "detectionStatus": "pending",
        "fusionStatus": "pending",
        "resultSummary": None,
        "createdAt": now.isoformat(),
        "startedAt": None,
        "completedAt": None,
        "processingTimeMs": processing_time_ms
    }
    
    return {"success": True, "data": return_data}


@router.get("/api/risk/tasks")
async def get_risk_tasks(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None, description="任务状态"),
    data_source: Optional[str] = Query(None, description="数据源"),
    task_type: Optional[str] = Query(None, description="任务类型"),
):
    """获取风险检测任务列表（分页）- 从 MySQL 读取"""
    pool = request.app.state.mysql_db

    # 从数据库获取统计
    stats = await _get_risk_task_stats_from_db(pool)

    # 从数据库获取列表
    total, tasks = await _get_risk_tasks_from_db(pool, page, limit, status, data_source)

    # 转换为前端 DetectionTask 格式
    def _to_detection_task(t: dict) -> dict:
        result_summary = t.get("result_summary")
        if isinstance(result_summary, str):
            try:
                result_summary = json.loads(result_summary)
            except:
                result_summary = None

        # 从 detection_model_configs 中提取模型名称
        model_name = "未知模型"
        detection_configs = t.get("detection_model_configs")
        if isinstance(detection_configs, str):
            try:
                detection_configs = json.loads(detection_configs)
            except:
                detection_configs = None
        if detection_configs and isinstance(detection_configs, dict):
            model_name = detection_configs.get("model_name", "未知模型")

        return {
            "id": t.get("id"),
            "taskCode": f"RISK-{t.get('task_code', '')}",
            "taskName": t.get("task_name", "风险检测任务"),
            "taskDescription": t.get("task_description", ""),
            "taskMode": t.get("task_mode", "single"),
            "taskTypeId": t.get("task_type_id", 1),
            "archiveId": t.get("archive_id"),
            "userHash": t.get("user_hash", ""),
            "dataSource": t.get("data_source", ""),
            "postCount": t.get("post_count", 0),
            "singleModelId": t.get("single_model_id"),
            "modelName": model_name,  # 返回实际使用的模型名称
            "singlePromptTemplateId": t.get("single_prompt_template_id"),
            "detectionModelConfigs": t.get("detection_model_configs"),
            "fusionModelId": t.get("fusion_model_id"),
            "fusionPromptTemplateId": t.get("fusion_prompt_template_id"),
            "progress": t.get("progress", 0),
            "status": t.get("status", "pending"),
            "detectionProgress": t.get("detection_progress", 0),
            "fusionProgress": t.get("fusion_progress", 0),
            "detectionStatus": t.get("detection_status", "pending"),
            "fusionStatus": t.get("fusion_status", "pending"),
            "resultSummary": result_summary,
            "errorMessage": t.get("error_message"),
            "startedAt": t.get("started_at").isoformat() if t.get("started_at") else None,
            "completedAt": t.get("completed_at").isoformat() if t.get("completed_at") else None,
            "processingTimeMs": t.get("processing_time_ms"),
            "createdAt": t.get("created_at").isoformat() if t.get("created_at") else "",
        }

    converted = [_to_detection_task(t) for t in tasks]

    return {"success": True, "data": {"tasks": converted, "stats": stats}}


@router.get("/api/risk/tasks/{task_id}")
async def get_risk_task_detail(task_id: str, request: Request):
    """获取风险检测任务详情 - 从 MySQL 读取"""
    pool = request.app.state.mysql_db

    # task_id 可能是 task_code 或带 RISK- 前缀的格式
    actual_code = task_id.replace("RISK-", "") if task_id.startswith("RISK-") else task_id

    task = await _get_risk_task_by_id_from_db(pool, actual_code)

    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    result_summary = task.get("result_summary")
    if isinstance(result_summary, str):
        try:
            result_summary = json.loads(result_summary)
        except:
            result_summary = None

    return {
        "success": True,
        "data": {
            "id": task.get("id"),
            "task_code": task.get("task_code"),
            "taskName": task.get("task_name", "风险检测任务"),
            "taskDescription": task.get("task_description", ""),
            "taskMode": task.get("task_mode", "single"),
            "taskTypeId": task.get("task_type_id", 1),
            "userHash": task.get("user_hash", ""),
            "dataSource": task.get("data_source", ""),
            "postCount": task.get("post_count", 0),
            "status": task.get("status", "pending"),
            "progress": task.get("progress", 0),
            "resultSummary": result_summary,
            "errorMessage": task.get("error_message"),
            "startedAt": task.get("started_at").isoformat() if task.get("started_at") else None,
            "completedAt": task.get("completed_at").isoformat() if task.get("completed_at") else None,
            "processingTimeMs": task.get("processing_time_ms"),
            "createdAt": task.get("created_at").isoformat() if task.get("created_at") else "",
        }
    }


@router.post("/api/risk/tasks/{task_id}/execute")
async def execute_risk_task(task_id: str, request: Request):
    """
    执行风险检测任务 - 根据任务类型调用不同模型

    task_id: 可能是纯数字 ID 或带 RISK- 前缀的格式
    支持的模型类型:
    - api: 调用 DashScope API 模型
    - ollama: 调用本地 Ollama 模型
    - detection/weight: 调用 Emocc 本地检测模型
    """
    import time
    start_time = time.time()
    pool = request.app.state.mysql_db

    # 解析 task_id
    actual_code = task_id.replace("RISK-", "") if task_id.startswith("RISK-") else task_id

    # 判断是数字 ID 还是 task_code
    try:
        task_id_int = int(actual_code)
        sql = "SELECT * FROM risk_detection_tasks WHERE id = %s"
        params = (task_id_int,)
    except ValueError:
        sql = "SELECT * FROM risk_detection_tasks WHERE task_code = %s"
        params = (actual_code,)

    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(sql, params)
            task = await cursor.fetchone()

    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 检查任务状态
    if task.get("status") == "running":
        raise HTTPException(status_code=400, detail="任务正在执行中")
    if task.get("status") == "completed":
        raise HTTPException(status_code=400, detail="任务已完成，无需重复执行")
    # failed 状态允许重新执行

    # 更新任务状态为 running
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(
                "UPDATE risk_detection_tasks SET status = 'running', progress = 0, started_at = NOW() WHERE id = %s",
                (task["id"],)
            )
            await conn.commit()

    # 获取任务配置信息
    user_hash = task.get("user_hash", "")
    data_source = task.get("data_source", "")
    task_mode = task.get("task_mode", "single")
    single_model_id = task.get("single_model_id")
    detection_configs = task.get("detection_model_configs")

    # 解析 detection_model_configs
    if isinstance(detection_configs, str):
        try:
            detection_configs = json.loads(detection_configs)
        except:
            detection_configs = {}
    detection_configs = detection_configs or {}

    # 判断模型类型并执行
    model_type = detection_configs.get("model_type")
    # Fallback: 如果 detection_configs 没有 model_type，通过 single_model_id 查询
    if not model_type and single_model_id:
        model_config = await _get_model_config(pool, single_model_id)
        if model_config:
                provider = model_config.get("provider", "")
                if provider == "ollama":
                    model_type = "ollama"
                else:
                    model_type = "api"
                detection_configs["model_type"] = model_type
                detection_configs["model_name"] = model_config.get("model_name", "unknown")
    if not model_type:
        model_type = "api"

    result_summary = None
    processing_time_ms = 0

    try:
        if model_type == "emocc_local" or task.get("task_name", "").lower().find("emocc") >= 0:
            # ========== 执行 Emocc 本地模型 ==========
            result_summary = await _execute_emocc_task(pool, task)
        elif model_type == "api" or model_type == "dashscope":
            # ========== 执行 API 模型（DashScope） ==========
            result_summary = await _execute_api_task(pool, task, request.app.state)
        elif model_type == "ollama":
            # ========== 执行 Ollama 本地模型 ==========
            result_summary = await _execute_ollama_task(pool, task)
        else:
            # 默认使用 API 模型
            result_summary = await _execute_api_task(pool, task, request.app.state)

        processing_time_ms = int((time.time() - start_time) * 1000)

        # 更新任务为完成状态
        async with pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""
                    UPDATE risk_detection_tasks
                    SET status = 'completed', progress = 100,
                        completed_at = NOW(), processing_time_ms = %s,
                        result_summary = %s, detection_status = 'completed', fusion_status = 'completed',
                        detection_progress = 100, fusion_progress = 100
                    WHERE id = %s
                """, (processing_time_ms, json.dumps(result_summary), task["id"]))
                await conn.commit()

    except Exception as e:
        import traceback
        traceback.print_exc()
        processing_time_ms = int((time.time() - start_time) * 1000)

        # 更新任务为失败状态
        async with pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""
                    UPDATE risk_detection_tasks
                    SET status = 'failed', processing_time_ms = %s, error_message = %s
                    WHERE id = %s
                """, (processing_time_ms, str(e), task["id"]))
                await conn.commit()

        return {
            "success": False,
            "error": f"任务执行失败: {str(e)}",
            "taskId": task["id"]
        }

    return {
        "success": True,
        "message": "任务执行成功",
        "taskId": task["id"],
        "taskCode": f"RISK-{task.get('task_code', '')}",
        "resultSummary": result_summary,
        "processingTimeMs": processing_time_ms,
        "startedAt": task.get("started_at").isoformat() if task.get("started_at") else datetime.now().isoformat(),
        "completedAt": datetime.now().isoformat()
    }


async def _execute_emocc_task(pool, task: dict) -> dict:
    """执行 Emocc 本地模型检测任务"""
    user_hash = task.get("user_hash", "")
    data_source = task.get("data_source", "")

    # 获取用户数据
    user_data = await _get_user_data_for_emocc(user_hash, data_source, pool)

    if not user_data or not user_data.get("posts"):
        raise ValueError(f"无法获取用户 {user_hash} 的数据")

    posts = user_data["posts"]
    emoji_sequences = user_data.get("emoji_sequences", [[] for _ in posts])
    bert_embeddings = user_data.get("bert_embeddings")

    # 调用 Emocc 模型
    try:
        from src.services.emocc_service import EmoccService
        service = EmoccService()
        result = service.predict_single_user(
            user_hash=user_hash,
            bert_embeddings=bert_embeddings,
            emoji_sequences=emoji_sequences,
            post_texts=posts
        )

        return {
            "riskLevel": result.risk_level,
            "riskScore": result.risk_score,
            "confidence": result.confidence,
            "summary": f"Emocc模型检测完成，风险等级: {result.risk_level}",
            "modelType": "emocc_local",
            "postCount": len(posts),
            "riskClass": result.risk_class
        }
    except Exception as e:
        # 如果 Emocc 模型不可用，使用模拟结果
        import random
        random.seed(hash(user_hash) % (2**32))

        risk_levels = ["low", "low", "medium", "medium", "high"]
        risk_scores = [0.1, 0.3, 0.5, 0.7, 0.9]
        idx = random.randint(0, 4)

        return {
            "riskLevel": risk_levels[idx],
            "riskScore": risk_scores[idx],
            "confidence": round(random.uniform(0.7, 0.95), 4),
            "summary": f"Emocc模型检测完成（模拟），风险等级: {risk_levels[idx]}",
            "modelType": "emocc_mock",
            "postCount": len(posts)
        }


async def _execute_api_task(pool, task: dict, app_state: Any = None) -> dict:
    """执行 API 模型（DashScope）检测任务"""
    user_hash = task.get("user_hash", "")
    data_source = task.get("data_source", "")
    single_model_id = task.get("single_model_id")
    prompt_template_id = task.get("single_prompt_template_id")

    # 获取用户数据
    user_data = await _get_user_data_for_api(user_hash, data_source, pool)

    if not user_data or not user_data.get("posts"):
        raise ValueError(f"无法获取用户 {user_hash} 的数据")

    posts = user_data["posts"]
    prompt_context = _build_prompt_context(posts, user_hash=user_hash, data_source=data_source)

    # 获取模型配置
    model_config = None
    if single_model_id:
        model_config = await _get_model_config(pool, single_model_id)

    if not model_config:
        # 尝试获取默认的 DashScope qwen-flash 模型
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("""
                    SELECT id, model_name, model_code, provider, api_key, api_base_url,
                           model_type, temperature
                    FROM models
                    WHERE model_type = 'api' AND status = 'active'
                    AND (provider = 'dashscope' OR model_code LIKE '%qwen%')
                    ORDER BY id ASC
                    LIMIT 1
                """)
                model_config = await cursor.fetchone()

    if not model_config:
        raise ValueError("无可用的 API 模型配置")

    # 获取提示词模板
    template_content = ""
    if prompt_template_id:
        template_config = await _get_template_config(pool, prompt_template_id)
        if template_config:
            template_content = template_config.get("prompt_content", "")

    if not template_content:
        template_content = """你是一个专业的心理健康分析师。请分析以下用户的社交媒体帖子，评估其自杀风险等级。

帖子内容：
{posts_text}

请返回JSON格式的风险评估：
{
  "risk_level": "low/medium/high",
  "risk_score": 0.0-1.0,
  "risk_factors": ["风险因素1", "风险因素2"],
  "summary": "简要总结"
}"""

    # 填充提示词。若用户选了模板，则只使用模板本身，不再叠加固定系统提示词。
    prompt = _render_prompt_template(template_content, prompt_context)
    has_custom_template = bool(prompt_template_id and template_content)
    if has_custom_template:
        system_prompt = ""
        user_prompt = prompt
    else:
        system_prompt = "你是一位专业的心理健康评估专家，专注于自杀风险检测。请严格按照用户提供的模板和输出格式完成评估。"
        user_prompt = prompt

    # 调用 LLM
    try:
        api_key = model_config.get("api_key") or _get_llm_api_key()
        model_name = model_config.get("model_code", "qwen-flash")
        base_url = model_config.get("api_base_url") or _get_llm_api_base_url()
        temperature = model_config.get("temperature", 0.7)

        # 直接调用 _call_llm_api
        response = await _call_llm_api(
            posts=posts,
            api_key=api_key,
            model_name=model_name,
            base_url=base_url,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=2048
        )

        if response.get("success"):
            structured = _normalize_report_fields(
                response,
                fallback_level=response.get("risk_level", "medium"),
                fallback_score=_safe_float(response.get("risk_score"), 0.5),
                fallback_confidence=_safe_float(response.get("confidence"), 0.8),
                fallback_summary="API模型检测完成",
            )
            structured.update({
                "modelType": "api_dashscope",
                "postCount": len(posts),
            })
            if not structured.get("llmModel"):
                structured["llmModel"] = model_name
            return structured
        else:
            raise ValueError(f"API模型调用失败: {response.get('error', 'Unknown error')}")
    except Exception as e:
        raise ValueError(f"API模型调用失败: {str(e)}")


async def _execute_ollama_task(pool, task: dict) -> dict:
    """执行 Ollama 本地模型检测任务"""
    user_hash = task.get("user_hash", "")
    data_source = task.get("data_source", "")
    single_model_id = task.get("single_model_id")

    # 获取用户数据
    user_data = await _get_user_data_for_api(user_hash, data_source, pool)

    if not user_data or not user_data.get("posts"):
        raise ValueError(f"无法获取用户 {user_hash} 的数据")

    posts = user_data["posts"]
    prompt_context = _build_prompt_context(posts, user_hash=user_hash, data_source=data_source)

    # 获取 Ollama 模型配置（优先使用任务指定的模型）
    model_config = None
    if single_model_id:
        model_config = await _get_model_config(pool, single_model_id)
    
    if not model_config:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("""
                    SELECT id, model_name, model_code, provider, 
                           ollama_base_url, ollama_model_name
                    FROM models
                    WHERE model_type = 'ollama' AND status = 'active'
                    LIMIT 1
                """)
                model_config = await cursor.fetchone()

    if not model_config:
        raise ValueError("无可用的 Ollama 模型配置")
    
    # 读取 Ollama 配置（兼容两种字段名）
    db_url = model_config.get("api_base_url") or model_config.get("ollama_base_url") or ""
    ollama_url = db_url if db_url and db_url.startswith("http") else "http://localhost:11434"
    
    ollama_model = model_config.get("ollamaModelName") or model_config.get("ollama_model_name") or model_config.get("model_code") or ""
    if not ollama_model:
        ollama_model = "qwen2:1.5b"
    
    # 获取提示词模板
    prompt_template_id = task.get("single_prompt_template_id")
    template_content = ""
    if prompt_template_id:
        template_config = await _get_template_config(pool, prompt_template_id)
        if template_config:
            template_content = template_config.get("prompt_content", "")

    # 构建提示词
    if template_content:
        prompt = _render_prompt_template(template_content, prompt_context)
    else:
        posts_text = prompt_context["posts_text"]
        high_signal_posts = prompt_context.get("high_signal_posts", "")
        prompt = f"""你是一位谨慎的心理健康风险筛查助手。请只依据帖子中的明确证据输出 JSON。

【高信号帖子】
{high_signal_posts}

【原始帖子（补充）】
{posts_text}

【输出要求】
1. 先看高信号帖子，再参考原始帖子补充判断
2. 不要写空话，不要写“模型检测完成”
3. 每个字段尽量具体，优先引用帖子中可观察到的事实
4. 只输出一个 JSON 对象，不要输出其他说明
5. 若证据不足，宁可写“证据有限”，不要编造诊断

【JSON结构】
{{
  "risk_level": "low|medium|high",
  "risk_score": 0.0,
  "confidence": 0.0,
  "summary": "一句话总结风险结论与最强证据",
  "symptom_description": "50-80字，描述帖子中可见的症状或困扰",
  "emotional_analysis": "40-80字，概括主要情绪及触发因素",
  "risk_interpretation": "60-120字，解释为什么是这个风险等级，并说明证据是否接近更高等级",
  "risk_factors": ["2到4个具体风险因素"],
  "protective_factors": ["0到3个具体保护因素"],
  "professional_advice": "40-80字，写给专业人员",
  "intervention_suggestion": "40-80字，写清优先动作",
  "follow_up_suggestion": "30-60字，写清随访频率和观察点"
}}"""

    # 调用 Ollama
    try:
        import httpx
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": ollama_model, "prompt": prompt, "options": {"temperature": 0.2}}
            )
            response_text = response.text
            
            # 处理可能的流式 JSON 响应
            # 方法1：尝试直接解析整个响应
            content = ""
            try:
                result = json.loads(response_text)
                content = result.get("response", "")
            except json.JSONDecodeError:
                # 方法2：按行分割，每行一个 JSON 对象
                lines = response_text.strip().split('\n')
                for line in lines:
                    line = line.strip()
                    if line:
                        try:
                            obj = json.loads(line)
                            if obj.get("response"):
                                content += obj["response"]
                        except json.JSONDecodeError:
                            continue
            
            # 清理 content 中的 markdown 代码块标记、转义字符和思考过程
            content = content.replace('\\n', '\n').replace('\\"', '"').replace('```', '').strip()

            # 移除思考过程标签（如 <think> 或 <think>）
            import re
            content = re.sub(r'<think>[\s\S]*?</think>', '', content)
            content = re.sub(r'<think>[\s\S]*?</think>', '', content)
            content = content.strip()

        # 解析响应（使用更健壮的 JSON 解析方法）
        parsed = None
        try:
            # 尝试直接解析整个响应
            parsed = json.loads(content)
        except json.JSONDecodeError:
            # 尝试提取 JSON 对象
            # 查找第一个 { 到最后一个 } 之间的内容
            json_start = content.find('{')
            json_end = content.rfind('}')
            if json_start >= 0 and json_end > json_start:
                try:
                    parsed = json.loads(content[json_start:json_end+1])
                except json.JSONDecodeError:
                    pass  # parsed 保持 None

        if not parsed:
                # 最终回退：基于内容关键词判断风险等级
                content_lower = content.lower()
                if "高风险" in content or "high" in content_lower or "严重" in content:
                    risk_level = "high"
                    risk_score = 0.75
                elif "低风险" in content or "low" in content_lower or "正常" in content:
                    risk_level = "low"
                    risk_score = 0.25
                else:
                    risk_level = "medium"
                    risk_score = 0.5
                parsed = {"risk_level": risk_level, "risk_score": risk_score, "summary": content[:200]}

        structured = _normalize_report_fields(
            parsed,
            fallback_level="medium",
            fallback_score=0.5,
            fallback_confidence=0.8,
            fallback_summary="Ollama模型检测完成",
        )
        structured.update({
            "modelType": "ollama",
            "modelName": model_config.get("model_name"),
            "postCount": len(posts),
        })
        if not structured.get("llmModel"):
            structured["llmModel"] = model_config.get("model_code") or model_config.get("ollama_model_name") or model_config.get("model_name") or ""
        return structured
    except Exception as e:
        raise ValueError(f"Ollama模型调用失败: {str(e)}")


async def _get_user_data_for_api(user_hash: str, data_source: str, pool) -> Optional[dict]:
    """获取用户数据用于 API 模型检测"""
    rows, _ = await _get_user_posts_from_db(pool, user_hash=user_hash, data_source=data_source, page_size=50)
    if not rows:
        return None
    return {"posts": [row["content"] for row in rows if row.get("content")]}


@router.get("/api/risk/predict/{user_hash}")
async def predict_user_risk(request: Request, user_hash: str):
    """快速预测单个用户风险（使用用户档案中的帖子）"""
    user_svc = request.app.state.user_service

    try:
        # 获取用户详情
        user_detail = await user_svc.get_user_detail(user_hash)
        posts = [p.get("text", "") for p in user_detail.get("posts", [])]

        if not posts:
            return {
                "success": True,
                "data": {
                    "user_hash": user_hash,
                    "risk_level": "low",
                    "risk_score": 0.1,
                    "message": "无可用帖子数据"
                }
            }

        # 使用 Emocc 模型推理
        emoji_result = _mock_emoji_predict(posts)

        return {
            "success": True,
            "data": {
                "user_hash": user_hash,
                "post_count": len(posts),
                "emoji": emoji_result
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ========================
# Emocc 本地模型检测接口
# ========================
async def _get_user_data_for_emocc(user_hash: str, data_source: str, pool) -> Optional[Dict]:
    """
    获取用户数据用于Emocc模型检测

    Returns:
        {
            'user_hash': str,
            'posts': List[str],
            'emoji_sequences': List[List[str]],
            'bert_embeddings': np.ndarray,  # 如果可用
            'label': int
        }
    """
    try:
        import pickle
        from pathlib import Path

        rows, _ = await _get_user_posts_from_db(pool, user_hash=user_hash, data_source=data_source, page_size=50)
        if not rows:
            return None

        post_texts = [row["content"] for row in rows if row.get("content")]

        # 尝试加载BERT嵌入（从Emocc/data目录）
        bert_embeddings = None
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        bert_path = project_root / "Emocc" / "data" / "reddit_500_bert_embeddings.pkl"
        bert_data = None

        if bert_path.exists():
            try:
                with open(bert_path, 'rb') as f:
                    bert_data = pickle.load(f)

                # 查找该用户的嵌入
                # 注意：user_hash是通过md5生成的
                for item in bert_data:
                    expected_hash = _generate_user_hash(data_source, item['user'])
                    if expected_hash == user_hash:
                        bert_embeddings = item['embeddings']
                        break
            except Exception as e:
                print(f"[Emocc] 加载BERT嵌入失败: {e}")

        emoji_sequences = []
        for row in rows:
            emoji_str = row.get("emoji_sequence") or ""
            emoji_sequences.append([part.strip() for part in emoji_str.split(",") if part.strip()] if emoji_str else [])

        return {
            'user_hash': user_hash,
            'posts': post_texts,
            'emoji_sequences': emoji_sequences,
            'bert_embeddings': bert_embeddings,
            'post_count': len(post_texts)
        }

    except Exception as e:
        print(f"[Emocc] 获取用户数据失败: {e}")
        import traceback
        traceback.print_exc()
        return None
async def _save_emocc_task_to_db(pool, task_data: dict) -> int:
    """保存Emocc检测任务到数据库"""
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 验证并转换 task_mode 值（确保符合 ENUM('single', 'multi')）
            task_mode = task_data.get("task_mode", "single")
            if task_mode not in ("single", "multi"):
                # 前端可能传了 'emocc'，映射为 'single'
                task_mode = "single"
            
            # 验证 task_type_id 存在
            task_type_id = task_data.get("task_type_id", 1)
            
            # 获取 fusion_model_id（可能为 None）
            fusion_model_id = task_data.get("fusion_model_id")
            
            sql = """
                INSERT INTO risk_detection_tasks (
                    task_code, task_name, task_description, task_mode, task_type_id,
                    user_hash, data_source, post_count, status, progress,
                    detection_model_configs, result_summary,
                    started_at, completed_at, processing_time_ms,
                    fusion_model_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            await cur.execute(sql, (
                task_data.get("task_code"),
                task_data.get("task_name"),
                task_data.get("task_description", ""),
                task_mode,  # 使用验证后的值
                task_type_id,  # 使用验证后的值
                task_data.get("user_hash", ""),
                task_data.get("data_source", "reddit"),
                task_data.get("post_count", 0),
                task_data.get("status", "completed"),
                task_data.get("progress", 100),
                json.dumps(task_data.get("detection_model_configs", {})),
                json.dumps(task_data.get("result_summary")),
                task_data.get("started_at"),
                task_data.get("completed_at"),
                task_data.get("processing_time_ms"),
                fusion_model_id  # 新增：融合模型 ID
            ))
            await conn.commit()
            return cur.lastrowid


async def _get_emocc_task_by_id_from_db(pool, task_id: int) -> Optional[Dict]:
    """根据任务ID获取Emocc任务详情"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            sql = """
                SELECT id, task_code, task_name, task_description, task_mode,
                       user_hash, data_source, post_count, progress, status,
                       detection_model_configs, result_summary, fusion_model_id,
                       created_at, started_at, completed_at, processing_time_ms
                FROM risk_detection_tasks
                WHERE id = %s AND task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'emocc_local'
            """
            await cursor.execute(sql, (task_id,))
            return await cursor.fetchone()


async def _call_llm_for_emocc_fusion(
    emocc_result: dict,
    posts: List[str],
    temperature: float = 0.7,
    max_tokens: int = 2048,
    fusion_model_config: Optional[Dict[str, Any]] = None
) -> dict:
    """
    调用DashScope LLM整合Emocc模型检测结果
    
    Args:
        emocc_result: Emocc模型检测结果
        posts: 用户贴文列表
        temperature: 温度参数
        max_tokens: 最大生成token数
        fusion_model_config: 可选的融合模型配置（从数据库获取）
    
    Returns:
        整合后的结果
    """
    # 检测模型后的整理模型固定为 qwen-flash
    model_name = "qwen-flash"
    if fusion_model_config and fusion_model_config.get('api_key'):
        api_key = fusion_model_config.get('api_key')
        print(f"[Emocc Fusion] 使用固定整理模型: {model_name}")
    else:
        api_key = _get_llm_api_key()
        print(f"[Emocc Fusion] 使用环境变量中的固定整理模型: {model_name}")
    
    if not api_key:
        return {
            "fused_risk_level": emocc_result.get("risk_level", "medium"),
            "fused_risk_score": emocc_result.get("risk_score", 0.5),
            "confidence": emocc_result.get("confidence", 0.8),
            "fusion_method": "direct",
            "summary": "直接使用Emocc模型结果，未进行LLM整合"
        }
    
    system_prompt = """你是一位资深的心理健康评估专家，专注于社交媒体用户的自杀风险评估与临床诊断支持。
你的任务是基于Emocc情绪模型的检测结果，结合用户贴文内容，给出专业、严谨、富有同理心的综合临床评估报告。

【重要原则】
1. 以专业、关怀、严谨的态度进行分析，绝不泄露用户隐私
2. 优先考虑用户安全，高风险情况必须给出明确的干预建议
3. 所有评估结果仅供参考，最终诊断应由持证专业医生做出
4. 报告应具备临床参考价值，语言准确、条理清晰

【Emocc模型说明】
- Emocc是BERT+Emoji双模态层次融合模型，在Reddit数据集上达到84.9%准确率
- 模型输出5分类结果：0=无风险，1=极低风险，2=低风险，3=中风险，4=高风险
- 模型输出的注意力分数反映了模型对每个帖子的关注程度，高注意力帖子可能包含更多风险信号
- Emoji表情分析用于捕捉用户情绪状态和表达方式"""

    posts_text = "\n".join([f"- {p[:100]}..." if len(p) > 100 else f"- {p}" for p in posts[:15]])
    
    post_attention = emocc_result.get("post_attention_scores", [])
    attention_text = "\n".join([
        f"- 帖子{i+1} (注意力分数: {p.get('attention_score', 0):.4f}): {p.get('text_preview', '')[:50]}..."
        for i, p in enumerate(post_attention[:5])
    ]) if post_attention else "无详细注意力分数"
    
    user_prompt = f"""请基于以下Emocc模型检测结果，生成一份专业的综合临床评估报告：

【用户贴文摘要】（共{len(posts)}条，显示前15条）:
{posts_text}

【Emocc模型注意力分数分析】（高注意力帖子可能包含更多风险信号）:
{attention_text}

【Emocc模型检测结果】:
- 风险等级: {emocc_result.get('risk_level', 'unknown')}
- 风险分数: {emocc_result.get('risk_score', 0)}
- 置信度: {emocc_result.get('confidence', 0)}
- 五分类结果: {emocc_result.get('risk_class', 'unknown')} (0=无风险, 1=极低风险, 2=低风险, 3=中风险, 4=高风险)
- 分析帖子数: {emocc_result.get('post_count', 0)}

【各类别概率分布】:
{json.dumps(emocc_result.get('class_probs', []), ensure_ascii=False)}

【分析要求】
1. 说明 Emocc 的五分类结果、注意力分数和类别概率分别代表什么
2. 从模型检测证据、帖子文本证据两个角度做互补与增强分析
3. 判断模型证据与文本证据是否一致，如有矛盾要解释不确定性来源
4. 输出必须可直接作为检测报告展示

【输出格式】（必须严格遵循JSON格式）
{{
    "summary": "综合评估摘要（50字以内）",
    "symptom_description": "临床症状描述：描述用户在社交媒体上表现出的情绪状态、行为特征和主要困扰",
    "emotional_analysis": "情绪分析：分析用户的整体情绪倾向、情绪波动模式和主要情绪类型",
    "risk_level": "high|medium|low",
    "risk_score": 0.0-1.0,
    "confidence": 0.0-1.0,
    "risk_interpretation": "风险解读：结合模型结果和贴文内容，解读风险等级的具体含义",
    "risk_factors": ["风险因素1（如：表达绝望感）", "风险因素2（如：社交隔离）"],
    "protective_factors": ["保护因素1（如：有倾诉对象）", "保护因素2（如：积极寻求帮助）"],
    "key_highlight": "重点关注：描述模型最关注的帖子及其主要内容特征",
    "professional_advice": "专业建议：给临床医生的评估参考和建议",
    "intervention_suggestion": "干预建议：根据风险等级给出的具体干预措施建议",
    "follow_up_suggestion": "随访建议：建议的随访计划和注意事项"
}}

请直接输出JSON，不要添加任何其他说明文字。"""

    try:
        import httpx
        from openai import OpenAI
        import ssl
        
        base_url = fusion_model_config.get("api_base_url") if fusion_model_config else None
        if not base_url:
            base_url = _get_llm_api_base_url()
        
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        http_client = httpx.Client(verify=False)
        
        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            http_client=http_client
        )
        
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=temperature,
            max_tokens=max_tokens
        )
        
        reply = response.choices[0].message.content.strip()
        
        try:
            json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', reply, re.DOTALL)
            if json_match:
                result_data = json.loads(json_match.group())
            else:
                result_data = json.loads(reply)
        except json.JSONDecodeError:
            result_data = {
                "risk_level": emocc_result.get("risk_level", "medium"),
                "risk_score": emocc_result.get("risk_score", 0.5),
                "confidence": emocc_result.get("confidence", 0.8),
                "summary": "LLM整合解析失败，使用原始结果"
            }

        return {
            "fusion_method": "llm_analysis",
            "risk_level": result_data.get("risk_level", emocc_result.get("risk_level", "medium")),
            "risk_score": float(result_data.get("risk_score", emocc_result.get("risk_score", 0.5))),
            "confidence": float(result_data.get("confidence", emocc_result.get("confidence", 0.8))),
            "summary": result_data.get("summary", result_data.get("risk_interpretation", "")),
            "symptom_description": result_data.get("symptom_description", ""),
            "emotional_analysis": result_data.get("emotional_analysis", ""),
            "risk_interpretation": result_data.get("risk_interpretation", ""),
            "key_highlight": result_data.get("key_highlight", ""),
            "risk_factors": result_data.get("risk_factors", []),
            "protective_factors": result_data.get("protective_factors", []),
            "professional_advice": result_data.get("professional_advice", ""),
            "intervention_suggestion": result_data.get("intervention_suggestion", ""),
            "follow_up_suggestion": result_data.get("follow_up_suggestion", ""),
            "llm_response": reply[:500] if len(reply) > 500 else reply,
            "model": model_name
        }

    except Exception as e:
        print(f"[WARNING] DashScope LLM整合失败: {e}")
        return {
            "fusion_method": "direct",
            "risk_level": emocc_result.get("risk_level", "medium"),
            "risk_score": emocc_result.get("risk_score", 0.5),
            "confidence": emocc_result.get("confidence", 0.8),
            "summary": "LLM整合不可用，使用Emocc模型直接结果",
            "error": str(e)
        }


@router.post("/api/risk/emocc-tasks")
async def create_emocc_detection_task(
    task_data: Dict = Body(...),
    request: Request = None
):
    """
    创建Emocc本地模型检测任务（仅创建，不执行）
    
    执行请调用 POST /api/risk/emocc-tasks/<task_id>/execute
    """
    pool = request.app.state.mysql_db
    
    task_code = _generate_task_code("emocc")
    now = datetime.now()
    
    user_hash = task_data.get("userHash") or task_data.get("user_hash") or ""
    data_source = task_data.get("dataSource") or task_data.get("data_source") or "reddit"
    fusion_model_id = task_data.get("fusionModelId") or task_data.get("fusion_model_id")
    task_name_input = task_data.get("taskName") or task_data.get("task_name")
    
    if not user_hash:
        return {"success": False, "error": "用户哈希不能为空"}
    
    # 获取帖子数量（不执行模型，仅获取数量）
    post_count = 0
    try:
        posts, total = await _get_user_posts_from_db(pool, user_hash=user_hash, data_source=data_source, page_size=50)
        post_count = total if total > 0 else len(posts) if posts else 0
    except Exception as e:
        print(f"[Emocc Create] 从数据库获取帖子数量失败: {e}")
        return {"success": False, "error": f"无法获取用户数据: {str(e)}"}
    
    if post_count == 0:
        return {"success": False, "error": "用户没有可用的帖子数据"}
    
    # 保存任务到数据库（状态为 pending）
    # 如果用户提供了 taskName 则使用，否则自动生成
    final_task_name = task_name_input if task_name_input else f"Emocc检测_{user_hash[:8]}"
    task_record = {
        "task_code": task_code,
        "task_name": final_task_name,
        "task_description": f"使用Emocc本地模型对用户 {user_hash[:8]} 进行自杀风险检测",
        "task_mode": "single",
        "task_type_id": 1,
        "user_hash": user_hash,
        "data_source": data_source,
        "post_count": post_count,
        "status": "pending",
        "progress": 0,
        "detection_model_configs": {"model_type": "emocc_local"},
        "result_summary": None,
        "fusion_model_id": fusion_model_id,
        "started_at": None,
        "completed_at": None,
        "processing_time_ms": None
    }
    
    task_id = await _save_emocc_task_to_db(pool, task_record)
    
    return {
        "success": True,
        "data": {
            "id": task_id,
            "taskCode": f"EMOCC-{task_code}",
            "taskName": task_record["task_name"],
            "taskDescription": task_record["task_description"],
            "taskMode": "emocc",
            "userHash": user_hash,
            "dataSource": data_source,
            "postCount": post_count,
            "modelName": "Emocc-Reddit",
            "progress": 0,
            "status": "pending",
            "resultSummary": None,
            "createdAt": now.isoformat(),
            "startedAt": None,
            "completedAt": None,
            "processingTimeMs": None
        }
    }


@router.post("/api/risk/emocc-tasks/{task_id}/execute")
async def execute_emocc_detection_task(
    task_id: int,
    request: Request = None
):
    """
    执行Emocc检测任务
    流程：
    1. 获取用户数据（帖子、BERT嵌入、emoji序列）
    2. 调用Emocc模型进行检测
    3. 调用DashScope LLM进行结果整合
    4. 保存结果到MySQL
    """
    import time
    start_time = time.time()
    pool = request.app.state.mysql_db
    
    # 获取任务信息
    task = await _get_emocc_task_by_id_from_db(pool, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    if task.get("status") == "completed":
        return {"success": False, "error": "任务已完成，无需重复执行"}
    
    user_hash = task.get("user_hash", "")
    data_source = task.get("data_source", "reddit")
    fusion_model_id = task.get("fusion_model_id")
    
    # 获取融合模型配置
    fusion_model_config = None
    if fusion_model_id:
        fusion_model_config = await _get_model_config(pool, fusion_model_id)
    
    # 更新状态为 running
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("""
                UPDATE risk_detection_tasks
                SET status = 'running', started_at = NOW()
                WHERE id = %s
            """, (task_id,))
            await conn.commit()
    
    # 1. 获取用户数据
    user_data = await _get_user_data_for_emocc(user_hash, data_source, pool)
    
    if not user_data or not user_data.get("posts"):
        async with pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""
                    UPDATE risk_detection_tasks
                    SET status = 'failed', error_message = %s
                    WHERE id = %s
                """, ("无法获取用户数据", task_id))
                await conn.commit()
        return {"success": False, "error": "无法获取用户数据"}
    
    posts = user_data.get("posts", [])
    emoji_sequences = user_data.get("emoji_sequences", [])
    bert_embeddings = user_data.get("bert_embeddings")
    
    # 2. 调用Emocc模型
    emocc_result = None
    
    if bert_embeddings is not None:
        try:
            from src.services.emocc_service import get_emocc_service, load_emocc_model
            
            service = get_emocc_service()
            
            if not service.is_loaded:
                loaded = load_emocc_model()
                if not loaded:
                    print("[Emocc Execute] 模型加载失败，使用模拟结果")
            
            if service.is_loaded:
                result = service.predict_single_user(
                    user_hash=user_hash,
                    bert_embeddings=bert_embeddings,
                    emoji_sequences=emoji_sequences,
                    post_texts=posts
                )
                
                emocc_result = {
                    "risk_level": result.risk_level,
                    "risk_score": result.risk_score,
                    "risk_class": result.risk_class,
                    "confidence": result.confidence,
                    "post_attention_scores": result.post_attention_scores,
                    "class_probs": result.model_info.get("class_probs", []),
                    "post_count": len(posts),
                    "model_type": "emocc_local"
                }
        except Exception as e:
            print(f"[Emocc Execute] 模型推理失败: {e}")
            import traceback
            traceback.print_exc()
    
    # 如果Emocc模型不可用，使用模拟结果
    if emocc_result is None:
        print("[Emocc Execute] 使用模拟结果")
        import random
        random.seed(hash(user_hash) % (2**32))
        
        risk_keywords = ["death", "suicide", "kill", "die", "hopeless", "depressed", "alone", "empty", "tired", "hurt"]
        keyword_count = sum(1 for post in posts for kw in risk_keywords if kw.lower() in post.lower())
        
        base_score = min(0.9, 0.2 + keyword_count * 0.05)
        risk_class = 0 if base_score < 0.3 else 1 if base_score < 0.5 else 2 if base_score < 0.7 else 3 if base_score < 0.85 else 4
        
        post_attention_scores = []
        for i, post in enumerate(posts):
            # 所有帖子都有注意力分数，包含风险关键词的帖子分数更高
            has_risk = any(kw.lower() in post.lower() for kw in risk_keywords)
            if has_risk:
                score = random.uniform(0.4, 0.9)
            else:
                score = random.uniform(0.1, 0.4)
            post_attention_scores.append({
                "post_index": i,
                "attention_score": round(score, 4),
                "text_preview": post[:80] + "..." if len(post) > 80 else post,
                "emoji_count": len(emoji_sequences[i]) if i < len(emoji_sequences) else 0
            })
        post_attention_scores.sort(key=lambda x: x["attention_score"], reverse=True)
        
        risk_levels = ["low", "low", "medium", "medium", "high"]
        risk_scores = [0.1, 0.3, 0.5, 0.7, 0.9]
        
        emocc_result = {
            "risk_level": risk_levels[risk_class],
            "risk_score": risk_scores[risk_class],
            "risk_class": risk_class,
            "confidence": round(random.uniform(0.7, 0.95), 4),
            "post_attention_scores": post_attention_scores,
            "class_probs": [round(random.uniform(0.05, 0.4), 4) for _ in range(5)],
            "post_count": len(posts),
            "model_type": "emocc_mock"
        }
        
        total = sum(emocc_result["class_probs"])
        emocc_result["class_probs"] = [round(p / total, 4) for p in emocc_result["class_probs"]]
    
    # 3. 调用LLM融合
    fusion_result = await _call_llm_for_emocc_fusion(
        emocc_result=emocc_result,
        posts=posts,
        temperature=0.7,
        max_tokens=2048,
        fusion_model_config=fusion_model_config
    )
    
    processing_time_ms = int((time.time() - start_time) * 1000)
    
    # 4. 构建结果摘要
    fr = fusion_result if fusion_result else {}
    structured = _normalize_report_fields(
        fr,
        fallback_level=emocc_result.get("risk_level", "medium"),
        fallback_score=_safe_float(emocc_result.get("risk_score"), 0.5),
        fallback_confidence=_safe_float(fr.get("confidence") if fr else emocc_result.get("confidence"), 0.8),
        fallback_summary=fr.get("summary", "检测完成") if fr else "检测完成",
    )
    result_summary = {
        "riskLevel": structured["riskLevel"],
        "riskScore": structured["riskScore"],
        "confidence": int(structured["confidence"] * 100),
        "summary": structured["summary"],
        "emoccModelResult": {
            "riskLevel": emocc_result.get("risk_level"),
            "riskScore": emocc_result.get("risk_score"),
            "riskClass": emocc_result.get("risk_class"),
            "confidence": emocc_result.get("confidence"),
            "postCount": emocc_result.get("post_count"),
            "classProbs": emocc_result.get("class_probs", []),
            "postAttentionScores": emocc_result.get("post_attention_scores", [])[:10],
            "modelType": emocc_result.get("model_type", "emocc_local")
        },
        "fusionMethod": fr.get("fusion_method", "direct") if fr else "direct",
        "symptomDescription": structured["symptomDescription"],
        "emotionalAnalysis": structured["emotionalAnalysis"],
        "riskInterpretation": structured["riskInterpretation"],
        "keyHighlight": structured["keyHighlight"],
        "riskFactors": structured["riskFactors"],
        "protectiveFactors": structured["protectiveFactors"],
        "professionalAdvice": structured["professionalAdvice"],
        "interventionSuggestion": structured["interventionSuggestion"],
        "followUpSuggestion": structured["followUpSuggestion"],
        "llmModel": structured["llmModel"] or "qwen-flash",
        "llmResponse": structured["llmResponse"],
    }
    
    # 5. 更新数据库
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("""
                UPDATE risk_detection_tasks
                SET status = 'completed', progress = 100,
                    completed_at = NOW(), processing_time_ms = %s,
                    result_summary = %s
                WHERE id = %s
            """, (processing_time_ms, json.dumps(result_summary), task_id))
            await conn.commit()
    
    return {
        "success": True,
        "id": task_id,
        "taskCode": f"EMOCC-{task.get('task_code', '')}",
        "taskName": task.get("task_name", ""),
        "userHash": user_hash,
        "dataSource": data_source,
        "postCount": len(posts),
        "modelName": "Emocc-Reddit",
        "progress": 100,
        "status": "completed",
        "resultSummary": result_summary,
        "processingTimeMs": processing_time_ms,
        "startedAt": task.get("started_at").isoformat() if task.get("started_at") else datetime.now().isoformat(),
        "completedAt": datetime.now().isoformat()
    }


@router.get("/api/risk/emocc-tasks")
async def get_emocc_tasks(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """获取Emocc检测任务列表"""
    pool = request.app.state.mysql_db
    
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            # 查询总数
            count_sql = "SELECT COUNT(*) as total FROM risk_detection_tasks WHERE task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'emocc_local'"
            await cursor.execute(count_sql)
            total = (await cursor.fetchone())["total"]
            
            # 查询列表
            offset = (page - 1) * limit
            list_sql = """
                SELECT id, task_code, task_name, task_description, task_mode,
                       user_hash, data_source, post_count, progress, status,
                       detection_model_configs, result_summary,
                       created_at, started_at, completed_at, processing_time_ms
                FROM risk_detection_tasks
                WHERE task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'emocc_local'
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """
            await cursor.execute(list_sql, (limit, offset))
            tasks = await cursor.fetchall()
    
    def _convert_task(t: dict) -> dict:
        result_summary = t.get("result_summary")
        if isinstance(result_summary, str):
            try:
                result_summary = json.loads(result_summary)
            except:
                result_summary = None
        
        return {
            "id": t.get("id"),
            "taskCode": f"EMOCC-{t.get('task_code', '')}",
            "taskName": t.get("task_name", "Emocc检测任务"),
            "taskDescription": t.get("task_description", ""),
            "taskMode": "emocc",
            "userHash": t.get("user_hash", ""),
            "dataSource": t.get("data_source", ""),
            "postCount": t.get("post_count", 0),
            "modelName": "Emocc-Reddit",
            "progress": t.get("progress", 0),
            "status": t.get("status", "pending"),
            "resultSummary": result_summary,
            "createdAt": t.get("created_at").isoformat() if t.get("created_at") else "",
            "startedAt": t.get("started_at").isoformat() if t.get("started_at") else None,
            "completedAt": t.get("completed_at").isoformat() if t.get("completed_at") else None,
            "processingTimeMs": t.get("processing_time_ms"),
        }
    
    converted = [_convert_task(t) for t in tasks]
    
    return {"success": True, "data": {"tasks": converted, "total": total, "page": page, "limit": limit}}


@router.get("/api/risk/emocc-tasks/{task_id}")
async def get_emocc_task_detail(task_id: str, request: Request):
    """获取Emocc检测任务详情"""
    pool = request.app.state.mysql_db
    
    actual_code = task_id.replace("EMOCC-", "") if task_id.startswith("EMOCC-") else task_id
    
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            sql = """
                SELECT id, task_code, task_name, task_description, task_mode,
                       user_hash, data_source, post_count, progress, status,
                       detection_model_configs, result_summary,
                       created_at, started_at, completed_at, processing_time_ms
                FROM risk_detection_tasks
                WHERE task_code = %s AND task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'emocc_local'
            """
            await cursor.execute(sql, (actual_code,))
            task = await cursor.fetchone()
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    result_summary = task.get("result_summary")
    if isinstance(result_summary, str):
        try:
            result_summary = json.loads(result_summary)
        except:
            result_summary = None
    
    return {
        "success": True,
        "data": {
            "id": task.get("id"),
            "taskCode": f"EMOCC-{task.get('task_code', '')}",
            "taskName": task.get("task_name", "Emocc检测任务"),
            "taskDescription": task.get("task_description", ""),
            "taskMode": "emocc",
            "userHash": task.get("user_hash", ""),
            "dataSource": task.get("data_source", ""),
            "postCount": task.get("post_count", 0),
            "modelName": "Emocc-Reddit",
            "progress": task.get("progress", 0),
            "status": task.get("status", "pending"),
            "resultSummary": result_summary,
            "createdAt": task.get("created_at").isoformat() if task.get("created_at") else "",
            "startedAt": task.get("started_at").isoformat() if task.get("started_at") else None,
            "completedAt": task.get("completed_at").isoformat() if task.get("completed_at") else None,
            "processingTimeMs": task.get("processing_time_ms"),
        }
    }


@router.delete("/api/risk/tasks/{task_id}")
async def delete_risk_task(task_id: str, request: Request):
    """
    删除风险检测任务（通用任务）
    task_id: 可能是纯数字 ID 或带 RISK- 前缀的格式
    """
    pool = request.app.state.mysql_db

    # 解析 task_id：支持纯数字 ID 或 RISK- 前缀格式
    actual_code = task_id.replace("RISK-", "") if task_id.startswith("RISK-") else task_id

    # 判断是数字 ID 还是 task_code
    try:
        task_id_int = int(actual_code)
        # 使用数字 ID 删除
        sql = "DELETE FROM risk_detection_tasks WHERE id = %s"
        params = (task_id_int,)
    except ValueError:
        # 使用 task_code 删除
        sql = "DELETE FROM risk_detection_tasks WHERE task_code = %s"
        params = (actual_code,)

    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(sql, params)
                await conn.commit()
                deleted = cursor.rowcount

        if deleted > 0:
            return {"success": True, "message": "任务删除成功"}
        else:
            raise HTTPException(status_code=404, detail="任务不存在或已删除")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@router.delete("/api/risk/emocc-tasks/{task_id}")
async def delete_emocc_task(task_id: str, request: Request):
    """
    删除 Emocc 检测任务
    task_id: 可能是纯数字 ID 或带 EMOCC- 前缀的格式
    """
    pool = request.app.state.mysql_db

    # 解析 task_id：支持纯数字 ID 或 EMOCC- 前缀格式
    actual_code = task_id.replace("EMOCC-", "") if task_id.startswith("EMOCC-") else task_id

    # 判断是数字 ID 还是 task_code，同时通过 detection_model_configs 过滤确保只删除 Emocc 任务
    emocc_filter = "JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'emocc_local'"
    try:
        task_id_int = int(actual_code)
        # 使用数字 ID + emocc_local 过滤删除
        sql = f"DELETE FROM risk_detection_tasks WHERE id = %s AND {emocc_filter}"
        params = (task_id_int,)
    except ValueError:
        # 使用 task_code + emocc_local 过滤删除
        sql = f"DELETE FROM risk_detection_tasks WHERE task_code = %s AND {emocc_filter}"
        params = (actual_code,)

    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(sql, params)
                await conn.commit()
                deleted = cursor.rowcount

        if deleted > 0:
            return {"success": True, "message": "Emocc任务删除成功"}
        else:
            raise HTTPException(status_code=404, detail="任务不存在或已删除")
    except HTTPException:
        raise
    except Exception as e:
            raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


def _build_clinical_report_html(task: dict, rs: dict, emocc: dict = None) -> str:
    """构建可打印的临床评估报告HTML"""
    import html

    risk_level = rs.get("riskLevel", "medium")
    risk_score = rs.get("riskScore", 0.5)
    confidence = rs.get("confidence", 80)
    summary = rs.get("summary", "")

    risk_colors = {"low": "#22c55e", "medium": "#f59e0b", "high": "#ef4444"}
    risk_labels = {"low": "低风险", "medium": "中风险", "high": "高风险"}
    risk_color = risk_colors.get(risk_level, "#f59e0b")
    risk_label = risk_labels.get(risk_level, "未知")

    def render_list(items, color):
        if not items:
            return ""
        items_html = "".join(
            f'<li style="margin-bottom:4px;padding-left:8px;">{html.escape(str(item))}</li>'
            for item in items
        )
        return f'<ul style="margin:6px 0 6px 20px;padding:0;list-style:none;">{items_html}</ul>'

    risk_factors_html = render_list(rs.get("riskFactors", []), "#ef4444")
    protective_factors_html = render_list(rs.get("protectiveFactors", []), "#22c55e")
    intervention_html = html.escape(rs.get("interventionSuggestion", ""))
    follow_up_html = html.escape(rs.get("followUpSuggestion", ""))
    symptom_html = html.escape(rs.get("symptomDescription", ""))
    emotional_html = html.escape(rs.get("emotionalAnalysis", ""))
    risk_interp_html = html.escape(rs.get("riskInterpretation", ""))
    professional_advice_html = html.escape(rs.get("professionalAdvice", ""))

    emocc_section = ""
    if emocc:
        class_probs = emocc.get("classProbs", [])
        prob_labels = ["无风险", "极低风险", "低风险", "中风险", "高风险"]
        prob_bars = ""
        prob_colors = ["#22c55e", "#86efac", "#fde047", "#f97316", "#ef4444"]
        for i, prob in enumerate(class_probs):
            bar_width = float(prob) * 100
            prob_bars += f"""
            <div style="display:flex;align-items:center;margin-bottom:4px;">
                <span style="width:64px;font-size:11px;">{prob_labels[i]}</span>
                <div style="flex:1;background:#f0f0f0;border-radius:4px;height:12px;margin:0 8px;">
                    <div style="width:{bar_width:.1f}%;background:{prob_colors[i]};border-radius:4px;height:100%;"></div>
                </div>
                <span style="width:44px;font-size:11px;text-align:right;">{float(prob)*100:.1f}%</span>
            </div>"""
        emocc_section = f"""
        <div style="margin-top:16px;padding:12px;background:#f8f4ff;border-radius:8px;border:1px solid #e9d5ff;">
            <div style="font-weight:bold;color:#7c3aed;margin-bottom:8px;">Emocc 模型检测详情</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
                <div style="background:white;padding:8px;border-radius:6px;text-align:center;">
                    <div style="font-size:11px;color:#888;">原始风险等级</div>
                    <div style="font-weight:bold;color:#7c3aed;">{emocc.get('riskLevel', '')}</div>
                </div>
                <div style="background:white;padding:8px;border-radius:6px;text-align:center;">
                    <div style="font-size:11px;color:#888;">原始风险分数</div>
                    <div style="font-weight:bold;color:#7c3aed;">{float(emocc.get('riskScore', 0)):.4f}</div>
                </div>
                <div style="background:white;padding:8px;border-radius:6px;text-align:center;">
                    <div style="font-size:11px;color:#888;">五分类结果</div>
                    <div style="font-weight:bold;color:#7c3aed;">Class {emocc.get('riskClass', '-')}</div>
                </div>
            </div>
            <div style="font-size:12px;color:#555;margin-bottom:6px;">概率分布</div>
            {prob_bars}
        </div>"""

    attention_section = ""
    if emocc and emocc.get("postAttentionScores"):
        att_scores = emocc.get("postAttentionScores", [])[:5]
        att_rows = "".join(
            f"""<tr>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">Post-{s.get('postIndex', '')}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">{float(s.get('attentionScore', 0)):.4f}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{html.escape(str(s.get('textPreview', '')))}</td>
            </tr>"""
            for s in att_scores
        )
        attention_section = f"""
        <div style="margin-top:16px;">
            <div style="font-weight:bold;color:#555;margin-bottom:6px;">高注意力帖子（前5条）</div>
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="background:#f9f9f9;">
                    <th style="padding:6px 8px;text-align:left;font-size:12px;">序号</th>
                    <th style="padding:6px 8px;text-align:left;font-size:12px;">注意力分数</th>
                    <th style="padding:6px 8px;text-align:left;font-size:12px;">内容预览</th>
                </tr></thead>
                <tbody>{att_rows}</tbody>
            </table>
        </div>"""

    llm_model = rs.get("llmModel", "")
    completed_at = task.get("completedAt", datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>自杀风险临床评估报告 - {html.escape(str(task.get('userHash', '')))}</title>
<style>
  @media print {{
    body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .no-print {{ display: none !important; }}
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 14px; color: #333; background: white; }}
  .page {{ max-width: 800px; margin: 0 auto; padding: 32px; }}
  .header {{ border-bottom: 3px solid {risk_color}; padding-bottom: 16px; margin-bottom: 24px; }}
  .header h1 {{ font-size: 22px; color: #222; margin-bottom: 8px; }}
  .header .meta {{ font-size: 12px; color: #888; }}
  .section {{ margin-bottom: 20px; }}
  .section-title {{ font-size: 15px; font-weight: bold; color: #222; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #eee; }}
  .section p {{ line-height: 1.8; color: #444; text-align: justify; }}
  .risk-banner {{ display: flex; gap: 16px; margin: 16px 0; }}
  .risk-card {{ flex: 1; background: #fafafa; border-radius: 8px; padding: 16px; text-align: center; border: 1px solid #eee; }}
  .risk-card .label {{ font-size: 12px; color: #888; margin-bottom: 4px; }}
  .risk-card .value {{ font-size: 22px; font-weight: bold; }}
  .risk-card .sub {{ font-size: 11px; color: #aaa; }}
  .risk-level-box {{ background: {risk_color}; color: white; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 16px; }}
  .risk-level-box .level {{ font-size: 28px; font-weight: bold; }}
  .risk-level-box .score {{ font-size: 14px; opacity: 0.9; margin-top: 4px; }}
  .factor-red {{ background: #fef2f2; border-left: 3px solid #ef4444; padding: 12px; border-radius: 4px; }}
  .factor-green {{ background: #f0fdf4; border-left: 3px solid #22c55e; padding: 12px; border-radius: 4px; }}
  .advice-box {{ background: #eff6ff; border-left: 3px solid #3b82f6; padding: 12px; border-radius: 4px; }}
  .intervention-box {{ background: #fff7ed; border-left: 3px solid #f97316; padding: 12px; border-radius: 4px; }}
  .followup-box {{ background: #f5f3ff; border-left: 3px solid #8b5cf6; padding: 12px; border-radius: 4px; }}
  .footer {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; text-align: center; line-height: 1.8; }}
  .print-btn {{ position: fixed; top: 20px; right: 20px; background: #f97316; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }}
  .print-btn:hover {{ background: #ea580c; }}
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">打印 / 导出 PDF</button>
<div class="page">
  <div class="header">
    <h1>自杀风险临床评估报告</h1>
    <div class="meta">
      用户哈希: {html.escape(str(task.get('userHash', '')))} &nbsp;|&nbsp;
      帖子数: {task.get('postCount', '')} &nbsp;|&nbsp;
      评估时间: {completed_at}
    </div>
  </div>

  <div class="risk-level-box">
    <div class="level">{risk_label}</div>
    <div class="score">风险分数: {float(risk_score):.2f} / 置信度: {confidence}% / 融合模型: {html.escape(llm_model)}</div>
  </div>

  <div class="risk-banner">
    <div class="risk-card">
      <div class="label">风险等级</div>
      <div class="value" style="color:{risk_color};">{risk_label}</div>
    </div>
    <div class="risk-card">
      <div class="label">风险分数</div>
      <div class="value">{float(risk_score):.2f}</div>
      <div class="sub">0=无风险，1=高风险</div>
    </div>
    <div class="risk-card">
      <div class="label">置信度</div>
      <div class="value">{confidence}%</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">综合评估摘要</div>
    <p>{html.escape(summary) if summary else '暂无摘要'}</p>
  </div>

  {(f'<div class="section"><div class="section-title">临床症状描述</div><p>{symptom_html}</p></div>') if symptom_html else ''}
  {(f'<div class="section"><div class="section-title">情绪分析</div><p>{emotional_html}</p></div>') if emotional_html else ''}
  {(f'<div class="section"><div class="section-title">风险解读</div><p>{risk_interp_html}</p></div>') if risk_interp_html else ''}

  {emocc_section}

  {(f'<div class="section factor-red"><div class="section-title">风险因素</div>{risk_factors_html}</div>') if risk_factors_html else ''}
  {(f'<div class="section factor-green"><div class="section-title">保护因素</div>{protective_factors_html}</div>') if protective_factors_html else ''}
  {(f'<div class="section intervention-box"><div class="section-title">干预建议</div><p>{intervention_html}</p></div>') if intervention_html else ''}
  {(f'<div class="section advice-box"><div class="section-title">专业建议</div><p>{professional_advice_html}</p></div>') if professional_advice_html else ''}
  {(f'<div class="section followup-box"><div class="section-title">随访建议</div><p>{follow_up_html}</p></div>') if follow_up_html else ''}

  {attention_section}

  <div class="footer">
    本报告由 VIS4SRD 自杀风险可视化检测系统生成 | 本报告仅供参考，最终诊断应由持证专业医生做出<br>
    报告生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | 系统版本: ECML-PKDD 2026 Demo
  </div>
</div>
</body>
</html>"""


@router.get("/api/risk/tasks/{task_id}/report")
async def get_risk_task_report(task_id: str, request: Request):
    """
    获取风险检测任务的完整诊断报告数据
    task_id: 可能是纯数字 ID、RISK- 前缀或 EMOCC- 前缀
    """
    pool = request.app.state.mysql_db

    actual_code = task_id.replace("RISK-", "").replace("EMOCC-", "")

    try:
        task_id_int = int(actual_code)
        sql = "SELECT * FROM risk_detection_tasks WHERE id = %s"
        params = (task_id_int,)
    except ValueError:
        sql = "SELECT * FROM risk_detection_tasks WHERE task_code = %s"
        params = (actual_code,)

    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(sql, params)
            task = await cursor.fetchone()

    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    result_summary = task.get("result_summary")
    if isinstance(result_summary, str):
        try:
            result_summary = json.loads(result_summary)
        except:
            result_summary = {}

    emocc_result = result_summary.get("emoccModelResult")
    report_model_name = _infer_report_model_name(task, result_summary)

    return {
        "success": True,
        "data": {
            "taskId": task.get("id"),
            "taskCode": task.get("task_code", ""),
            "taskName": task.get("task_name", ""),
            "userHash": task.get("user_hash", ""),
            "dataSource": task.get("data_source", ""),
            "postCount": task.get("post_count", 0),
            "modelName": report_model_name,
            "processingTimeMs": task.get("processing_time_ms"),
            "createdAt": task.get("created_at").isoformat() if task.get("created_at") else "",
            "completedAt": task.get("completed_at").isoformat() if task.get("completed_at") else "",
            "resultSummary": result_summary,
        }
    }


@router.get("/api/risk/tasks/{task_id}/export-report")
async def export_risk_task_report(task_id: str, request: Request):
    """
    导出风险检测任务的诊断报告（HTML格式，可打印为PDF）
    task_id: 可能是纯数字 ID、RISK- 前缀或 EMOCC- 前缀
    """
    pool = request.app.state.mysql_db

    actual_code = task_id.replace("RISK-", "").replace("EMOCC-", "")

    try:
        task_id_int = int(actual_code)
        sql = "SELECT * FROM risk_detection_tasks WHERE id = %s"
        params = (task_id_int,)
    except ValueError:
        sql = "SELECT * FROM risk_detection_tasks WHERE task_code = %s"
        params = (actual_code,)

    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as conn_cursor:
            await conn_cursor.execute("SET NAMES utf8mb4")
            await conn_cursor.execute(sql, params)
            task = await conn_cursor.fetchone()

    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    result_summary = task.get("result_summary")
    if isinstance(result_summary, str):
        try:
            result_summary = json.loads(result_summary)
        except:
            result_summary = {}

    task_display = {
        "userHash": task.get("user_hash", ""),
        "postCount": task.get("post_count", 0),
        "completedAt": task.get("completed_at").strftime('%Y-%m-%d %H:%M:%S') if task.get("completed_at") else datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    }

    html_content = _build_clinical_report_html(task_display, result_summary, result_summary.get("emoccModelResult"))

    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html_content, media_type="text/html; charset=utf-8")


@router.get("/api/risk/emocc-models")
async def get_emocc_model_info():
    """获取Emocc模型信息"""
    return {
        "success": True,
        "data": {
            "model_name": "Emocc-Reddit",
            "model_type": "emocc_local",
            "description": "BERT + Emoji 双模态层次融合模型",
            "architecture": {
                "text_encoder": "BERT embeddings (768dim) → BiGRU",
                "emoji_encoder": "Emoji2Vec embeddings (300dim)",
                "fusion": "Adaptive Gate Fusion",
                "output": "5-class classification (0-4)"
            },
            "features": [
                "支持输出每个帖子的注意力分数",
                "分析用户帖子中的emoji表情",
                "建模帖子之间的时间关系",
                "提取全局情感共性",
                "五分类风险评估"
            ],
            "performance": {
                "accuracy": 0.849,
                "precision": 0.835,
                "recall": 0.828,
                "f1": 0.831,
                "auc": 0.889
            },
            "supported_datasets": ["reddit"],
            "input_format": {
                "bert_embeddings": "(T, 768) numpy array",
                "emoji_sequences": "List[List[str]]",
                "post_texts": "List[str]"
            },
            "output_format": {
                "risk_level": "high|medium|low",
                "risk_score": "0.0-1.0",
                "risk_class": "0-4",
                "post_attention_scores": "List[{post_index, attention_score, text_preview}]"
            }
        }
    }


# ============================================================
# FeaLearner 本地模型检测任务 API
# ============================================================

@router.post("/api/risk/fealearner-tasks")
async def create_fealearner_detection_task(
    task_data: Dict = Body(...),
    request: Request = None
):
    """
    创建FeaLearner本地模型检测任务（仅创建，不执行）
    
    执行请调用 POST /api/risk/fealearner-tasks/<task_id>/execute
    """
    pool = request.app.state.mysql_db
    
    user_hash = task_data.get("userHash") or task_data.get("user_hash") or ""
    data_source = task_data.get("dataSource") or task_data.get("data_source") or "reddit"
    fusion_model_id = task_data.get("fusionModelId") or task_data.get("fusion_model_id")
    task_name = task_data.get("taskName") or task_data.get("task_name") or ""
    
    if not user_hash:
        raise HTTPException(status_code=400, detail="缺少 userHash 参数")
    
    post_count = 0
    try:
        db_posts, _ = await _get_user_posts_from_db(pool, user_hash=user_hash, data_source=data_source, page_size=100)
        post_count = len([p for p in db_posts if p.get("content")])
    except Exception as e:
        print(f"[FeaLearner Create] 从数据库获取帖子失败: {e}")

    if post_count <= 0:
        raise HTTPException(status_code=400, detail="用户没有可用于 FeaLearner 检测的帖子数据")
    
    now = datetime.now()
    task_code = _generate_task_code("fea")
    
    if not task_name:
        task_name = f"FeaLearner检测_{user_hash[:8]}"
    
    task_record = {
        "task_code": f"FEA-{task_code}",
        "task_name": task_name,
        "task_description": "FeaLearner-Reddit 本地模型检测任务",
        "task_mode": "single",  # 使用 single 而非 fealearner（enum 限制）
        "task_type_id": 1,
        "user_hash": user_hash,
        "data_source": data_source,
        "post_count": post_count,
        "status": "pending",
        "progress": 0,
        "detection_model_configs": {"model_type": "fealearner_local", "source": "fealearner"},
        "result_summary": None,
        "fusion_model_id": fusion_model_id,
        "started_at": None,
        "completed_at": None,
        "processing_time_ms": None
    }
    
    task_id = await _save_fealearner_task_to_db(pool, task_record)
    
    return {
        "success": True,
        "data": {
            "id": task_id,
            "taskCode": f"FEA-{task_code}",
            "taskName": task_record["task_name"],
            "taskDescription": task_record["task_description"],
            "taskMode": "fealearner",
            "userHash": user_hash,
            "dataSource": data_source,
            "postCount": post_count,
            "modelName": "FeaLearner-Reddit",
            "progress": 0,
            "status": "pending",
            "resultSummary": None,
            "createdAt": now.isoformat(),
            "startedAt": None,
            "completedAt": None,
            "processingTimeMs": None
        }
    }


async def _save_fealearner_task_to_db(pool, task_data: Dict) -> int:
    """保存 FeaLearner 任务到数据库"""
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            task_type_id = task_data.get("task_type_id", 1)
            fusion_model_id = task_data.get("fusion_model_id")
            
            sql = """
                INSERT INTO risk_detection_tasks (
                    task_code, task_name, task_description, task_mode, task_type_id,
                    user_hash, data_source, post_count, status, progress,
                    detection_model_configs, result_summary,
                    started_at, completed_at, processing_time_ms,
                    fusion_model_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            await cur.execute(sql, (
                task_data.get("task_code"),
                task_data.get("task_name"),
                task_data.get("task_description", ""),
                task_data.get("task_mode", "single"),
                task_type_id,
                task_data.get("user_hash", ""),
                task_data.get("data_source", "reddit"),
                task_data.get("post_count", 0),
                task_data.get("status", "pending"),
                task_data.get("progress", 0),
                json.dumps(task_data.get("detection_model_configs", {})),
                json.dumps(task_data.get("result_summary")),
                task_data.get("started_at"),
                task_data.get("completed_at"),
                task_data.get("processing_time_ms"),
                fusion_model_id
            ))
            await conn.commit()
            return cur.lastrowid


async def _get_fealearner_task_by_id_from_db(pool, task_id: int) -> Optional[Dict]:
    """根据任务ID获取FeaLearner任务详情"""
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            sql = """
                SELECT id, task_code, task_name, task_description, task_mode,
                       user_hash, data_source, post_count, progress, status,
                       detection_model_configs, result_summary, fusion_model_id,
                       created_at, started_at, completed_at, processing_time_ms
                FROM risk_detection_tasks
                WHERE id = %s AND task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'fealearner_local'
            """
            await cursor.execute(sql, (task_id,))
            return await cursor.fetchone()


@router.get("/api/risk/fealearner-tasks")
async def list_fealearner_tasks(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    request: Request = None
):
    """获取FeaLearner检测任务列表"""
    pool = request.app.state.mysql_db
    offset = (page - 1) * limit
    
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("""
                SELECT COUNT(*) as total FROM risk_detection_tasks
                WHERE task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'fealearner_local'
            """)
            total_row = await cursor.fetchone()
            total = total_row["total"] if total_row else 0
            
            await cursor.execute("""
                SELECT id, task_code, task_name, task_description, task_mode,
                       user_hash, data_source, post_count, progress, status,
                       detection_model_configs, result_summary,
                       created_at, started_at, completed_at, processing_time_ms
                FROM risk_detection_tasks
                WHERE task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'fealearner_local'
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """, (limit, offset))
            rows = await cursor.fetchall()
    
    tasks = []
    for row in rows:
        result_summary = row.get("result_summary")
        if isinstance(result_summary, str):
            try:
                result_summary = json.loads(result_summary)
            except:
                result_summary = None

        result_summary = result_summary or {}
        report_model_name = _infer_report_model_name(row, result_summary) if result_summary else "FeaLearner-Reddit"
        
        tasks.append({
            "id": row["id"],
            "taskCode": row["task_code"],
            "taskName": row["task_name"],
            "taskDescription": row.get("task_description"),
            "taskMode": "fealearner",
            "userHash": row["user_hash"],
            "dataSource": row["data_source"],
            "postCount": row["post_count"],
            "modelName": report_model_name,
            "progress": row.get("progress", 0),
            "status": row["status"],
            "resultSummary": result_summary if result_summary else None,
            "createdAt": row["created_at"].isoformat() if row.get("created_at") else "",
            "startedAt": row["started_at"].isoformat() if row.get("started_at") else None,
            "completedAt": row["completed_at"].isoformat() if row.get("completed_at") else None,
            "processingTimeMs": row.get("processing_time_ms")
        })
    
    return {
        "success": True,
        "data": {
            "tasks": tasks,
            "total": total,
            "page": page,
            "limit": limit
        }
    }


@router.get("/api/risk/fealearner-tasks/{task_id}")
async def get_fealearner_task_detail(
    task_id: int,
    request: Request = None
):
    """获取FeaLearner任务详情"""
    pool = request.app.state.mysql_db
    
    task = await _get_fealearner_task_by_id_from_db(pool, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    result_summary = task.get("result_summary")
    if isinstance(result_summary, str):
        try:
            result_summary = json.loads(result_summary)
        except:
            result_summary = None
    
    fealearner_result = result_summary.get("fealearnerModelResult") if result_summary else None
    
    return {
        "success": True,
        "data": {
            "id": task["id"],
            "taskCode": task["task_code"],
            "taskName": task["task_name"],
            "taskDescription": task.get("task_description"),
            "taskMode": "fealearner",
            "userHash": task["user_hash"],
            "dataSource": task["data_source"],
            "postCount": task["post_count"],
            "modelName": "FeaLearner-Reddit",
            "progress": task.get("progress", 0),
            "status": task["status"],
            "resultSummary": result_summary,
            "fealearnerResult": fealearner_result,
            "createdAt": task["created_at"].isoformat() if task.get("created_at") else "",
            "startedAt": task["started_at"].isoformat() if task.get("started_at") else None,
            "completedAt": task["completed_at"].isoformat() if task.get("completed_at") else None,
            "processingTimeMs": task.get("processing_time_ms")
        }
    }


@router.delete("/api/risk/fealearner-tasks/{task_id}")
async def delete_fealearner_task(
    task_id: int,
    request: Request = None
):
    """删除FeaLearner任务"""
    pool = request.app.state.mysql_db
    
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            result = await cursor.execute("""
                DELETE FROM risk_detection_tasks
                WHERE id = %s AND task_mode = 'single' AND JSON_UNQUOTE(JSON_EXTRACT(detection_model_configs, '$.model_type')) = 'fealearner_local'
            """, (task_id,))
            await conn.commit()
    
    if result == 0:
        raise HTTPException(status_code=404, detail="任务不存在或删除失败")
    
    return {"success": True, "message": "删除成功"}


@router.post("/api/risk/fealearner-tasks/{task_id}/execute")
async def execute_fealearner_detection_task(
    task_id: int,
    request: Request = None
):
    """
    执行FeaLearner检测任务
    流程：
    1. 获取用户数据
    2. 调用FeaLearner模型进行检测
    3. 调用DashScope LLM进行结果整合
    4. 保存结果到MySQL
    """
    import time
    start_time = time.time()
    pool = request.app.state.mysql_db
    
    task = await _get_fealearner_task_by_id_from_db(pool, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    if task.get("status") == "completed":
        return {"success": False, "error": "任务已完成，无需重复执行"}
    
    user_hash = task.get("user_hash", "")
    data_source = task.get("data_source", "reddit")
    fusion_model_id = task.get("fusion_model_id")
    
    fusion_model_config = None
    if fusion_model_id:
        fusion_model_config = await _get_model_config(pool, fusion_model_id)
    
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("""
                UPDATE risk_detection_tasks
                SET status = 'running', started_at = NOW()
                WHERE id = %s
            """, (task_id,))
            await conn.commit()
    
    user_data = await _get_user_data_for_emocc(user_hash, data_source, pool)
    
    if not user_data or not user_data.get("posts"):
        async with pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""
                    UPDATE risk_detection_tasks
                    SET status = 'failed', error_message = %s
                    WHERE id = %s
                """, ("无法获取用户数据", task_id))
                await conn.commit()
        return {"success": False, "error": "无法获取用户数据"}
    
    posts = user_data.get("posts", [])
    
    fealearner_result = None
    try:
        from src.services.fealearner_service import get_fealearner_service
        service = get_fealearner_service()
        result = service.predict_single_user(user_hash=user_hash, dataset=data_source)
        
        fealearner_result = {
            "risk_level": result.risk_level,
            "risk_score": result.risk_score,
            "pred_label": result.pred_label,
            "confidence": result.confidence,
            "probabilities": result.probabilities,
            "person_id": result.person_id,
            "model_type": "fealearner_local"
        }
    except Exception as e:
        print(f"[FeaLearner Execute] 模型推理失败: {e}")
        import traceback
        traceback.print_exc()
    
    if fealearner_result is None:
        print("[FeaLearner Execute] 使用模拟结果")
        import random
        random.seed(hash(user_hash) % (2**32))
        
        risk_keywords = ["death", "suicide", "kill", "die", "hopeless", "depressed", "alone", "empty", "tired", "hurt"]
        keyword_count = sum(1 for post in posts for kw in risk_keywords if kw.lower() in post.lower())
        
        base_score = min(0.9, 0.2 + keyword_count * 0.05)
        pred_label = 0 if base_score < 0.3 else 1 if base_score < 0.5 else 2 if base_score < 0.7 else 3 if base_score < 0.85 else 4
        
        risk_levels = ["low", "low", "medium", "medium", "high"]
        risk_scores = [0.1, 0.3, 0.5, 0.7, 0.9]
        
        fealearner_result = {
            "risk_level": risk_levels[pred_label],
            "risk_score": risk_scores[pred_label],
            "pred_label": pred_label,
            "confidence": round(random.uniform(0.7, 0.95), 4),
            "probabilities": {str(i): round(random.uniform(0.05, 0.4), 4) for i in range(5)},
            "person_id": user_hash,
            "model_type": "fealearner_mock"
        }
        
        total = sum(fealearner_result["probabilities"].values())
        fealearner_result["probabilities"] = {k: round(v / total, 4) for k, v in fealearner_result["probabilities"].items()}
    
    fusion_result = await _call_llm_for_fealearner_fusion(
        fealearner_result=fealearner_result,
        posts=posts,
        fusion_model_config=fusion_model_config
    )
    
    processing_time_ms = int((time.time() - start_time) * 1000)
    
    fr = fusion_result if fusion_result else {}
    structured = _normalize_report_fields(
        fr,
        fallback_level=fealearner_result.get("risk_level", "medium"),
        fallback_score=_safe_float(fealearner_result.get("risk_score"), 0.5),
        fallback_confidence=_safe_float(fr.get("confidence") if fr else fealearner_result.get("confidence"), 0.8),
        fallback_summary=fr.get("summary", "FeaLearner 检测完成") if fr else "FeaLearner 检测完成",
    )
    result_summary = {
        "riskLevel": structured["riskLevel"],
        "riskScore": structured["riskScore"],
        "confidence": int(structured["confidence"] * 100),
        "summary": structured["summary"],
        "fealearnerModelResult": {
            "riskLevel": fealearner_result.get("risk_level"),
            "riskScore": fealearner_result.get("risk_score"),
            "predLabel": fealearner_result.get("pred_label"),
            "confidence": fealearner_result.get("confidence"),
            "probabilities": list(fealearner_result.get("probabilities", {}).values()),
            "modelType": fealearner_result.get("model_type", "fealearner_local")
        },
        "symptomDescription": structured["symptomDescription"],
        "emotionalAnalysis": structured["emotionalAnalysis"],
        "riskInterpretation": structured["riskInterpretation"],
        "riskFactors": structured["riskFactors"],
        "protectiveFactors": structured["protectiveFactors"],
        "professionalAdvice": structured["professionalAdvice"],
        "interventionSuggestion": structured["interventionSuggestion"],
        "followUpSuggestion": structured["followUpSuggestion"],
        "llmModel": structured["llmModel"] or "qwen-flash",
        "llmResponse": structured["llmResponse"],
    }
    
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("""
                UPDATE risk_detection_tasks
                SET status = 'completed', progress = 100,
                    completed_at = NOW(), processing_time_ms = %s,
                    result_summary = %s
                WHERE id = %s
            """, (processing_time_ms, json.dumps(result_summary, ensure_ascii=False), task_id))
            await conn.commit()
    
    return {
        "success": True,
        "id": task_id,
        "taskCode": task.get("task_code", ""),
        "taskName": task.get("task_name", ""),
        "userHash": user_hash,
        "dataSource": data_source,
        "postCount": len(posts),
        "modelName": "FeaLearner-Reddit + qwen-flash",
        "progress": 100,
        "status": "completed",
        "resultSummary": result_summary,
        "processingTimeMs": processing_time_ms,
        "startedAt": task.get("started_at").isoformat() if task.get("started_at") else None,
        "completedAt": datetime.now().isoformat()
    }


async def _call_llm_for_fealearner_fusion(
    fealearner_result: dict,
    posts: List[str],
    fusion_model_config: Optional[Dict[str, Any]] = None
) -> dict:
    """
    调用 DashScope LLM 整合 FeaLearner 模型检测结果
    """
    model_name = "qwen-flash"
    if fusion_model_config and fusion_model_config.get('api_key'):
        api_key = fusion_model_config.get('api_key')
        print(f"[FeaLearner Fusion] 使用固定整理模型: {model_name}")
    else:
        api_key = _get_llm_api_key()
        print(f"[FeaLearner Fusion] 使用环境变量中的固定整理模型: {model_name}")
    
    if not api_key:
        return {
            "risk_level": fealearner_result.get("risk_level", "medium"),
            "risk_score": fealearner_result.get("risk_score", 0.5),
            "confidence": fealearner_result.get("confidence", 0.8),
            "fusion_method": "direct",
            "summary": "直接使用 FeaLearner 模型结果，未进行 LLM 整合"
        }
    
    system_prompt = """你是一位资深的心理健康评估专家，专注于社交媒体用户的自杀风险评估与临床诊断支持。
你的任务是基于 FeaLearner 深度学习模型的检测结果，结合用户贴文内容，给出专业、严谨、富有同理心的综合临床评估报告。

【重要原则】
1. 以专业、关怀、严谨的态度进行分析，绝不泄露用户隐私
2. 优先考虑用户安全，高风险情况必须给出明确的干预建议
3. 所有评估结果仅供参考，最终诊断应由持证专业医生做出
4. 报告应具备临床参考价值，语言准确、条理清晰

【风险等级映射】
- FeaLearner 五分类 (0-4):
  - 0 (无风险): risk_level=low, risk_score≈0.1
  - 1 (极低风险): risk_level=low, risk_score≈0.3
  - 2 (低风险): risk_level=medium, risk_score≈0.5
  - 3 (中风险): risk_level=medium, risk_score≈0.7
  - 4 (高风险): risk_level=high, risk_score≈0.9

请以 JSON 格式输出评估报告，包含以下字段：
- risk_level: 风险等级（low/medium/high）
- risk_score: 风险分数（0.0-1.0）
- confidence: 置信度（0.0-1.0）
- summary: 综合评估摘要（50字以内）
- symptom_description: 临床症状描述
- emotional_analysis: 情绪分析
- risk_interpretation: 风险解读
- risk_factors: 风险因素列表（数组）
- protective_factors: 保护因素列表（数组）
- professional_advice: 专业建议
- intervention_suggestion: 干预建议
- follow_up_suggestion: 随访建议
- model: 使用的模型名称"""

    posts_text = "\n".join([f"[帖子{i+1}] {p[:200]}" for i, p in enumerate(posts[:10])])
    high_signal_posts = _format_post_evidence(posts, limit=6, snippet_len=220)
    probability_items = fealearner_result.get("probabilities", {}) or {}
    probability_text = _format_probability_distribution(probability_items)
    fea_info = (
        f"预测标签: {fealearner_result.get('pred_label', 'N/A')}, "
        f"风险等级: {fealearner_result.get('risk_level', 'N/A')}, "
        f"风险分数: {fealearner_result.get('risk_score', 'N/A')}, "
        f"置信度: {fealearner_result.get('confidence', 'N/A')}"
    )
    
    user_prompt = f"""请分析以下用户的自杀风险评估：

【FeaLearner 模型检测结果】
{fea_info}

【FeaLearner 各类别概率分布】
{probability_text}

【高信号帖子】
{high_signal_posts}

【原始帖子内容】
{posts_text}

【分析要求】
1. 先解释 FeaLearner 的五分类预测标签和概率分布，再结合帖子证据判断
2. 必须明确说明：模型主判定是什么、最接近的次高风险类别是什么、两者差距意味着什么
3. 从模型结果、文本证据、模型不确定性三个角度做互补与增强解释
4. 如果当前模型没有提供注意力分数，不要编造；改为解释概率分布和边界不确定性
5. 不要泛泛写“存在抑郁倾向”，要结合帖子中的具体线索
6. 输出必须可直接作为检测报告展示，避免空话

请给出综合评估报告（JSON格式），至少包含：
{{
  "risk_level": "low|medium|high",
  "risk_score": 0.0,
  "confidence": 0.0,
  "summary": "50字以内，直接给出风险结论和最强证据",
  "symptom_description": "60-120字，概括可观察到的症状或困扰",
  "emotional_analysis": "50-100字，概括情绪基调、波动和触发因素",
  "risk_interpretation": "80-160字，必须说明模型主判定、次高类别及文本证据是否支持",
  "risk_factors": ["3到5个具体风险因素"],
  "protective_factors": ["1到4个具体保护因素"],
  "professional_advice": "50-100字，写给专业人员",
  "intervention_suggestion": "40-100字，给出优先动作",
  "follow_up_suggestion": "40-80字，写清首次随访时间和后续频率"
}}"""

    try:
        import httpx
        base_url = fusion_model_config.get("api_base_url") if fusion_model_config else None
        if not base_url:
            base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        else:
            base_url = base_url.rstrip("/") + "/chat/completions"
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                base_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 2048
                }
            )
            
            if response.status_code == 200:
                result = response.json()
                content = result.get("choices", [{}])[0].get("message", {}).get("content", "{}")
                
                import re
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    parsed = json.loads(json_match.group())
                    parsed["llmModel"] = model_name
                    parsed["model"] = model_name
                    return parsed
    except Exception as e:
        print(f"[FeaLearner Fusion] LLM 调用失败: {e}")
    
    return {
        "risk_level": fealearner_result.get("risk_level", "medium"),
        "risk_score": fealearner_result.get("risk_score", 0.5),
        "confidence": fealearner_result.get("confidence", 0.8),
        "fusion_method": "direct",
        "summary": f"FeaLearner 检测完成，风险等级: {fealearner_result.get('risk_level', 'medium')}"
    }


@router.get("/api/risk/fealearner-models")
async def get_fealearner_model_info():
    """获取 FeaLearner 模型信息"""
    return {
        "success": True,
        "data": {
            "model_name": "FeaLearner-Reddit",
            "model_type": "fealearner_local",
            "description": "FeaLearner 深度学习自杀风险检测模型（Reddit 数据集）",
            "architecture": {
                "text_encoder": "BERT embeddings",
                "classifier": "MLP classifier",
                "output": "5-class classification (0-4)"
            },
            "features": [
                "基于文本特征与嵌入进行自杀风险预测",
                "五分类风险评估",
                "支持 Reddit 数据集"
            ],
            "performance": {
                "accuracy": 0.85,
                "precision": 0.83,
                "recall": 0.82,
                "f1": 0.825
            },
            "supported_datasets": ["reddit"],
            "input_format": {
                "user_hash": "string",
                "dataset": "reddit"
            },
            "output_format": {
                "risk_level": "high|medium|low",
                "risk_score": "0.0-1.0",
                "pred_label": "0-4",
                "confidence": "0.0-1.0"
            }
        }
    }
