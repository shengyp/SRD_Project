"""
大语言模型调用客户端
支持 Ollama 本地模型和 API 模型的统一调用接口
"""

import json
import threading
from typing import Dict, List, Optional, Any
from concurrent.futures import ThreadPoolExecutor, as_completed


# ========== 速率限制管理器 ==========
class RateLimitManager:
    """简单的速率限制管理器"""

    def __init__(self):
        self._limiters: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def register_model(self, model_id: str, max_requests: int = 20, time_window: int = 60):
        """注册模型的速率限制"""
        with self._lock:
            from ratelimit import RateLimiter
            self._limiters[model_id] = RateLimiter(max_requests, time_window)

    def can_request(self, model_id: str) -> bool:
        """检查是否可以发起请求"""
        with self._lock:
            limiter = self._limiters.get(model_id)
            if limiter:
                return limiter.can_request()
            return True

    def acquire(self, model_id: str, timeout: float = 60):
        """等待获取请求许可"""
        with self._lock:
            limiter = self._limiters.get(model_id)
            if limiter:
                limiter.acquire(timeout=timeout)

    def get_limiter(self, model_id: str):
        """获取限流器实例"""
        return self._limiters.get(model_id)


# 全局限流器实例
rate_limiter = RateLimitManager()


class LLMClient:
    """大语言模型客户端基类"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化 LLM 客户端

        Args:
            model_config: 模型配置字典
        """
        self.model_config = model_config
        self.model_type = model_config.get('type', 'api')
        self.model_id = model_config.get('model_id')
        self.api_key = model_config.get('api_key', '')
        self.base_url = model_config.get('base_url', None)
        self.temperature = model_config.get('temperature', 0.0)

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用大模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        raise NotImplementedError("子类必须实现call方法")

    def batch_call(self, prompts: List[str], system_prompt: str = "你是一个有用的AI助手。",
                   max_workers: int = 4) -> List[Dict[str, Any]]:
        """
        批量调用大模型

        Args:
            prompts: 提示词列表
            system_prompt: 系统提示词
            max_workers: 最大并发数

        Returns:
            响应结果列表
        """
        results = []

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                executor.submit(self.call, prompt, system_prompt)
                for prompt in prompts
            ]

            for future in as_completed(futures):
                result = future.result()
                results.append(result)

        return results


# ==================== Ollama 本地模型客户端 ====================

class OllamaClient(LLMClient):
    """Ollama 本地模型客户端 - 支持通过 Ollama API 调用本地大模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化 Ollama 客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: Ollama 模型名称 (如 qwen2:1.8b)
                - base_url: Ollama API 地址 (默认 http://localhost:11434)
                - temperature: 温度参数
                - timeout: 请求超时时间(秒)
        """
        super().__init__(model_config)
        self.base_url = model_config.get('base_url', 'http://localhost:11434')
        self.timeout = model_config.get('timeout', 120)
        self._client = None

    def _get_client(self):
        """获取 requests 会话"""
        import requests
        if self._client is None:
            self._client = requests.Session()
        return self._client

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        通过 Ollama API 调用本地模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        import requests

        try:
            # 构建请求
            url = f"{self.base_url}/api/generate"

            # 构建消息格式 (Ollama 的 /api/generate 使用 prompt 字段)
            full_prompt = f"{system_prompt}\n\n{prompt}"

            payload = {
                "model": self.model_id,
                "prompt": full_prompt,
                "stream": False,
                "options": {
                    "temperature": self.temperature if self.temperature > 0 else 0.7,
                    "num_predict": 512,
                }
            }

            # 发送请求
            response = requests.post(
                url,
                json=payload,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code == 200:
                result = response.json()
                reply = result.get('response', '').strip()

                return {
                    'success': True,
                    'response': reply,
                    'model': self.model_id,
                    'model_type': 'ollama'
                }
            else:
                return {
                    'success': False,
                    'error': f"Ollama API 错误: {response.status_code} - {response.text}",
                    'model': self.model_id
                }

        except requests.exceptions.ConnectionError:
            return {
                'success': False,
                'error': f"无法连接到 Ollama 服务: {self.base_url}，请确保 Ollama 已启动",
                'model': self.model_id
            }
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'error': f"请求超时 ({self.timeout}秒)",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"Ollama 调用失败: {str(e)}",
                'model': self.model_id
            }

    def list_models(self) -> Dict[str, Any]:
        """列出 Ollama 可用的模型"""
        import requests

        try:
            url = f"{self.base_url}/api/tags"
            response = requests.get(url, timeout=10)

            if response.status_code == 200:
                return {
                    'success': True,
                    'models': response.json().get('models', [])
                }
            else:
                return {
                    'success': False,
                    'error': f"获取模型列表失败: {response.status_code}"
                }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def check_health(self) -> bool:
        """检查 Ollama 服务是否可用"""
        try:
            result = self.list_models()
            return result.get('success', False)
        except:
            return False


