# 模型中心服务：从 models 和 prompt_templates 表获取数据，支持 Ollama 本地 LLM 调用
from typing import List, Dict, Any, Optional
import json
import aiomysql

# 导入 Ollama 客户端（使用绝对导入避免相对导入问题）
from src.core.llm_client import create_llm_client


class ModelService:
    """模型中心服务，依赖 MySQL 连接池。"""

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool

    async def get_models(
        self,
        category: Optional[str] = None,
        model_type: Optional[str] = None,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """获取模型列表"""
        conditions = []
        params = []

        if category:
            conditions.append("model_category = %s")
            params.append(category)
        if model_type:
            conditions.append("model_type = %s")
            params.append(model_type)
        if status:
            conditions.append("status = %s")
            params.append(status)

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                sql = f"""
                    SELECT id, model_name, model_code, model_category, model_type,
                           provider, api_key, api_base_url, model_file_path,
                           supported_datasets, config_template, description,
                           performance_metrics, is_available, is_builtin, status,
                           ollama_model_name, ollama_base_url,
                           created_at, updated_at
                    FROM models
                    WHERE {where_clause}
                    ORDER BY id DESC
                """
                await cursor.execute(sql, params)
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            model = dict(row)
            # 解析 JSON 字段
            if model.get("performance_metrics") and isinstance(model["performance_metrics"], str):
                try:
                    model["performance_metrics"] = json.loads(model["performance_metrics"])
                except:
                    model["performance_metrics"] = None
            result.append(model)

        return result

    async def get_model_by_id(self, model_id: int) -> Optional[Dict[str, Any]]:
        """根据 ID 获取模型详情"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT * FROM models WHERE id = %s""",
                    (model_id,)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        model = dict(row)
        if model.get("performance_metrics") and isinstance(model["performance_metrics"], str):
            try:
                model["performance_metrics"] = json.loads(model["performance_metrics"])
            except:
                model["performance_metrics"] = None

        return model

    async def get_templates(
        self,
        task_type: Optional[str] = None,
        model_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """获取提示词模板列表"""
        conditions = ["is_active = TRUE"]
        params = []

        if task_type:
            conditions.append("task_type = %s")
            params.append(task_type)
        if model_id:
            conditions.append("model_id = %s")
            params.append(model_id)

        where_clause = " AND ".join(conditions)

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                sql = f"""
                    SELECT id, name, task_type, description, prompt_content,
                           variables, model_id, created_at
                    FROM prompt_templates
                    WHERE {where_clause}
                    ORDER BY usage_count DESC, id
                """
                await cursor.execute(sql, params)
                rows = await cursor.fetchall()

        result = []
        for row in rows:
            template = dict(row)
            if template.get("variables") and isinstance(template["variables"], str):
                try:
                    template["variables"] = json.loads(template["variables"])
                except:
                    template["variables"] = None
            result.append(template)

        return result

    async def get_template_by_id(self, template_id: int) -> Optional[Dict[str, Any]]:
        """根据 ID 获取模板详情"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT * FROM prompt_templates WHERE id = %s""",
                    (template_id,)
                )
                row = await cursor.fetchone()

        if not row:
            return None

        template = dict(row)
        if template.get("variables") and isinstance(template["variables"], str):
            try:
                template["variables"] = json.loads(template["variables"])
            except:
                template["variables"] = None

        return template

    async def update_model_usage(self, model_id: int, processing_time_ms: int) -> bool:
        """更新模型使用统计"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """UPDATE models
                       SET usage_count = usage_count + 1,
                           last_used_at = NOW() = (
                               (avg_processing_time_ms * usage_count + %s) / (usage_count + 1)
                           )
                       WHERE id = %s""",
                    (processing_time_ms, model_id)
                )
                await conn.commit()
                return cursor.rowcount > 0

    async def update_template_usage(self, template_id: int) -> bool:
        """更新模板使用统计"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """UPDATE prompt_templates
                       SET usage_count = usage_count + 1
                       WHERE id = %s""",
                    (template_id,)
                )
                await conn.commit()
                return cursor.rowcount > 0

    # ========================
    # 模板 CRUD
    # ========================

    async def create_template(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """创建新提示词模板，返回创建后的模板（含 ID）"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                import json
                columns = ['name', 'task_type', 'prompt_content', 'is_active']
                placeholders = ['%s', '%s', '%s', '%s']
                values = [data['name'], data['task_type'], data['prompt_content'], data.get('is_active', True)]
                if data.get('description'):
                    columns.append('description')
                    placeholders.append('%s')
                    values.append(data['description'])
                if data.get('model_id'):
                    columns.append('model_id')
                    placeholders.append('%s')
                    values.append(data['model_id'])

                sql = f"INSERT INTO prompt_templates ({', '.join(columns)}) VALUES ({', '.join(placeholders)})"
                await cursor.execute(sql, values)
                await conn.commit()
                template_id = cursor.lastrowid

        return await self.get_template_by_id(template_id)

    async def update_template(self, template_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新模板，返回更新后的模板"""
        updates = []
        values = []
        for field, db_field in [
            ('name', 'name'), ('taskType', 'task_type'),
            ('promptContent', 'prompt_content'), ('description', 'description'),
            ('modelId', 'model_id'), ('isActive', 'is_active'),
        ]:
            if field in data:
                val = data[field]
                if field == 'isActive':
                    val = bool(val)
                updates.append(f"{db_field} = %s")
                values.append(val)
        if not updates:
            return await self.get_template_by_id(template_id)
        values.append(template_id)
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    f"UPDATE prompt_templates SET {', '.join(updates)} WHERE id = %s",
                    values
                )
                await conn.commit()
                if cursor.rowcount == 0:
                    return None
        return await self.get_template_by_id(template_id)

    async def delete_template(self, template_id: int) -> bool:
        """删除模板（硬删除）"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    "DELETE FROM prompt_templates WHERE id = %s",
                    (template_id,)
                )
                await conn.commit()
                return cursor.rowcount > 0

    # ========================
    # Ollama 相关功能
    # ========================

    async def get_ollama_models(self) -> List[Dict[str, Any]]:
        """获取所有 Ollama 模型（model_type='ollama'）"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                sql = """
                    SELECT id, model_name, model_code, ollama_model_name, ollama_base_url,
                           description, status, usage_count
                    FROM models
                    WHERE model_type = 'ollama' AND status = 'active'
                    ORDER BY id DESC
                """
                await cursor.execute(sql)
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_model_for_inference(self, model_id: int) -> Optional[Dict[str, Any]]:
        """获取用于推理的模型配置"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """SELECT id, model_name, model_code, model_type, model_category,
                              ollama_model_name, ollama_base_url, api_key, api_base_url,
                              provider, temperature, status
                       FROM models WHERE id = %s AND status = 'active'""",
                    (model_id,)
                )
                row = await cursor.fetchone()
        return dict(row) if row else None

    def call_ollama_model(self, model_config: Dict[str, Any], prompt: str,
                          system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用 Ollama 模型进行推理（同步方法）

        Args:
            model_config: 模型配置（从数据库获取）
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        # 获取 Ollama 模型名称和地址
        model_name = model_config.get('ollama_model_name') or model_config.get('model_name')
        base_url = model_config.get('ollama_base_url') or 'http://localhost:11434'
        temperature = model_config.get('temperature', 0.0)

        # 创建 Ollama 客户端
        client = create_llm_client(
            model_type='ollama',
            model_id=model_name,
            base_url=base_url,
            temperature=temperature
        )

        if client is None:
            return {
                'success': False,
                'error': f'无法创建 Ollama 客户端，模型名称: {model_name}',
                'model': model_name
            }

        # 调用模型
        result = client.call(prompt, system_prompt)

        # 更新使用统计
        if result.get('success'):
            # 注意：异步更新需要在外部处理，这里只记录
            pass

        return result

    async def list_ollama_available_models(self, base_url: str = 'http://localhost:11434') -> Dict[str, Any]:
        """
        获取 Ollama 服务上已安装的模型列表

        Args:
            base_url: Ollama 服务地址

        Returns:
            包含可用模型列表的字典
        """
        client = create_llm_client(
            model_type='ollama',
            model_id='dummy',  # 只是用来调用 API
            base_url=base_url
        )

        if client is None:
            return {
                'success': False,
                'error': '无法创建 Ollama 客户端',
                'models': []
            }

        return client.list_models()

    async def check_ollama_health(self, base_url: str = 'http://localhost:11434') -> Dict[str, Any]:
        """
        检查 Ollama 服务健康状态

        Args:
            base_url: Ollama 服务地址

        Returns:
            健康状态字典
        """
        client = create_llm_client(
            model_type='ollama',
            model_id='dummy',
            base_url=base_url
        )

        if client is None:
            return {
                'success': False,
                'available': False,
                'error': '无法创建 Ollama 客户端',
                'models': []
            }

        health_ok = client.check_health()
        models = []

        if health_ok:
            list_result = client.list_models()
            if list_result.get('success'):
                models = list_result.get('models', [])

        return {
            'success': health_ok,
            'available': health_ok,
            'base_url': base_url,
            'models': models
        }

    # ========================
    # API 模型调用功能
    # ========================

    async def get_api_models(self) -> List[Dict[str, Any]]:
        """获取所有 API 模型（model_type='api'）"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                sql = """
                    SELECT id, model_name, model_code, provider, api_base_url,
                           description, status, usage_count
                    FROM models
                    WHERE model_type = 'api' AND status = 'active'
                    ORDER BY id DESC
                """
                await cursor.execute(sql)
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    def call_api_model(self, model_config: Dict[str, Any], prompt: str,
                       system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用 API 模型进行推理（同步方法）

        Args:
            model_config: 模型配置（从数据库获取）
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        # 获取 API 模型配置
        # 优先使用 model_code（API标识符），其次使用 model_name（显示名称）
        model_name = model_config.get('model_code') or model_config.get('model_name')
        provider = model_config.get('provider', '')
        api_base_url = model_config.get('api_base_url')
        api_key = model_config.get('api_key', '')
        temperature = model_config.get('temperature', 0.0)

        # 创建 API 客户端
        client = create_llm_client(
            model_type='api',
            model_id=model_name,
            api_key=api_key,
            base_url=api_base_url,
            temperature=temperature,
            api_provider=provider
        )

        if client is None:
            return {
                'success': False,
                'error': f'无法创建 API 模型客户端，提供商: {provider}',
                'model': model_name
            }

        # 调用模型
        result = client.call(prompt, system_prompt)
        return result

    async def list_providers(self) -> List[Dict[str, Any]]:
        """获取支持的模型提供商列表"""
        from ..core.llm_client import get_supported_providers

        providers = get_supported_providers()
        result = []

        for key, info in providers.items():
            result.append({
                'key': key,
                'name': info.get('name', ''),
                'nameZh': info.get('name_zh', ''),
                'baseUrl': info.get('base_url', ''),
                'models': info.get('models', []),
                'description': info.get('description', '')
            })

        return result

    # ========================
    # 预置数据初始化（启动时调用）
    # ========================

    @staticmethod
    async def init_builtin_data(mysql_pool):
        """初始化预置模型和指令模板数据（幂等操作，已存在则跳过）"""

        # Emocc 预置模型 - 仅保留 Emocc-Reddit
        emoji_models = [
            {
                'model_name': 'Emocc-Reddit', 'model_code': 'emocc-reddit',
                'model_category': 'detection', 'model_type': 'emocc_local',
                'detection_type': 'emocc',
                'model_file_path': 'Emocc/Emocc_model/checkpoints/emocc_model.pth',
                'embedding_file_path': 'datasets/reddit/reddit_500_bert_embeddings.pkl',
                'emoji_csv_path': 'datasets/reddit/reddit_500_emoji_batch.csv',
                'description': '基于 BERT + Emoji 双模态层次融合的自杀风险检测模型。支持输出每个帖子的注意力分数，五分类任务（无风险/极低风险/低风险/中风险/高风险）。',
                'version': 'v1.0', 'is_available': True, 'is_default': True, 'is_builtin': True,
                'status': 'active',
                'performance_metrics': '{"accuracy": 0.849, "precision": 0.835, "recall": 0.828, "f1": 0.831, "auc": 0.889}',
                'supported_datasets': '["reddit"]', 'provider': 'VIS4SRD',
            },
        ]

        # API 模型模板
        api_models = [
            # ========== 阿里云百炼通义千问系列 ==========
            {
                'model_name': '通义千问-qwen-turbo', 'model_code': 'qwen-turbo',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'dashscope',
                'api_base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                'config_template': 'dashscope',
                'description': '阿里云通义千问 Turbo 模型，适合快速自杀风险对话评估和综合分析报告生成。支持中文对话、风险解释和干预建议。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': '通义千问-qwen-plus', 'model_code': 'qwen-plus',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'dashscope',
                'api_base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                'config_template': 'dashscope',
                'description': '阿里云通义千问 Plus 模型，适合复杂心理评估对话。具备更强的推理能力和风险判断准确性。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': '通义千问-qwen3.6-plus', 'model_code': 'qwen3.6-plus',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'dashscope',
                'api_base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                'config_template': 'dashscope',
                'description': '通义千问 Qwen3.6-Plus 模型，超强推理能力。适合复杂自杀风险案例深度分析和综合评估报告生成。具备更强的逻辑推理和多步骤分析能力。',
                'version': 'v3.6', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': '通义千问-qwen3.5-397b', 'model_code': 'qwen3.5-397b-a17b',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'dashscope',
                'api_base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                'config_template': 'dashscope',
                'description': '通义千问 Qwen3.5-397B-A17B 超大参数模型，专业级推理能力。适合高风险案例的深度心理分析和复杂风险评估。',
                'version': 'v3.5', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            # ========== 智谱 GLM 系列 ==========
            {
                'model_name': '智谱GLM-4-Plus', 'model_code': 'glm-4-plus',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'zhipu',
                'api_base_url': 'https://open.bigmodel.cn/api/paas/v4',
                'config_template': 'zhipu',
                'description': '智谱 GLM-4 Plus 模型，国产大模型中的领先者。适合中文心理对话和风险评估。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': '智谱GLM-4-Flash', 'model_code': 'glm-4-flash',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'zhipu',
                'api_base_url': 'https://open.bigmodel.cn/api/paas/v4',
                'config_template': 'zhipu',
                'description': '智谱 GLM-4 Flash 模型，快速响应，适合实时风险筛查和初步对话。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': '智谱GLM-5-Plus', 'model_code': 'glm-5-plus',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'zhipu',
                'api_base_url': 'https://open.bigmodel.cn/api/paas/v4',
                'config_template': 'zhipu',
                'description': '智谱 GLM-5 Plus 模型，新一代国产大模型。具备更强的推理能力和中文理解能力，适合专业心理评估和风险分析。',
                'version': 'v5.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            # ========== Kimi（月之暗面）系列 ==========
            {
                'model_name': 'Kimi-k2.5', 'model_code': 'kimi-k2.5',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'moonshot',
                'api_base_url': 'https://api.moonshot.cn/v1',
                'config_template': 'moonshot',
                'description': '月之暗面 Kimi K2.5 模型，超强推理能力。适合复杂自杀风险案例的深度分析和专业心理评估报告生成。',
                'version': 'v2.5', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': 'Kimi-Pro', 'model_code': 'kimi-pro',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'moonshot',
                'api_base_url': 'https://api.moonshot.cn/v1',
                'config_template': 'moonshot',
                'description': '月之暗面 Kimi Pro 大模型，支持 128K 超长上下文。适合长文本心理档案分析和综合评估。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': 'Kimi-Plus', 'model_code': 'kimi-plus',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'moonshot',
                'api_base_url': 'https://api.moonshot.cn/v1',
                'config_template': 'moonshot',
                'description': '月之暗面 Kimi Plus 模型，适合专业心理评估对话和风险分析。性能与成本平衡优秀。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            # ========== 腾讯云混元系列 ==========
            {
                'model_name': '腾讯云混元-hunyuan-pro', 'model_code': 'hunyuan-pro',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'hunyuan',
                'api_base_url': 'https://api.hunyuan.cloud.tencent.com/v1',
                'config_template': 'hunyuan',
                'description': '腾讯云混元 Pro 大模型，适合专业心理评估场景。支持自杀风险综合评估报告生成和干预建议。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': '腾讯云混元-hunyuan-standard', 'model_code': 'hunyuan-standard',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'hunyuan',
                'api_base_url': 'https://api.hunyuan.cloud.tencent.com/v1',
                'config_template': 'hunyuan',
                'description': '腾讯云混元 Standard 模型，适合一般心理对话和风险筛查。性价比高，响应速度快。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            # ========== OpenAI 系列 ==========
            {
                'model_name': 'GPT-4 Turbo', 'model_code': 'gpt-4-turbo',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'openai',
                'api_base_url': 'https://api.openai.com/v1',
                'config_template': 'openai',
                'description': 'OpenAI GPT-4 Turbo 模型，最强大的通用对话模型。适合复杂心理评估和综合报告生成任务。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': 'GPT-4o-mini', 'model_code': 'gpt-4o-mini',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'openai',
                'api_base_url': 'https://api.openai.com/v1',
                'config_template': 'openai',
                'description': 'OpenAI GPT-4o Mini 模型，轻量级但功能强大。适合快速风险筛查和实时对话。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            # ========== DeepSeek 系列 ==========
            {
                'model_name': 'DeepSeek-V3', 'model_code': 'deepseek-v3',
                'model_category': 'api', 'model_type': 'api',
                'provider': 'deepseek',
                'api_base_url': 'https://api.deepseek.com/v1',
                'config_template': 'deepseek',
                'description': 'DeepSeek V3 大模型，高性价比国产模型。适合自杀风险综合评估和专业心理对话。',
                'version': 'v1.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
        ]

        # Ollama 本地 LLM 模型（基于您电脑上已安装的模型）
        ollama_models = [
            {
                'model_name': 'Qwen2-1.5B (本地)', 'model_code': 'qwen2-1.5b',
                'model_category': 'local_llm', 'model_type': 'ollama',
                'provider': 'ollama',
                'ollama_model_name': 'qwen2:1.5b',
                'ollama_base_url': 'http://localhost:11434',
                'description': '通义千问 2 代 1.5B 本地模型，轻量级，适合快速推理和测试。支持中文对话和基础心理对话。',
                'version': 'v2.0', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': 'DeepSeek-Coder-1.3B (本地)', 'model_code': 'deepseek-coder-1.3b',
                'model_category': 'local_llm', 'model_type': 'ollama',
                'provider': 'ollama',
                'ollama_model_name': 'deepseek-coder:1.3b',
                'ollama_base_url': 'http://localhost:11434',
                'description': 'DeepSeek Coder 1.3B 本地模型，适合代码生成和技术文档处理，也可用于结构化心理评估报告生成。',
                'version': 'v1.3b', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': 'DeepSeek-Coder-Latest (本地)', 'model_code': 'deepseek-coder-latest',
                'model_category': 'local_llm', 'model_type': 'ollama',
                'provider': 'ollama',
                'ollama_model_name': 'deepseek-coder:latest',
                'ollama_base_url': 'http://localhost:11434',
                'description': 'DeepSeek Coder 最新版本本地模型，具备最新优化。适合结构化评估报告和专业心理分析。',
                'version': 'latest', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
            {
                'model_name': 'DeepSeek-R1-7B (本地)', 'model_code': 'deepseek-r1-7b',
                'model_category': 'local_llm', 'model_type': 'ollama',
                'provider': 'ollama',
                'ollama_model_name': 'deepseek-r1:7b',
                'ollama_base_url': 'http://localhost:11434',
                'description': 'DeepSeek R1 7B 推理模型，超强推理能力。本地部署，适合复杂自杀风险案例深度分析和综合评估报告生成。支持中文对话。',
                'version': 'v7b', 'is_available': True, 'is_builtin': True, 'status': 'active',
                'supported_datasets': '["reddit"]',
            },
        ]

        all_models = emoji_models + api_models + ollama_models

        templates = [
            {
                'name': '自杀风险检测标准模板', 'task_type': '自杀风险检测',
                'description': '自杀风险检测的标准提示词模板，用于综合评估用户的自杀风险水平。',
                'prompt_content': '''【角色定义】你是一位专业的心理健康评估专家，专注于自杀风险检测。你的任务是对用户的心理状态进行全面评估。

【背景信息】
- 数据来源：{{data_source}}
- 用户历史贴文数量：{{post_count}} 条
- 情绪关键词命中数：{{emotion_keyword_count}} 个

【Emocc 情绪模型检测结果】
- 情绪状态：{{emotion_state}}
- 情绪强度：{{emotion_intensity}}

【用户近期贴文摘要】
{{posts_summary}}

【评估任务】
请根据以上信息，对该用户的自杀风险进行综合评估：

1. **风险等级判定**（高/中/低）
2. **关键风险因素**（列出最主要的 3 个风险因素）
3. **保护性因素**（列出用户现有的 2 个保护性因素）
4. **专业建议**（给医生的干预建议，3-5 条）
5. **随访建议**（建议的随访频率和方式）

【输出格式】
请以 JSON 格式输出：
{
  "risk_level": "high/medium/low",
  "risk_score": 0.0-1.0,
  "key_risk_factors": ["factor1", "factor2", "factor3"],
  "protective_factors": ["factor1", "factor2"],
  "professional_advice": ["advice1", "advice2", "advice3", "advice4", "advice5"],
  "follow_up_suggestion": "随访建议描述",
  "confidence": 0.0-1.0
}

【重要原则】
- 请务必以专业、关怀的态度进行分析
- 不得在输出中直接引用或复述用户可能存在的自杀意念内容
- 评估结果仅供参考，最终诊断应由专业医生做出
- 如发现高风险情况，请优先考虑用户安全''',
            },
            {
                'name': '抑郁筛查标准模板', 'task_type': '抑郁筛查',
                'description': '抑郁症状筛查的标准提示词模板，用于评估用户的抑郁状态。',
                'prompt_content': '''【角色定义】你是一位专业的心理健康评估专家，专注于抑郁症状筛查。你的任务是对用户的心理状态进行全面评估。

【用户信息】
- 数据来源：{{data_source}}
- 近期贴文数量：{{post_count}} 条
- 抑郁相关关键词命中：{{depression_keyword_count}} 个
- 消极情绪词汇频率：{{negative_word_frequency}}

【情绪分析结果】
- 平均情感分数：{{avg_sentiment_score}}
- 情感波动程度：{{sentiment_volatility}}
- 主要情绪类型：{{primary_emotions}}

【评估任务】
请评估该用户的抑郁症状严重程度：

1. **抑郁等级判定**（重度/中度/轻度/无明显抑郁）
2. **核心症状识别**（识别出具体抑郁症状，如情绪低落、兴趣减退、睡眠障碍等）
3. **严重程度评分**（0-10 分）
4. **需要关注的信号**（自杀相关、幻觉妄想等严重症状需特别标记）

【输出格式】
请以 JSON 格式输出：
{
  "depression_level": "severe/moderate/mild/none",
  "severity_score": 0-10,
  "symptoms_identified": ["symptom1", "symptom2", "symptom3"],
  "warning_signals": ["signal1", "signal2"],
  "recommendation": "干预建议"
}

【重要原则】
- 保持专业、关怀的评估态度
- 如发现严重抑郁症状，需明确建议立即就医''',
            },
            {
                'name': '焦虑检测标准模板', 'task_type': '焦虑检测',
                'description': '焦虑症状检测的标准提示词模板，用于评估用户的焦虑状态。',
                'prompt_content': '''【角色定义】你是一位专业的心理健康评估专家，专注于焦虑症状检测。你的任务是对用户的心理状态进行全面评估。

【用户信息】
- 数据来源：{{data_source}}
- 近期贴文数量：{{post_count}} 条
- 焦虑相关关键词命中：{{anxiety_keyword_count}} 个
- 压力相关词汇频率：{{stress_word_frequency}}

【情绪分析结果】
- 情感稳定性评分：{{emotional_stability}}
- 主要情绪类型：{{primary_emotions}}
- 情绪波动特征：{{emotion_pattern}}

【评估任务】
请评估该用户的焦虑症状严重程度：

1. **焦虑等级判定**（重度/中度/轻度/无明显焦虑）
2. **焦虑类型识别**（广泛性焦虑/社交焦虑/特定恐惧等）
3. **躯体症状评估**（睡眠问题、食欲变化、身体不适等）
4. **风险信号识别**（特别注意自杀意念和自伤行为）

【输出格式】
请以 JSON 格式输出：
{
  "anxiety_level": "severe/moderate/mild/none",
  "anxiety_type": "类型描述",
  "physical_symptoms": ["symptom1", "symptom2"],
  "risk_signals": ["signal1"],
  "recommendation": "干预建议"
}''',
            },
            {
                'name': '压力评估标准模板', 'task_type': '压力评估',
                'description': '压力水平评估的标准提示词模板，用于评估用户承受的压力水平。',
                'prompt_content': '''【角色定义】你是一位专业的心理健康评估专家，专注于压力水平评估。你的任务是对用户的压力状态进行全面评估。

【用户信息】
- 数据来源：{{data_source}}
- 近期贴文数量：{{post_count}} 条
- 压力相关关键词命中：{{stress_keyword_count}} 个
- 消极表达频率：{{negative_expression_frequency}}

【Emocc 情绪检测结果】
- 情绪状态：{{emotion_state}}
- 情绪强度：{{emotion_intensity}}

【评估任务】
请评估该用户的压力水平：

1. **压力等级判定**（极高/高/中/低）
2. **主要压力来源分析**
3. **应对资源评估**（用户现有的社会支持、 coping 策略等）
4. **干预优先级**（高/中/低）

【输出格式】
请以 JSON 格式输出：
{
  "stress_level": "very_high/high/medium/low",
  "primary_stressors": ["stressor1", "stressor2"],
  "coping_resources": ["resource1", "resource2"],
  "intervention_priority": "high/medium/low",
  "recommendation": "具体建议"
}''',
            },
            {
                'name': '综合风险评估模板', 'task_type': '综合评估',
                'description': '综合心理风险评估的标准提示词模板，用于整合多维度评估结果。',
                'prompt_content': '''【角色定义】你是一位资深的心理健康评估专家，专注于自杀风险的综合评估。你的任务是对用户的心理健康状况进行全面、系统的评估。

【综合评估数据】
- 数据来源：{{data_source}}
- 用户历史贴文数量：{{post_count}} 条
- 评估时间范围：{{time_range}}

【模型检测结果汇总】
Emocc 情绪检测：
- 情绪状态：{{emotion_state}}
- 情绪强度：{{emotion_intensity}}
- 情绪波动：{{emotion_volatility}}

【量表评估结果】
- PHQ-9 得分：{{phq9_score}}
- SAS 得分：{{sas_score}}
- SDS 得分：{{sds_score}}

【评估任务】
请进行综合心理风险评估：

1. **综合风险等级判定**（高危/中高危/中危/低危）
2. **多维度分析**：
   - 自杀意念强度与频率
   - 保护性因素数量与强度
   - 社会支持系统状况
   - 既往自杀行为史（若有）
3. **风险轨迹分析**（上升/稳定/下降）
4. **个体化干预方案**：
   - 短期措施（1周内）
   - 中期措施（1-3个月）
   - 长期跟踪计划
5. **专业资源推荐**：
   - 建议就诊科室
   - 心理咨询建议
   - 危机干预热线

【输出格式】
请以 JSON 格式输出：
{
  "comprehensive_risk_level": "high/medium-high/medium/low",
  "risk_trajectory": "increasing/stable/decreasing",
  "dimension_analysis": {
    "suicidal_ideation": {"intensity": 0-10, "frequency": "描述"},
    "protective_factors": ["factor1", "factor2", "factor3"],
    "social_support": "评估描述",
    "history_check": "既往史描述"
  },
  "intervention_plan": {
    "short_term": ["measure1", "measure2"],
    "medium_term": ["measure1", "measure2"],
    "long_term": ["measure1", "measure2"]
  },
  "resource_recommendations": {
    "department": "建议科室",
    "counseling": "咨询建议",
    "crisis_hotline": "危机热线建议"
  },
  "overall_confidence": 0.0-1.0
}

【重要声明】
本评估结果仅供参考，不构成医学诊断。所有高危个案应由专业精神科医生进行面诊评估。''',
            },
        ]

        async with mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")

                for model in all_models:
                    await cursor.execute("""
                        INSERT INTO models (
                            model_name, model_code, model_category, model_type,
                            provider, api_base_url, config_template,
                            detection_type, model_file_path, embedding_file_path,
                            ollama_model_name, ollama_base_url,
                            description, version, is_available, is_default, is_builtin,
                            status, performance_metrics, supported_datasets
                        ) VALUES (
                            %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                        )
                        ON DUPLICATE KEY UPDATE
                            model_name=VALUES(model_name),
                            model_type=VALUES(model_type),
                            ollama_model_name=VALUES(ollama_model_name),
                            ollama_base_url=VALUES(ollama_base_url),
                            model_file_path=VALUES(model_file_path),
                            description=VALUES(description),
                            updated_at=NOW()
                    """, (
                        model['model_name'], model['model_code'], model['model_category'], model['model_type'],
                        model.get('provider'), model.get('api_base_url'), model.get('config_template'),
                        model.get('detection_type'), model.get('model_file_path'), model.get('embedding_file_path'),
                        model.get('ollama_model_name'), model.get('ollama_base_url'),
                        model['description'], model['version'], model['is_available'], model.get('is_default', False),
                        model['is_builtin'], model['status'],
                        model.get('performance_metrics'), model.get('supported_datasets'),
                    ))

                for tpl in templates:
                    await cursor.execute("""
                        INSERT INTO prompt_templates (
                            name, task_type, description, prompt_content, is_active, usage_count
                        ) VALUES (%s,%s,%s,%s,TRUE,0)
                        ON DUPLICATE KEY UPDATE
                            description=VALUES(description),
                            prompt_content=VALUES(prompt_content),
                            updated_at=NOW()
                    """, (tpl['name'], tpl['task_type'], tpl['description'], tpl['prompt_content']))

                await conn.commit()

        print(f"[init_builtin] Emocc ×{len(emoji_models)}, "
              f"API模板 ×{len(api_models)}, "
              f"Ollama本地 ×{len(ollama_models)}, "
              f"指令模板 ×{len(templates)}")
