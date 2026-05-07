import os
import base64
from typing import AsyncIterator, Iterator, List, Dict, Union, Optional
from openai import OpenAI
import httpx
import certifi


# 默认附件最大字符数（用于纯文本文件 TXT/MD）
MAX_TEXT_CHARS = int(os.getenv("LLM_MAX_ATTACHMENT_CHARS", "50000"))


def get_ssl_verify_config() -> Union[bool, str]:
    """返回 SSL 证书校验配置。

    默认开启证书校验，优先使用显式配置的 CA 文件，其次使用 certifi。
    仅当环境变量明确要求关闭时才禁用。
    """
    raw_flag = (os.getenv("LLM_SSL_VERIFY", "true") or "true").strip().lower()
    if raw_flag in {"0", "false", "no", "off"}:
        return False

    ca_bundle = (
        os.getenv("LLM_CA_BUNDLE")
        or os.getenv("REQUESTS_CA_BUNDLE")
        or os.getenv("SSL_CERT_FILE")
        or ""
    ).strip()
    if ca_bundle:
        return ca_bundle

    return certifi.where()


def get_llm_config() -> dict:
    """返回 LLM 配置字典（API Key / Base URL / Model）。

    支持通过环境变量配置：
    - LLM_API_KEY（阿里云 DashScope Key，统一使用 sk-8b13e78ae39c405a805f0a57939452db）
    - LLM_BASE_URL（默认 https://dashscope.aliyuncs.com/compatible-mode/v1）
    - LLM_MODEL（默认 qwen-flash）
    - LLM_PROVIDER: dashscope / deepseek（默认 dashscope）
    """
    # 禁用代理，避免代理软件干扰
    os.environ['no_proxy'] = '*'
    os.environ['NO_PROXY'] = '*'

    provider = os.getenv("LLM_PROVIDER", "dashscope").lower()

    if provider == "deepseek":
        # DeepSeek
        return {
            "api_key": (os.getenv("LLM_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or "").strip(),
            "base_url": (os.getenv("LLM_BASE_URL") or "https://api.deepseek.com/v1").strip(),
            "model": (os.getenv("LLM_MODEL") or "deepseek-chat").strip(),
            "provider": "deepseek",
        }
    else:
        # 阿里云 DashScope (通义千问) - 默认
        return {
            "api_key": os.getenv("LLM_API_KEY", "sk-8b13e78ae39c405a805f0a57939452db").strip(),
            "base_url": os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip(),
            "model": os.getenv("LLM_MODEL", "qwen-flash").strip(),
            "provider": "dashscope",
        }


def encode_file_to_base64(file_path: str) -> str:
    """将任意文件编码为 base64 字符串"""
    with open(file_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def get_mime_type(file_path: str) -> str:
    """根据文件扩展名返回 MIME 类型"""
    ext = os.path.splitext(file_path)[1].lower()
    mime_types = {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".txt": "text/plain",
        ".md": "text/markdown",
    }
    return mime_types.get(ext, "application/octet-stream")


def build_multimodal_messages(
    prompt: str,
    system_prompt: str,
    images: Optional[List[str]] = None,
    attachments: Optional[List[Dict]] = None
) -> List[Dict]:
    """构建支持多模态的消息格式

    Args:
        prompt: 用户提示词
        system_prompt: 系统提示词
        images: 图片路径列表（支持 jpg/png/gif/webp）
        attachments: 附件列表 [{"type": "file", "path": "...", "name": "..."}]

    Returns:
        符合 OpenAI 格式的消息列表，支持多模态输入
    """
    messages = []

    # 系统消息
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    # 用户消息内容
    content = []

    # 添加图片（如果有）
    if images:
        for image_path in images:
            try:
                base64_content = encode_file_to_base64(image_path)
                ext = os.path.splitext(image_path)[1].lower().replace(".", "")
                if ext == "jpg":
                    ext = "jpeg"
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/{ext};base64,{base64_content}"
                    }
                })
            except Exception as e:
                print(f"[Warning] Failed to encode image {image_path}: {e}")

    # 添加附件（如果有）
    if attachments:
        for att in attachments:
            att_path = att.get("path", "")
            att_name = att.get("name", os.path.basename(att_path))
            if not att_path or not os.path.exists(att_path):
                continue

            ext = os.path.splitext(att_path)[1].lower()

            # 图片类附件 - 直接 base64 传图
            if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                try:
                    base64_content = encode_file_to_base64(att_path)
                    mime_type = get_mime_type(att_path)
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{base64_content}"}
                    })
                except Exception as e:
                    print(f"[Warning] Failed to encode image {att_path}: {e}")

            # PDF/DOCX/DOC/XLS/XLSX - 直接 base64 传文件（DashScope qwen-flash 支持多模态文档理解）
            elif ext in [".pdf", ".doc", ".docx", ".xls", ".xlsx"]:
                try:
                    base64_content = encode_file_to_base64(att_path)
                    mime_type = get_mime_type(att_path)
                    # 使用 file 类型的 content 传递文档
                    content.append({
                        "type": "file",
                        "file": {
                            "file_data": f"data:{mime_type};base64,{base64_content}",
                            "filename": att_name
                        }
                    })
                except Exception as e:
                    print(f"[Warning] Failed to encode file {att_path}: {e}")

            # TXT/MD - 直接读取文本内容
            elif ext in [".txt", ".md"]:
                try:
                    with open(att_path, "r", encoding="utf-8", errors="replace") as f:
                        text_content = f.read()
                    truncated = text_content[:MAX_TEXT_CHARS]
                    if len(text_content) > MAX_TEXT_CHARS:
                        truncated += f"\n\n[... 内容已截断，共 {len(text_content)} 字符，仅显示前 {MAX_TEXT_CHARS} 字符 ...]"
                    content.append({
                        "type": "text",
                        "text": f"[附件 - {att_name}]:\n{truncated}"
                    })
                except Exception as e:
                    content.append({
                        "type": "text",
                        "text": f"[附件: {att_name}] (无法读取内容: {e})"
                    })

            # 其他类型 - 尝试作为文本处理
            else:
                try:
                    with open(att_path, "r", encoding="utf-8", errors="replace") as f:
                        text_content = f.read()[:MAX_TEXT_CHARS]
                    content.append({
                        "type": "text",
                        "text": f"[附件 - {att_name}]:\n{text_content}"
                    })
                except:
                    content.append({
                        "type": "text",
                        "text": f"[附件: {att_name}] (不支持的文件类型或无法读取)"
                    })

    # 添加文本提示词
    content.append({"type": "text", "text": prompt})

    messages.append({"role": "user", "content": content})

    return messages