# ==================== OpenAI 兼容 API 客户端 ====================

class OpenAICompatibleClient(LLMClient):
    """OpenAI 兼容 API 客户端 - 支持 OpenAI、DeepSeek、Kimi 等"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化 OpenAI 兼容客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 gpt-4o、deepseek-chat)
                - api_key: API 密钥
                - base_url: API 地址 (如 https://api.deepseek.com/v1)
                - temperature: 温度参数
                - timeout: 请求超时时间(秒)
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self.max_tokens = model_config.get('max_tokens', 2048)
        self._client = None

    def _get_client(self):
        """获取 OpenAI 客户端"""
        try:
            from openai import OpenAI
            if self._client is None:
                # 禁用环境变量中的代理，避免代理软件干扰
                import os
                os.environ['no_proxy'] = '*'
                os.environ['NO_PROXY'] = '*'

                self._client = OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url
                )
            return self._client
        except ImportError:
            raise ImportError("请安装 openai 库: pip install openai")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        通过 OpenAI 兼容 API 调用模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            # 检查速率限制
            if not rate_limiter.can_request(self.model_id):
                print(f"[RateLimiter] {self.model_id} 需要等待")
                rate_limiter.acquire(self.model_id, timeout=120)

            client = self._get_client()

            response = client.chat.completions.create(
                model=self.model_id,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=self.temperature if self.temperature > 0 else 0.7,
                max_tokens=self.max_tokens
            )

            reply = response.choices[0].message.content.strip()

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'openai_compatible'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"API 调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== 智谱 AI 客户端 ====================

class ZhipuAIClient(LLMClient):
    """智谱 AI 客户端 - 支持智谱 GLM 系列模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化智谱 AI 客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 glm-4-flash)
                - api_key: API 密钥
                - base_url: API 地址
                - temperature: 温度参数
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self._client = None

    def _get_client(self):
        """获取智谱 AI 客户端"""
        try:
            from zhipuai import ZhipuAI
            if self._client is None:
                self._client = ZhipuAI(
                    api_key=self.api_key
                )
            return self._client
        except ImportError:
            raise ImportError("请安装智谱 AI SDK: pip install zhipuai")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用智谱 AI 模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            # 检查速率限制
            if not rate_limiter.can_request(self.model_id):
                print(f"[RateLimiter] {self.model_id} 需要等待")
                rate_limiter.acquire(self.model_id, timeout=120)

            client = self._get_client()

            response = client.chat.completions.create(
                model=self.model_id,  # 智谱AI要求模型名称小写
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=self.temperature
            )

            reply = response.choices[0].message.content.strip()

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'zhipu_ai'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"智谱AI调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== 通义千问（DashScope）客户端 ====================

class DashScopeClient(LLMClient):
    """通义千问客户端 - 支持阿里云 DashScope API"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化通义千问客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 qwen-plus、qwen-turbo)
                - api_key: API 密钥
                - base_url: API 地址 (默认 https://dashscope.aliyuncs.com/compatible-mode/v1)
                - temperature: 温度参数
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self._client = None

    def _get_client(self):
        """获取 DashScope 客户端"""
        try:
            from openai import OpenAI
            if self._client is None:
                self._client = OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1"
                )
            return self._client
        except ImportError:
            raise ImportError("请安装 openai 库: pip install openai")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用通义千问模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            # 检查速率限制
            if not rate_limiter.can_request(self.model_id):
                print(f"[RateLimiter] {self.model_id} 需要等待")
                rate_limiter.acquire(self.model_id, timeout=120)

            client = self._get_client()

            response = client.chat.completions.create(
                model=self.model_id,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=self.temperature if self.temperature > 0 else 0.7
            )

            reply = response.choices[0].message.content.strip()

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'dashscope'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"通义千问调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== Google Gemini 客户端 ====================

class GeminiClient(LLMClient):
    """Google Gemini 客户端 - 支持 Gemini 系列模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化 Gemini 客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 gemini-2.0-flash、gemini-1.5-pro)
                - api_key: API 密钥
                - base_url: API 地址
                - temperature: 温度参数
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self._client = None

    def _get_client(self):
        """获取 Gemini API 客户端"""
        try:
            import google.genai as genai
            if self._client is None:
                self._client = genai.Client(api_key=self.api_key)
            return self._client
        except ImportError:
            try:
                from vertexai.generative_models import GenerativeModel
                if self._client is None:
                    self._client = GenerativeModel(self.model_id)
                return self._client
            except ImportError:
                raise ImportError("请安装 Google Gemini SDK: pip install google-genai 或 pip install vertexai")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用 Gemini 模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词（Gemini 使用 contents 格式）

        Returns:
            包含响应结果的字典
        """
        try:
            import google.genai as genai

            client = genai.Client(api_key=self.api_key)

            response = client.models.generate_content(
                model=self.model_id,
                contents=prompt,
                config={
                    'temperature': self.temperature if self.temperature > 0 else 0.7,
                    'system_instruction': system_prompt
                }
            )

            reply = response.text.strip() if hasattr(response, 'text') else str(response)

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'gemini'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"Gemini API 调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== 腾讯云混元（Hunyuan）客户端 ====================

class HunyuanClient(LLMClient):
    """腾讯云混元客户端 - 支持混元系列模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化腾讯云混元客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 hunyuan-pro、hunyuan-standard)
                - api_key: API 密钥
                - secret_key: 腾讯云 SecretKey
                - app_id: 腾讯云 AppID
                - base_url: API 地址
                - temperature: 温度参数
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self.secret_key = model_config.get('secret_key', '')
        self.app_id = model_config.get('app_id', '')
        self._client = None

    def _get_tc3_signature(self) -> str:
        """生成腾讯云 TC3-HMAC-SHA256 签名（简化版）"""
        import hashlib
        import hmac
        import datetime

        secret_id = self.api_key
        secret_key = self.secret_key

        if not secret_id or not secret_key:
            return None

        return {
            'secret_id': secret_id,
            'secret_key': secret_key
        }

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用腾讯云混元模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            import requests
            import json

            headers = {
                'Content-Type': 'application/json',
                'Authorization': self.api_key
            }

            payload = {
                "app_id": int(self.app_id) if self.app_id else 0,
                "secret_id": self.api_key,
                "prompt": prompt,
                "system_prompt": system_prompt,
                "temperature": self.temperature if self.temperature > 0 else 0.5,
                "top_p": 0.9,
                "enable_trace": True
            }

            response = requests.post(
                self.base_url,
                headers=headers,
                json=payload,
                timeout=self.timeout
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('code') == 0:
                    reply = result.get('data', {}).get('choices', [{}])[0].get('text', '').strip()
                    return {
                        'success': True,
                        'response': reply,
                        'model': self.model_id,
                        'model_type': 'hunyuan'
                    }
                else:
                    return {
                        'success': False,
                        'error': f"混元 API 错误: {result.get('message', '未知错误')}",
                        'model': self.model_id
                    }
            else:
                return {
                    'success': False,
                    'error': f"混元 API 错误: {response.status_code} - {response.text}",
                    'model': self.model_id
                }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"腾讯云混元调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== Moonshot (Kimi) 客户端 ====================

class MoonshotClient(LLMClient):
    """Moonshot (Kimi) 客户端 - 支持月之暗面 Kimi 系列模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化 Moonshot 客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 moonshot-v1-8k)
                - api_key: API 密钥
                - base_url: API 地址 (默认 https://api.moonshot.cn/v1)
                - temperature: 温度参数
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self.max_tokens = model_config.get('max_tokens', 8192)
        self._client = None

    def _get_client(self):
        """获取 Moonshot API 客户端"""
        try:
            from openai import OpenAI
            if self._client is None:
                self._client = OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url or "https://api.moonshot.cn/v1"
                )
            return self._client
        except ImportError:
            raise ImportError("请安装 openai 库: pip install openai")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用 Moonshot Kimi 模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            client = self._get_client()

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            response = client.chat.completions.create(
                model=self.model_id,
                messages=messages,
                temperature=self.temperature if self.temperature > 0 else 0.3,
                max_tokens=self.max_tokens
            )

            reply = response.choices[0].message.content.strip()

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'moonshot'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"Moonshot API 调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== MiniMax 客户端 ====================

class MiniMaxClient(LLMClient):
    """MiniMax 客户端 - 支持 MiniMax 海螺系列模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化 MiniMax 客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 abyss-s)
                - api_key: API 密钥 (MiniMax API Key)
                - group_id: 分组 ID
                - base_url: API 地址 (默认 https://api.minimax.chat/v1)
                - temperature: 温度参数
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self.group_id = model_config.get('group_id', '')
        self._client = None

    def _get_client(self):
        """获取 MiniMax API 客户端"""
        try:
            from openai import OpenAI
            if self._client is None:
                self._client = OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url or "https://api.minimax.chat/v1"
                )
            return self._client
        except ImportError:
            raise ImportError("请安装 openai 库: pip install openai")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用 MiniMax 模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            client = self._get_client()

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            extra_headers = {}
            if self.group_id:
                extra_headers['MiniMax-GroupId'] = self.group_id

            response = client.chat.completions.create(
                model=self.model_id,
                messages=messages,
                temperature=self.temperature if self.temperature > 0 else 0.5,
                extra_headers=extra_headers if extra_headers else None
            )

            reply = response.choices[0].message.content.strip()

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'minimax'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"MiniMax API 调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== Anthropic Claude 客户端 ====================