def callLLM(
    prompt: str,
    system_prompt: str = "你是心理健康与心身医学领域的专业辅助助手，擅长心理学与中医学常识性科普。用户若询问医学/中医术语或机制，应结合专业知识作答；勿用固定模板敷衍。",
    images: Optional[List[str]] = None,
    attachments: Optional[List[Dict]] = None
):
    """同步调用大模型，支持多模态输入（图片/附件）

    Args:
        prompt: 用户提示词
        system_prompt: 系统提示词
        images: 图片路径列表
        attachments: 附件列表 [{"type": "file", "path": "...", "name": "..."}]
                  支持：图片直接 base64 传递，PDF/DOCX 直接传递文件， TXT/MD 读取文本
    """
    cfg = get_llm_config()
    if not cfg["api_key"]:
        raise RuntimeError(
            "未配置 LLM_API_KEY（或 DEEPSEEK_API_KEY），"
            "拒绝使用占位或模拟回复；请在环境变量或 Docker Compose 中配置。"
        )

    # 禁用代理，避免代理软件干扰
    os.environ['no_proxy'] = '*'
    os.environ['NO_PROXY'] = '*'

    try:
        # 判断是否使用多模态
        has_multimodal = (images and len(images) > 0) or (attachments and len(attachments) > 0)

        # 使用 requests 库（更稳定的 SSL 处理）
        import requests
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        # 创建带重试的 session
        session = requests.Session()
        retry = Retry(total=3, backoff_factor=0.5)
        adapter = HTTPAdapter(max_retries=retry)
        session.mount('http://', adapter)
        session.mount('https://', adapter)

        # 构建请求头
        headers = {
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json"
        }

        # 构建消息
        if has_multimodal:
            messages = build_multimodal_messages(prompt, system_prompt, images, attachments)
        else:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]

        # 发送请求（合理的超时设置：连接30秒，读取120秒）
        try:
            response = session.post(
                f"{cfg['base_url']}/chat/completions",
                json={
                    "model": cfg["model"],
                    "messages": messages,
                },
                headers=headers,
                verify=get_ssl_verify_config(),
                timeout=(30.0, 120.0),  # (connect_timeout, read_timeout)
            )
            response.raise_for_status()
            result = response.json()
        
            content = result["choices"][0]["message"]["content"].strip()
            # 安全处理可能的 markdown 代码块
            if content.startswith("```json"):
                content = content[7:]
            if content.endswith("```"):
                content = content[:-3]
            return content.strip()
        except requests.exceptions.Timeout:
            print(f"[LLM Timeout] 请求超时（{cfg['provider']}）")
            raise RuntimeError("LLM 请求超时，请稍后重试")
        except requests.exceptions.ConnectionError as e:
            print(f"[LLM Connection Error] {cfg['provider']}: {e}")
            raise RuntimeError(f"LLM 连接失败，请检查网络或 API 配置")
        except Exception as e:
            print(f"[LLM Error] {cfg['provider']}: {e}")
            raise RuntimeError(f"LLM 调用失败: {str(e)}")

    except Exception as e:
        print(f"[callLLM Error] {e}")
        raise