class AnthropicClient(LLMClient):
    """Anthropic Claude 客户端 - 支持 Claude 系列模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化 Anthropic Claude 客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称 (如 claude-3-5-sonnet-latest)
                - api_key: API 密钥
                - base_url: API 地址 (默认 https://api.anthropic.com)
                - temperature: 温度参数
                - max_tokens: 最大生成 tokens
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 120)
        self.max_tokens = model_config.get('max_tokens', 4096)
        self._client = None

    def _get_client(self):
        """获取 Anthropic API 客户端"""
        try:
            import anthropic
            if self._client is None:
                self._client = anthropic.Anthropic(
                    api_key=self.api_key
                )
            return self._client
        except ImportError:
            raise ImportError("请安装 Anthropic SDK: pip install anthropic")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用 Anthropic Claude 模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            client = self._get_client()

            response = client.messages.create(
                model=self.model_id,
                max_tokens=self.max_tokens,
                temperature=self.temperature if self.temperature > 0 else 1.0,
                system=system_prompt if system_prompt else None,
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )

            reply = response.content[0].text.strip() if response.content else ''

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'anthropic'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"Anthropic API 调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== 本地模型客户端 ====================

class LocalModelClient(LLMClient):
    """本地模型客户端 - 支持 vLLM、LM Studio 等本地部署模型"""

    def __init__(self, model_config: Dict[str, Any]):
        """
        初始化本地模型客户端

        Args:
            model_config: 模型配置字典，包含:
                - model_id: 模型名称
                - api_key: API 密钥（可选，通常本地不需要）
                - base_url: 服务地址 (默认 http://localhost:8000/v1)
                - temperature: 温度参数
        """
        super().__init__(model_config)
        self.timeout = model_config.get('timeout', 300)
        self._client = None

    def _get_client(self):
        """获取本地模型 API 客户端"""
        try:
            from openai import OpenAI
            if self._client is None:
                self._client = OpenAI(
                    api_key=self.api_key or 'local',
                    base_url=self.base_url or "http://localhost:8000/v1"
                )
            return self._client
        except ImportError:
            raise ImportError("请安装 openai 库: pip install openai")

    def call(self, prompt: str, system_prompt: str = "你是一个有用的AI助手。") -> Dict[str, Any]:
        """
        调用本地模型

        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词

        Returns:
            包含响应结果的字典
        """
        try:
            client = self._get_client()

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            response = client.chat.completions.create(
                model=self.model_id,
                messages=messages,
                temperature=self.temperature if self.temperature > 0 else 0.7
            )

            reply = response.choices[0].message.content.strip()

            return {
                'success': True,
                'response': reply,
                'model': self.model_id,
                'model_type': 'local'
            }

        except ImportError as e:
            return {
                'success': False,
                'error': f"缺少依赖库: {str(e)}",
                'model': self.model_id
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"本地模型调用失败: {str(e)}",
                'model': self.model_id
            }


# ==================== 客户端工厂函数 ====================

def create_llm_client(model_type: str, model_id: str, api_key: str = '',
                      base_url: str = None, temperature: float = 0.0,
                      api_provider: str = None, rate_limit: Dict[str, int] = None,
                      **kwargs) -> Optional[LLMClient]:
    """
    创建 LLM 客户端工厂函数

    Args:
        model_type: 模型类型（ollama/api）
        model_id: 模型ID / 模型名称
        api_key: API密钥
        base_url: API基础URL / Ollama服务地址
        temperature: 温度参数
        api_provider: API提供商 (zhipu/dashscope/deepseek/openai/moonshot)
        rate_limit: 速率限制配置 {"max_requests": 10, "time_window": 60}
        **kwargs: 其他配置参数

    Returns:
        LLM客户端实例
    """
    model_config = {
        'type': model_type,
        'model_id': model_id,
        'api_key': api_key,
        'base_url': base_url,
        'temperature': temperature,
        'api_provider': api_provider,
        **kwargs
    }

    # 注册速率限制（API 模型）
    if model_type == 'api' and rate_limit:
        max_requests = rate_limit.get('max_requests', 20)
        time_window = rate_limit.get('time_window', 60)
        rate_limiter.register_model(model_id, max_requests, time_window)

    # 根据模型类型选择客户端
    if model_type == 'ollama':
        return OllamaClient(model_config)

    elif model_type == 'api':
        # 根据模型代码选择客户端
        model_id_lower = (model_id or '').lower().strip()
        provider = (api_provider or '').lower().strip()

        # 如果是通过 dashscope 调用的 glm/kimi/qwen 模型，统一使用 DashScopeClient
        if 'dashscope' in provider:
            # 阿里云百炼 - 统一使用 DashScopeClient
            return DashScopeClient(model_config)

        # 智谱 AI (独立调用)
        elif 'glm-' in model_id_lower:
            return ZhipuAIClient(model_config)

        # Moonshot Kimi (独立调用)
        elif 'kimi-' in model_id_lower:
            return MoonshotClient(model_config)

        # Google Gemini
        elif 'google' in provider or 'gemini' in model_id_lower:
            return GeminiClient(model_config)

        # 腾讯云混元
        elif 'hunyuan' in provider or 'tencent' in provider:
            return HunyuanClient(model_config)

        # 阿里云百炼 DashScope（qwen-flash 等）
        elif 'dashscope' in provider or 'qwen' in model_id_lower:
            return DashScopeClient(model_config)

        elif 'anthropic' in provider or 'claude' in model_id_lower:
            return AnthropicClient(model_config)

        elif 'local' in provider:
            return LocalModelClient(model_config)

        else:
            # 默认使用 DashScope 客户端
            return DashScopeClient(model_config)

    # 未知类型
    print(f"[WARNING] 未知的模型类型: {model_type}，返回 None")
    return None


# ==================== 支持的模型提供商列表 ====================

SUPPORTED_PROVIDERS = {
    # ========== 国产模型 ==========
    'dashscope': {
        'name': 'DashScope',
        'name_zh': '通义千问',
        'base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'models': [
            'qwen-plus', 'qwen-turbo', 'qwen-max',
            'qwen-plus-0723', 'qwen-plus-0919',
            'qwen-coder-plus', 'qwen-math-plus',
            'qwen3.6-plus', 'qwen3.5-397b-a17b',
            'qwen2.5-72b-instruct', 'qwen2.5-32b-instruct',
            'qwen2.5-7b-instruct', 'qwen2.5-1.5b-instruct',
        ],
        'description': '阿里云通义千问系列模型'
    },
    'deepseek': {
        'name': 'DeepSeek',
        'name_zh': 'DeepSeek',
        'base_url': 'https://api.deepseek.com/v1',
        'models': [
            'deepseek-chat', 'deepseek-coder',
            'deepseek-v3', 'deepseek-r1',
            'deepseek-r1-distill-qwen-7b',
            'deepseek-r1-distill-llama-8b'
        ],
        'description': 'DeepSeek 系列模型（高性价比）'
    },
    'zhipu': {
        'name': 'ZhipuAI',
        'name_zh': '智谱AI',
        'base_url': 'https://open.bigmodel.cn/api/paas/v4',
        'models': [
            'glm-4-flash', 'glm-4-plus', 'glm-4',
            'glm-4v-flash', 'glm-4v-plus',
            'glm-3-turbo',
            'glm-5-plus', 'glm-5-omni', 'glm-5-41b-a3b',
            'glm-z1-standard', 'glm-z1-mini',
        ],
        'description': '智谱 AI GLM 系列模型'
    },
    'moonshot': {
        'name': 'Moonshot',
        'name_zh': 'Kimi',
        'base_url': 'https://api.moonshot.cn/v1',
        'models': [
            'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k',
            'moonshot-v1-auto',
            'kimi-k2.5', 'kimi-k2', 'kimi-k2-mini',
        ],
        'description': '月之暗面 Kimi 系列模型（超长上下文）'
    },
    'hunyuan': {
        'name': 'Hunyuan',
        'name_zh': '腾讯云混元',
        'base_url': 'https://api.hunyuan.cloud.tencent.com/v1',
        'models': [
            'hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite'
        ],
        'description': '腾讯云混元系列模型'
    },
    'dashscope': {
        'name': 'DashScope',
        'name_zh': '通义千问',
        'base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'models': [
            'qwen-flash', 'qwen-flash-1', 'qwen-flash-2', 'qwen-flash-3',
            'qwen-plus', 'qwen-turbo', 'qwen-max',
            'qwen3.6-plus', 'qwen3.5-397b-a17b',
        ],
        'description': '阿里云通义千问系列模型，通过 DashScope API 调用'
    },
    # ========== 国外模型 ==========
    'openai': {
        'name': 'OpenAI',
        'name_zh': 'OpenAI',
        'base_url': 'https://api.openai.com/v1',
        'models': [
            'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06',
            'gpt-4-turbo', 'gpt-4-turbo-2024-04-09',
            'gpt-4', 'gpt-4-32k',
            'gpt-3.5-turbo', 'gpt-3.5-turbo-16k'
        ],
        'description': 'OpenAI GPT 系列模型'
    },
    'google': {
        'name': 'Google',
        'name_zh': 'Gemini',
        'base_url': 'https://generativelanguage.googleapis.com/v1beta/openai/',
        'models': [
            'gemini-2.0-flash', 'gemini-2.0-flash-exp',
            'gemini-1.5-pro', 'gemini-1.5-pro-002',
            'gemini-1.5-flash', 'gemini-1.5-flash-002',
            'gemini-1.5-flash-8b',
            'gemini-pro', 'gemini-pro-vision'
        ],
        'description': 'Google Gemini 系列模型'
    },
    'anthropic': {
        'name': 'Anthropic',
        'name_zh': 'Claude',
        'base_url': 'https://api.anthropic.com/v1',
        'models': [
            'claude-sonnet-4-20250514',
            'claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20241022',
            'claude-3-opus-latest', 'claude-3-opus-20240229',
            'claude-3-sonnet-latest', 'claude-3-sonnet-20240229',
            'claude-3-haiku-latest', 'claude-3-haiku-20240307'
        ],
        'description': 'Anthropic Claude 系列模型'
    },
    # ========== 本地模型 ==========
    'ollama': {
        'name': 'Ollama',
        'name_zh': 'Ollama 本地模型',
        'base_url': 'http://localhost:11434',
        'models': [],
        'description': 'Ollama 本地部署模型（需提前下载）'
    },
    'local': {
        'name': 'Local',
        'name_zh': '本地模型',
        'base_url': 'http://localhost:8000/v1',
        'models': [],
        'description': '其他本地部署模型（如 vLLM、LM Studio 等）'
    }
}


def get_supported_providers() -> Dict[str, Any]:
    """获取支持的模型提供商列表"""
    return SUPPORTED_PROVIDERS


def get_provider_info(provider_key: str) -> Optional[Dict[str, Any]]:
    """获取指定提供商的信息"""
    return SUPPORTED_PROVIDERS.get(provider_key.lower())