from concurrent.futures import ThreadPoolExecutor

# 全局线程池，用于执行同步阻塞的 LLM 调用，避免阻塞事件循环
_executor = ThreadPoolExecutor(max_workers=32)


async def async_callLLM(prompt: str, system_prompt: str = "你是心理健康与心身医学领域的专业辅助助手，擅长心理学与中医学常识性科普。用户若询问医学/中医术语或机制，应结合专业知识作答；勿用固定模板敷衍。") -> str:
    """异步调用 LLM，在后台线程执行同步 HTTP 请求，不阻塞 FastAPI 事件循环。

    Args:
        prompt: 用户提示词
        system_prompt: 系统提示词

    Returns:
        LLM 生成的文本响应
    """
    import asyncio
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, callLLM, prompt, system_prompt)


def callLLM_stream(messages: List[Dict]) -> AsyncIterator[str]:
    """流式调用大模型，yield 每个 token。"""
    cfg = get_llm_config()
    if not cfg["api_key"]:
        raise RuntimeError("未配置 LLM_API_KEY，拒绝模拟流式输出。")
    http_client = httpx.Client(
        verify=get_ssl_verify_config(),
        timeout=httpx.Timeout(120.0, connect=30.0),
    )
    client = OpenAI(
        api_key=cfg["api_key"],
        base_url=cfg["base_url"],
        http_client=http_client,
    )
    response = client.chat.completions.create(
        model=cfg["model"],
        messages=messages,
        stream=True,
    )
    for chunk in response:
        # 安全检查：确保 chunk 和 choices 存在
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta is None:
            continue
        content = delta.content
        if content:
            yield content


def callLLM_stream_multimodal(
    prompt: str,
    system_prompt: str,
    images: Optional[List[str]] = None,
    attachments: Optional[List[Dict]] = None,
) -> AsyncIterator[str]:
    """流式调用大模型，支持多模态输入（图片/附件），yield 每个 token。

    Args:
        prompt: 用户提示词
        system_prompt: 系统提示词
        images: 图片路径列表
        attachments: 附件列表 [{"type": "file", "path": "...", "name": "..."}]
                    支持：图片直接 base64 传递，PDF/DOCX 直接传递文件， TXT/MD 读取文本
    """
    cfg = get_llm_config()
    if not cfg["api_key"]:
        raise RuntimeError("未配置 LLM_API_KEY，拒绝模拟流式输出。")

    # 禁用代理
    os.environ['no_proxy'] = '*'
    os.environ['NO_PROXY'] = '*'

    messages = build_multimodal_messages(prompt, system_prompt, images, attachments)

    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    session = requests.Session()
    retry = Retry(total=3, backoff_factor=0.5)
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)

    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json"
    }

    import json as json_module
    try:
        with requests.post(
            f"{cfg['base_url']}/chat/completions",
            json={
                "model": cfg["model"],
                "messages": messages,
                "stream": True,
            },
            headers=headers,
            stream=True,
            verify=get_ssl_verify_config(),
            timeout=(30.0, 120.0),
        ) as response:
            response.raise_for_status()
            # 逐行读取 SSE 格式的流式响应
            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if line.startswith("data: "):
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk_data = json_module.loads(data)
                        delta = chunk_data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
                    except json_module.JSONDecodeError:
                        continue
    except requests.exceptions.Timeout:
        print(f"[LLM Stream Timeout] 请求超时（{cfg['provider']}）")
        raise RuntimeError("LLM 请求超时，请稍后重试")
    except requests.exceptions.ConnectionError as e:
        print(f"[LLM Stream Connection Error] {cfg['provider']}: {e}")
        raise RuntimeError(f"LLM 连接失败: {str(e)}")
    except Exception as e:
        print(f"[LLM Stream Error] {cfg['provider']}: {e}")
        raise RuntimeError(f"LLM 流式调用失败: {str(e)}")


if __name__ == "__main__":
    print(callLLM("你好"))
