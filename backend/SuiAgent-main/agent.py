# agent.py
import json
import time
import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any, Set, Union, AsyncIterator
from pathlib import Path
from dataclasses import dataclass, field, asdict
import jieba
from config import config, memory_config
from LLM import callLLM
from module import emocc, fealearn
from memory_manager import MemoryManager
from concurrent.futures import ThreadPoolExecutor

from logger import logger, log_conversation, log_decomposition, log_memory_update, log_error

try:
    from vector_db import search_vector_db
    VECTOR_DB_AVAILABLE = True
except ImportError:
    VECTOR_DB_AVAILABLE = False

executor = ThreadPoolExecutor(max_workers=32)


async def async_callLLM(prompt: str) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, callLLM, prompt)


async def async_stream_callLLM(
    messages_or_prompt: Union[List[Dict], str],
    images: Optional[List[str]] = None,
    attachments: Optional[List[Dict]] = None
) -> AsyncIterator[str]:
    """异步流式调用 LLM，yield 每个 token。
    支持两种调用方式：
    1. messages_or_prompt 为 List[Dict]：简单消息列表（纯文本流式）
    2. messages_or_prompt 为 str + images/attachments：多模态流式调用

    使用后台线程运行同步流式生成器，实现真正的异步流式输出。"""
    from LLM import callLLM_stream, callLLM_stream_multimodal
    import queue

    # 创建线程安全的队列用于传递 tokens
    token_queue: queue.Queue = queue.Queue()
    exception_queue: queue.Queue = queue.Queue()

    def run_stream():
        try:
            if isinstance(messages_or_prompt, list):
                # 简单消息列表模式（纯文本流式）
                print(f"[async_stream_callLLM] 开始流式调用，消息数量: {len(messages_or_prompt)}")
                token_count = 0
                for token in callLLM_stream(messages_or_prompt):
                    token_queue.put(token)
                    token_count += 1
                print(f"[async_stream_callLLM] 流式调用完成，共 {token_count} tokens")
            else:
                # 多模态模式
                prompt = messages_or_prompt
                print(f"[async_stream_callLLM] 开始多模态流式调用")
                token_count = 0
                for token in callLLM_stream_multimodal(prompt, images=images, attachments=attachments):
                    token_queue.put(token)
                    token_count += 1
                print(f"[async_stream_callLLM] 多模态流式调用完成，共 {token_count} tokens")
            token_queue.put(None)  # 发送完成信号
        except Exception as e:
            import traceback
            print(f"[async_stream_callLLM] 流式调用异常: {str(e)}")
            print(f"[async_stream_callLLM] 异常详情: {traceback.format_exc()}")
            exception_queue.put(e)
            token_queue.put(None)

    # 在后台线程中运行流式生成器
    stream_thread = executor.submit(run_stream)

    # 从队列中获取 tokens 并 yield
    token_yielded = 0
    try:
        while True:
            token = token_queue.get()
            if token is None:
                print(f"[async_stream_callLLM] 收到完成信号，共 yield {token_yielded} tokens")
                break
            token_yielded += 1
            yield token
            # 让出控制权，允许处理其他任务
            await asyncio.sleep(0)
    finally:
        # 检查是否有异常
        if not exception_queue.empty():
            exc = exception_queue.get()
            print(f"[async_stream_callLLM] 检测到线程异常，重新抛出: {str(exc)}")
            raise exc


@dataclass
class SubQuestion:
    question: str
    original_query: str
    depth: int = 0
    retrieval_attempts: int = 0
    max_attempts: int = 3
    need_knowledge: bool = True


@dataclass
class PatientRecord:
    session_id: str
    diagnosis_hypothesis: List[str] = field(default_factory=list)
    questions_to_ask: List[str] = field(default_factory=list)
    collected_evidence: Dict[str, Any] = field(default_factory=dict)
    diagnosis_history: List[Dict] = field(default_factory=list)
    last_updated: float = field(default_factory=time.time)

    def add_doctor_analysis(self, analysis: Dict):
        analysis['timestamp'] = time.time()
        self.diagnosis_history.append(analysis)
        self.last_updated = time.time()


class DiagnosisOrchestrator:
    def __init__(self, memory_manager: MemoryManager, session_id: str):
        self.memory_manager = memory_manager
        self.session_id = session_id
        self.patient_record = self._load_or_create_record()

    def _load_or_create_record(self) -> PatientRecord:
        record_data = self.memory_manager.get_patient_record(self.session_id)
        if record_data:
            return PatientRecord(**record_data)
        else:
            return PatientRecord(session_id=self.session_id)

    async def run_doctor(self, user_input: str, context: str):
        prompt = f"""
                    你是一名资深心理医生，正在会诊一位患者。请基于以下信息进行分析：

                    当前诊断假设：{self.patient_record.diagnosis_hypothesis}
                    已收集证据：{self.patient_record.collected_evidence}
                    待问问题：{self.patient_record.questions_to_ask}

                    患者最新发言：{user_input}
                    对话历史摘要：{context}

                    请完成以下任务：
                    1. 分析患者发言可能反映的潜在心理问题或病因，更新诊断假设（可新增或修正）。
                    2. 根据当前假设，列出接下来需要向患者追问的1-3个问题，以进一步验证假设。
                    3. 将分析结果以JSON格式输出，包含以下字段：
                       - "hypothesis_update": 新的假设列表（字符串列表）
                       - "new_questions": 新的待问问题列表（字符串列表）
                       - "reasoning": 本次分析的理由（字符串）

                    只输出JSON，不要其他文字。
                    """
        try:
            analysis_str = await async_callLLM(prompt)
            import json as json_parser
            analysis = json_parser.loads(analysis_str)
            if "hypothesis_update" in analysis:
                self.patient_record.diagnosis_hypothesis = analysis["hypothesis_update"]
            if "new_questions" in analysis:
                self.patient_record.questions_to_ask = analysis["new_questions"]
            self.patient_record.add_doctor_analysis({
                "input": user_input,
                "analysis": analysis
            })
            self.memory_manager.save_patient_record(self.session_id, asdict(self.patient_record))
        except Exception as e:
            print(f"医生分析失败: {e}")

    def get_communicator_prompt(self, user_input: str, context: str) -> str:
        questions = self.patient_record.questions_to_ask
        questions_text = "\n".join([f"- {q}" for q in questions]) if questions else "暂无特别需要追问的问题。"

        prompt = f"""
                    你是一名温暖、耐心的心理沟通助手，正在与患者对话。你的目标是提供情感支持，并按照医生指示收集信息。

                    当前医生的诊断指示（待问问题）：
                    {questions_text}

                    患者最新发言：{user_input}
                    对话历史摘要：{context}

                    请根据以上信息，生成对患者的回复。要求：
                    1. 如果医生指示中有待问问题，可以自然地融入对话中，以温和的方式询问。
                    2. 表达共情和理解。
                    3. 如果患者表达强烈情绪，优先安抚。
                    4. 回复要自然、温暖，避免生硬。
                    """
        return prompt


class ConfidenceCalculator:

    def __init__(self):
        self.model_available = False
        self.tokenizer = None
        self.model = None
        self.jieba = None
        self._init_models()
        self._vector_cache: Dict[str, List[float]] = {}

    def _init_models(self):
        try:
            import jieba
            self.jieba = jieba
            self.model_available = False
            print("[ConfidenceCalculator] 已跳过本地模型加载，直接使用关键词匹配")
        except ImportError:
            self.jieba = None

    def encode_text(self, text: str) -> Optional[List[float]]:
        if not self.model_available:
            return None
        if text in self._vector_cache:
            return self._vector_cache[text]
        try:
            import torch
            import numpy as np
            tokens = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
            with torch.no_grad():
                emb = self.model(**tokens).last_hidden_state[:, 0, :].numpy()[0]
            emb = emb / np.linalg.norm(emb)
            vector = emb.tolist()
            self._vector_cache[text] = vector
            return vector
        except Exception:
            return None

    def preprocess_text(self, text: str) -> str:
        if self.jieba:
            words = self.jieba.lcut(text)
            stopwords = {'的', '了', '和', '是', '我', '你', '他', '她', '它', '在', '有', '就', '不', '人', '都', '一'}
            words = [w for w in words if w not in stopwords and len(w) > 1]
            return " ".join(words)
        return text

    def cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        import numpy as np
        a = np.array(vec1)
        b = np.array(vec2)
        min_len = min(len(a), len(b))
        a = a[:min_len]
        b = b[:min_len]
        if np.linalg.norm(a) == 0 or np.linalg.norm(b) == 0:
            return 0.0
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


class SuicideAgent:
    def __init__(
            self,
            session_id: str,
            agent_name: str = config.agent_name,
            output_dir: str = config.output_dir,
            memory_dir: str = memory_config.memory_dir,
            use_memory: bool = memory_config.use_memory,
            update_memory: bool = memory_config.update_memory,
            knowledge_base_path: str = "./knowledge",
            preset_intent: str = ""
    ):
        self.preset_intent = preset_intent
        self.agent_name = agent_name
        self.output_dir = Path(output_dir) / agent_name
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.memory_manager = MemoryManager(
            memory_dir=memory_dir,
            output_dir=self.output_dir,
            use_memory=use_memory
        )
        self.use_memory = use_memory
        self.update_memory = update_memory
        self.confidence_calculator = ConfidenceCalculator()

        from rag_skill_tool import create_rag_skill_tool
        self.rag_skill_tool = create_rag_skill_tool(knowledge_base_path or "rag-skill/knowledge")
        self.max_subquestions = config.max_subquestions

        self.current_session_id = f"session_{session_id}"
        self.diagnosis_orchestrator: Optional[DiagnosisOrchestrator] = None

        logger.set_session_id(self.current_session_id)

    def _get_logger(self):
        class SimpleLogger:
            def log_task(self, content, subtitle="", title=""):
                print(f"[{title}] {subtitle}: {str(content)[:100]}...")
        return SimpleLogger()

    def _build_context_prompt(self, user_input: str, emocc_risk: str, fealearn_risk: str) -> str:
        recent_msgs = self.memory_manager.get_recent_history(hours=1, limit=6)
        recent_context = ""
        for msg in recent_msgs:
            role = "用户" if msg["role"] == "user" else "助手"
            recent_context += f"{role}: {msg['content']}\n"

        prompt = f"""
                    任务：自杀危机干预

                    用户当前输入：{user_input}
                    当前发言自杀风险评估（emocc）：{emocc_risk}
                    历史情感自杀风险评估（fealearn）：{fealearn_risk}

                    近期对话历史：
                    {recent_context}

                    请根据以上信息，提供适当的心理支持和危机干预。
                    """
        return prompt

    def _get_emocc_risk(self, user_input: str, images: Optional[List[str]] = None) -> str:
        """获取情绪自杀风险评估，支持图片输入"""
        # 注意：emocc 函数目前仅支持文本，未来可扩展支持图片
        return emocc(user_input)

    def _get_fealearn_risk(self, user_inputs: List[str]) -> str:
        return fealearn(user_inputs)

    def _is_obvious_smalltalk(self, user_input: str) -> bool:
        """极短寒暄直接走闲聊分支，避免走知识检索空结果。"""
        t = (user_input or "").strip()
        if len(t) > 8:
            return False
        small = {
            "你好", "您好", "嗨", "在吗", "谢谢", "多谢", "感谢", "再见", "拜拜",
            "早上好", "晚上好", "午安", "哈喽",
        }
        low = t.lower()
        return t in small or low in {"hi", "hello", "thanks", "bye"}

    async def _classify_intent(self, user_input: str, context: str = "") -> str:
        emergency_keywords = ["想自杀", "不想活了", "想死", "活不下去了", "结束生命"]
        if any(kw in user_input for kw in emergency_keywords):
            return "emotional_support"

        prompt = f"""
                用户输入：{user_input}
                对话上下文：{context}

                请判断用户的意图，只输出以下标签之一：
                - casual_chat：极短的问候、感谢、告别、寒暄（无实质问题）
                - professional_query：包含专业术语、概念解释、诊疗/用药/心理机制、**中医理论或证候病名**等需要检索或专业作答的内容
                - emotional_support：明显的情感痛苦、倾诉、危机表述，需要安抚与共情优先

                示例：用户问「什么是骨痹证」→ professional_query

                输出格式：仅输出标签，不要额外文字。
                """
        try:
            label = await async_callLLM(prompt)
            if not label:
                return "professional_query"
            label = label.strip().lower()
            first_line = label.splitlines()[0].strip().strip("`\"'「」")
            tokens = ("professional_query", "emotional_support", "casual_chat")
            for t in tokens:
                if first_line == t or first_line.startswith(t + " ") or first_line.startswith(t + ","):
                    return t
            # 首词为标签（避免「非casual_chat」子串误匹配）
            first_word = first_line.split()[0] if first_line.split() else ""
            if first_word in tokens:
                return first_word
            return "professional_query"
        except Exception:
            print(f"{user_input} 意图分类失败，默认为 professional_query")
            return "professional_query"

    async def _generate_direct_response(self, user_input: str, context: str,
                                        emocc_risk: str, fealearn_risk: str) -> str:
        prompt = f"""
                用户输入：{user_input}
                风险状态：
                - 当前发言自杀风险：{emocc_risk}
                - 历史情感自杀风险：{fealearn_risk}
                对话历史：
                {context}

                请以温暖友好的语气回应，如果是问候或闲聊，保持自然；若涉及健康议题，可简要科普并建议必要时就医。
                """
        text = await async_callLLM(prompt)
        return text if text else "抱歉，我暂时无法生成回复，请稍后再试。"

    async def _communicator_task(self, user_input: str, context: str, orchestrator: DiagnosisOrchestrator) -> str:
        start_time = time.time()
        prompt = orchestrator.get_communicator_prompt(user_input, context)
        cur_time = time.time()
        print(f"构造沟通prompt:{cur_time - start_time}s")
        return await async_callLLM(prompt)

    async def _doctor_task(self, user_input: str, context: str, orchestrator: DiagnosisOrchestrator):
        await orchestrator.run_doctor(user_input, context)

    async def _decompose_questions(self, query: str, context: str) -> Dict[str, List[str]]:
        decomposition_prompt = f"""
                                用户问题：{query}
                                对话上下文：{context}
                                
                                请将用户的问题分解为两类子问题：
                                
                                1. 用户级子问题：需要回顾历史对话中用户个人情况、情绪变化、过往表述等信息才能回答的问题。这类问题通常涉及用户之前提到过的具体内容（例如症状、经历、感受等）。如果没有这类需求，输出空列表。
                                
                                2. 理论级子问题：需要查询知识库才能回答的问题。这类问题涉及专业知识。
                                
                                输出格式为JSON对象，包含两个键：
                                - "user_level": 字符串列表
                                - "theoretical_level": 字符串列表
                                
                                只输出JSON，不要其他文字。
                                
                                示例：
                                用户问题："我之前的药量需要调整吗？"
                                输出：{{"user_level": ["用户之前提到过哪些药物和剂量？", "用户之前反馈过什么副作用？"], "theoretical_level": ["抗抑郁药的剂量调整原则", "药物副作用处理方法"]}}
                                
                                用户问题："抑郁症一般怎么治疗？"
                                输出：{{"user_level": [], "theoretical_level": ["抑郁症的常见治疗方法", "抑郁症治疗的最新指南"]}}
                                """
        print(decomposition_prompt)
        try:
            import ast
            resp = await async_callLLM(decomposition_prompt)
            print(resp)
            items = ast.literal_eval(resp)
            if isinstance(items, dict):
                user_level = items.get("user_level", [])
                theoretical_level = items.get("theoretical_level", [])
                if isinstance(user_level, list):
                    user_level = [str(item).strip() for item in user_level if item]
                else:
                    user_level = []
                if isinstance(theoretical_level, list):
                    theoretical_level = [str(item).strip() for item in theoretical_level if item]
                else:
                    theoretical_level = []
                return {"user_level": user_level, "theoretical_level": theoretical_level}
            else:
                return {"user_level": [], "theoretical_level": []}
        except Exception as e:
            log_error("_decompose_questions", f"{query}: {str(e)}")
            return {"user_level": [], "theoretical_level": []}

    def _retrieve_user_context(self, user_questions: List[str]) -> List[Dict[str, str]]:
        if not user_questions:
            return []

        history = self.memory_manager.get_history()
        turns = []
        for i in range(len(history)):
            if history[i].get("role") == "user" and i+1 < len(history) and history[i+1].get("role") == "assistant":
                turns.append({
                    "user": history[i].get("content", ""),
                    "assistant": history[i+1].get("content", "")
                })
            elif history[i].get("role") == "user":
                turns.append({"user": history[i].get("content", ""), "assistant": ""})

        matched_turns = []
        for q in user_questions:
            keywords = self._extract_keywords(q)
            for turn in turns:
                user_text = turn["user"]
                assistant_text = turn["assistant"]
                if any(kw in user_text or kw in assistant_text for kw in keywords):
                    if turn not in matched_turns:
                        matched_turns.append(turn)
        return matched_turns

    async def _professional_retrieval(
        self,
        user_input: str,
        context: str,
        attachments: Optional[List[Dict]] = None
    ) -> Dict[str, Union[str, List[Path]]]:
        decomposed = await self._decompose_questions(user_input, context)
        user_questions = decomposed.get("user_level", [])
        theory_questions = decomposed.get("theoretical_level", [])
        theory_questions.append(user_input)

        print(f"用户级问题: {user_questions}")
        print(f"理论级问题: {theory_questions}")

        user_contexts = self._retrieve_user_context(user_questions)
        user_context_str = ""
        if user_contexts:
            user_context_str = "【历史对话中的相关信息】\n"
            for i, turn in enumerate(user_contexts, 1):
                user_context_str += f"片段{i}:\n用户: {turn['user']}\n助手: {turn['assistant']}\n\n"

        all_summaries = []
        all_files = []
        all_rela_texts = []
        for q in theory_questions:
            print(f"检索理论子问题: {q}")
            try:
                result = await self.rag_skill_tool(q)
                if result and isinstance(result, dict):
                    llm_ans = result.get("LLM_ans", "")
                    if llm_ans:
                        all_summaries.append(f"【理论子问题：{q}】\n{llm_ans}")
                    files = result.get("target_file", [])
                    for f in files:
                        if isinstance(f, dict):
                            if f not in all_files:
                                all_files.append(f)
                        elif isinstance(f, Path):
                            file_info = {"name": f.name, "path": str(f)}
                            if file_info not in all_files:
                                all_files.append(file_info)
                    rela_texts = result.get("rela_text", [])
                    if rela_texts:
                        all_rela_texts.extend(rela_texts)
                else:
                    print(f"子问题检索结果格式异常: {result}")
            except Exception as e:
                log_error("_professional_retrieval", f"理论子问题检索失败 {q}: {str(e)}")
                continue

        if not all_summaries and not user_context_str and not attachments:
            return {"LLM_ans": "未找到相关知识，无法回答该问题。", "target_file": list(all_files), "rela_text": all_rela_texts}

        combined_info = ""
        if user_context_str:
            combined_info += user_context_str + "\n"
        if all_summaries:
            combined_info += "【知识库检索到的信息】\n" + "\n\n".join(all_summaries)

        synthesis_prompt = f"""用户原始问题：{user_input}
对话上下文：{context}

以下是检索到的相关信息：
{combined_info}

请基于以上信息，针对用户的原始问题，生成一个温暖、专业、有帮助的最终回答。要求：
1. 如果用户级上下文中有相关历史信息，请合理引用；
2. 结合知识库中的专业知识，不编造信息；
3. 表达理解和共情；
4. 提供具体建议或资源；
5. 如果知识不足，可适当补充常识性建议。

最终回答：
"""

        # 如果有附件，使用支持多模态的 callLLM（同步），否则使用 async_callLLM
        if attachments:
            final_answer = callLLM(synthesis_prompt, attachments=attachments)
            if not final_answer:
                final_answer = "抱歉，生成回答时遇到问题，请稍后再试。"
        else:
            final_answer = await async_callLLM(synthesis_prompt)

        return {"LLM_ans": final_answer, "target_file": list(all_files), "rela_text": all_rela_texts}

    async def _decompose_problem(self, query: str, context: str) -> List[SubQuestion]:
        try:
            pattern = self._retrieve_methodology_for_decomposition(query)
            if pattern:
                templates = pattern.get("question_templates", [])
                if templates:
                    subquestions = []
                    for tmpl in templates:
                        filled = tmpl.replace("{specific_term}", query)
                        subquestions.append(SubQuestion(
                            question=filled,
                            original_query=query,
                            need_knowledge=True
                        ))
                    return subquestions

            decomposition_prompt = f"""
                                    用户输入：{query}
                                    对话上下文：{context}

                                    请将这个问题/倾诉分解为一系列需要查询知识库才能回答的子问题。
                                    考虑以下情况：
                                    - 如果是具体问题，分解为获取相关知识的子问题
                                    - 如果是倾诉，分解为理解情况和提供安慰/建议所需的背景知识
                                    - 有些子问题可能不需要知识库（仅LLM推理即可）

                                    输出格式为JSON列表，每个元素包含：
                                    - "question": 子问题文本
                                    - "need_knowledge": 是否需要查询知识库（true/false）

                                    示例：
                                    [
                                      {{"question": "xx药物的常见副作用有哪些", "need_knowledge": true}},
                                      {{"question": "如何安慰因药物副作用感到不适的人", "need_knowledge": true}},
                                      {{"question": "这种情况下如何调整用药方案", "need_knowledge": false}}
                                    ]
                                    """
            resp = await async_callLLM(decomposition_prompt)
            import ast
            items = ast.literal_eval(resp)
            return [
                SubQuestion(
                    question=item["question"],
                    original_query=query,
                    need_knowledge=item.get("need_knowledge", True)
                )
                for item in items
            ]
        except Exception as e:
            log_error("_decompose_problem", f"{query}: {str(e)}")
            print(f"{query}:{e}")
            return [SubQuestion(question=query, original_query=query)]

    def _retrieve_methodology_for_decomposition(self, query: str) -> Optional[Dict]:
        methodology = self.memory_manager.get_all_methodology()
        if not methodology:
            return None

        processed_query = self.confidence_calculator.preprocess_text(query)
        query_vector = self.confidence_calculator.encode_text(processed_query)

        best_pattern = None
        best_sim = 0.0
        threshold = 0.7

        for key, pattern in methodology.items():
            if not isinstance(pattern, dict):
                continue
            pattern_text = None
            if "original_query" in pattern:
                pattern_text = pattern["original_query"]
            elif "keywords" in pattern and pattern["keywords"]:
                pattern_text = " ".join(pattern["keywords"])
            else:
                continue

            pattern_text = self.confidence_calculator.preprocess_text(pattern_text)
            pattern_vector = self.confidence_calculator.encode_text(pattern_text)
            if pattern_vector is not None and query_vector is not None:
                sim = self.confidence_calculator.cosine_similarity(query_vector, pattern_vector)
                if sim > best_sim and sim >= threshold:
                    best_sim = sim
                    best_pattern = pattern

        return best_pattern

    async def _reformulate_subquestion(self, subq: SubQuestion, failure_reasons: List[str]) -> List[SubQuestion]:
        prompt = f"""
                    原始子问题：{subq.question}
                    失败原因：{', '.join(failure_reasons)}

                    请重新构造这个查询，可以考虑：
                    1. 分解为更具体的子问题
                    2. 从不同角度提问
                    3. 使用更通用的术语

                    输出格式为JSON列表，每个元素包含：
                    - "question": 新子问题文本
                    - "strategy": 重构策略（分解/转换角度/泛化）

                    示例：
                    [
                      {{"question": "xx药物的具体成分是什么", "strategy": "分解"}},
                      {{"question": "药物苦味可能的缓解方法", "strategy": "转换角度"}}
                    ]
                    """
        try:
            import ast
            resp = await async_callLLM(prompt)
            items = ast.literal_eval(resp)
            new_qs = []
            for item in items:
                new_qs.append(SubQuestion(
                    question=item["question"],
                    original_query=subq.original_query,
                    depth=subq.depth + 1,
                    need_knowledge=True
                ))
            return new_qs
        except Exception:
            return []

    async def _multi_stage_retrieval(self, query: str, context: str) -> Dict[str, List[str]]:
        direct_results = await self.rag_skill_tool(query)
        if direct_results:
            return {query: direct_results}

        results = {}
        visited = set()
        queue = []

        initial_subqs = await self._decompose_problem(query, context)
        queue.extend(initial_subqs)

        while queue and len(results) < self.max_subquestions:
            subq = queue.pop(0)

            q_hash = hash(subq.question)
            if q_hash in visited:
                continue
            visited.add(q_hash)

            if not subq.need_knowledge:
                results[subq.question] = []
                continue

            sub_results = await self.rag_skill_tool(subq.question)

            if sub_results:
                results[subq.question] = sub_results
                print(f"{subq.question[:40]}获得 {len(sub_results)} 条结果")
            else:
                if subq.retrieval_attempts < subq.max_attempts and subq.depth < 2:
                    subq.retrieval_attempts += 1
                    reasons = ["无结果"]
                    new_qs = await self._reformulate_subquestion(subq, reasons)
                    if new_qs:
                        queue.extend(new_qs)
                        print(f"重构子问题{subq.question}")
                else:
                    print(f"{subq.question[:40]}已达重试上限")

        return results

    async def _generate_answer(
            self,
            query: str,
            context: str,
            retrieval_results: Dict[str, List[str]]
    ) -> str:
        retrieved_knowledge = ""
        if retrieval_results:
            retrieved_knowledge = "检索到的相关知识：\n"
            for q, results in retrieval_results.items():
                if results:
                    content = "\n".join(results[:2])
                    retrieved_knowledge += f"问题：{q}\n答案：{content}\n\n"

        prompt = f"""
                用户问题：{query}

                对话上下文：
                {context}

                {retrieved_knowledge}

                请基于以上信息，生成一个温暖、专业、有帮助的回答：
                1. 表达理解和共情
                2. 结合检索到的知识提供具体支持
                3. 引导积极应对
                4. 必要时提供专业帮助资源
                """
        return await async_callLLM(prompt)

    async def _update_memories(
            self,
            user_input: str,
            response: str,
            retrieval_results: Dict[str, List[str]],
            emocc_risk: str,
            fealearn_risk: str
    ):
        if not self.use_memory or not self.update_memory:
            return
        pass

    def _extract_keywords(self, text: str) -> List[str]:
        if self.confidence_calculator.jieba:
            words = self.confidence_calculator.jieba.lcut(text)
            stopwords = {'的', '了', '和', '是', '我', '你', '他', '她', '它', '在', '有', '就', '不'}
            return [w for w in words if w not in stopwords and len(w) > 1][:10]
        return [w for w in text.split() if len(w) > 1][:10]

    def _abstract_template(self, specific_question: str, original_query: str) -> Optional[str]:
        words = self._extract_keywords(original_query)
        template = specific_question
        replaced = False
        for w in words:
            if w in template:
                template = template.replace(w, "{specific_term}")
                replaced = True
        return template if replaced else None

    async def process_message(
        self,
        user_input: str,
        attachments: Optional[List[Dict]] = None
    ) -> Dict[str, Union[str, List[Path]]]:
        """处理用户消息，支持多模态附件

        Args:
            user_input: 用户输入文本
            attachments: 附件列表 [{"path": "...", "name": "...", "type": "..."}]
        """
        try:
            # 获取附件中的图片（用于情绪分析等预处理）
            image_paths = []
            if attachments:
                for att in attachments:
                    att_path = att.get("path", "")
                    if att_path:
                        ext = os.path.splitext(att_path)[1].lower()
                        if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                            image_paths.append(att_path)

            # 风险评估（如果有图片附件，可以传入图片路径）
            emocc_risk = self._get_emocc_risk(user_input, images=image_paths if image_paths else None)
            recent_user_inputs = self.memory_manager.get_recent_user_inputs(hours=24, limit=100)
            fealearn_risk = self._get_fealearn_risk(recent_user_inputs)

            context = self._build_context_prompt(user_input, emocc_risk, fealearn_risk)

            if self.preset_intent == "" or self.preset_intent not in ["professional_query", "emotional_support", "casual_chat"]:
                if self._is_obvious_smalltalk(user_input):
                    intent = "casual_chat"
                    print(f"{user_input} 意图识别: {intent} (简短寒暄)")
                else:
                    intent = await self._classify_intent(user_input, context)
                    print(f"{user_input} 意图识别: {intent}")
            else:
                intent = self.preset_intent

            if intent == "professional_query":
                result = await self._professional_retrieval(user_input, context, attachments=attachments)
                response = result["LLM_ans"]
                target_files = result["target_file"]
                rela_text = result.get("rela_text", [])
                
                # 更新思维导图
                cur_mind_map = self.memory_manager.get_mind_map()
                from rag_skill_tool import RAGSkillTool
                updated_mind_map = await RAGSkillTool.update_mind_map(cur_mind_map, rela_text)
                # rag_skill_tool 返回 {"mindMap": {...}}，需要提取内部对象
                inner_mind_map = updated_mind_map.get("mindMap", updated_mind_map)
                self.memory_manager.save_mind_map(inner_mind_map)

                self.memory_manager.add_turn(user_input, response)
                log_conversation(user_input, response, emocc_risk, fealearn_risk, intent)
                return {
                    "LLM_ans": response,
                    "target_files": target_files,
                    "mind_map": inner_mind_map
                }

            elif intent == "emotional_support":
                if self.diagnosis_orchestrator is None:
                    self.diagnosis_orchestrator = DiagnosisOrchestrator(self.memory_manager, self.current_session_id)
                start_time = time.time()
                doctor_task = asyncio.create_task(
                    self._doctor_task(user_input, context, self.diagnosis_orchestrator)
                )
                communicator_task = asyncio.create_task(
                    self._communicator_task(user_input, context, self.diagnosis_orchestrator)
                )
                cur_time = time.time()
                print(f"创建线程耗时:{cur_time - start_time}s")

                cur_time = time.time()
                response = await communicator_task
                print(f"回复耗时:{cur_time - start_time}s")

                def doctor_task_callback(fut):
                    try:
                        fut.result()
                    except Exception as e:
                        log_error("doctor_task", str(e))

                doctor_task.add_done_callback(doctor_task_callback)

                self.memory_manager.add_turn(user_input, response)
                log_conversation(user_input, response, emocc_risk, fealearn_risk, intent)
                return {"LLM_ans": response, "target_file": []}

            else:  # casual_chat
                response = await self._generate_direct_response(user_input, context, emocc_risk, fealearn_risk)
                self.memory_manager.add_turn(user_input, response)
                log_conversation(user_input, response, emocc_risk, fealearn_risk, intent)
                return {"LLM_ans": response, "target_file": []}

        except Exception as e:
            log_error("process_message", str(e))
            raise

    async def stream_process_message(
        self,
        user_input: str,
        attachments: Optional[List[Dict]] = None
    ) -> AsyncIterator[str]:
        """
        流式版本 process_message：实时 yield LLM 输出片段。
        支持多模态附件（图片/PDF/DOCX等直接传给模型原生理解）。
        当有附件时，使用非流式调用（因为多模态流式可能不稳定）。
        """
        try:
            # 获取附件中的图片
            image_paths = []
            if attachments:
                for att in attachments:
                    att_path = att.get("path", "")
                    if att_path:
                        ext = os.path.splitext(att_path)[1].lower()
                        if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                            image_paths.append(att_path)

            emocc_risk = self._get_emocc_risk(user_input, images=image_paths if image_paths else None)
            recent_user_inputs = self.memory_manager.get_recent_user_inputs(hours=24, limit=100)
            fealearn_risk = self._get_fealearn_risk(recent_user_inputs)
            context = self._build_context_prompt(user_input, emocc_risk, fealearn_risk)

            if self.preset_intent == "" or self.preset_intent not in ["professional_query", "emotional_support", "casual_chat"]:
                if self._is_obvious_smalltalk(user_input):
                    intent = "casual_chat"
                else:
                    intent = await self._classify_intent(user_input, context)
            else:
                intent = self.preset_intent

            # 如果有附件，统一使用 professional_query 路径（非流式）
            has_attachments = attachments and len(attachments) > 0
            if has_attachments:
                intent = "professional_query"

            if intent == "professional_query":
                # 流式版本：RAG 检索完成后，使用流式 LLM 直接 yield tokens
                response_chunks = []
                try:
                    # RAG 检索阶段（保持原有逻辑）
                    decomposed = await self._decompose_questions(user_input, context)
                    user_questions = decomposed.get("user_level", [])
                    theory_questions = decomposed.get("theoretical_level", [])
                    theory_questions.append(user_input)

                    user_contexts = self._retrieve_user_context(user_questions)
                    user_context_str = ""
                    if user_contexts:
                        user_context_str = "【历史对话中的相关信息】\n"
                        for i, turn in enumerate(user_contexts, 1):
                            user_context_str += f"片段{i}:\n用户: {turn['user']}\n助手: {turn['assistant']}\n\n"

                    all_summaries = []
                    all_files = []
                    all_rela_texts = []
                    for q in theory_questions:
                        try:
                            result = await self.rag_skill_tool(q)
                            if result and isinstance(result, dict):
                                llm_ans = result.get("LLM_ans", "")
                                if llm_ans:
                                    all_summaries.append(f"【理论子问题：{q}】\n{llm_ans}")
                                files = result.get("target_file", [])
                                for f in files:
                                    if isinstance(f, dict):
                                        if f not in all_files:
                                            all_files.append(f)
                                    elif isinstance(f, Path):
                                        file_info = {"name": f.name, "path": str(f)}
                                        if file_info not in all_files:
                                            all_files.append(file_info)
                                rela_texts = result.get("rela_text", [])
                                if rela_texts:
                                    all_rela_texts.extend(rela_texts)
                            else:
                                print(f"子问题检索结果格式异常: {result}")
                        except Exception as e:
                            log_error("_professional_retrieval", f"理论子问题检索失败 {q}: {str(e)}")
                            print(f"[RAG 检索异常] 子问题: {q[:30]}... 错误: {str(e)}")
                            continue

                    # 更新思维导图
                    cur_mind_map = self.memory_manager.get_mind_map()
                    try:
                        from rag_skill_tool import RAGSkillTool
                        updated_mind_map = await RAGSkillTool.update_mind_map(cur_mind_map, all_rela_texts)
                        # rag_skill_tool 返回 {"mindMap": {...}}，需要提取内部对象
                        inner_mind_map = updated_mind_map.get("mindMap", updated_mind_map)
                        self.memory_manager.save_mind_map(inner_mind_map)
                    except Exception as e:
                        print(f"[stream_process_message] 思维导图更新异常: {str(e)}")
                        inner_mind_map = cur_mind_map

                    if not all_summaries and not user_context_str and not attachments:
                        error_msg = "未找到相关知识，无法回答该问题。"
                        for chunk in _chunk_text(error_msg):
                            yield chunk
                        return

                    # 发送 RAG 检索来源事件（供前端实时更新来源列表）
                    if all_files:
                        # 将文件路径转换为前端期望的格式
                        rag_sources = []
                        for f in all_files:
                            if isinstance(f, dict):
                                name = f.get("name", "")
                                path = f.get("path", "")
                                # 根据文件后缀判断类型
                                ext = name.split(".")[-1].lower() if name else "md"
                                type_map = {"pdf": "pdf", "docx": "word", "doc": "word", "md": "md", "txt": "txt"}
                                file_type = type_map.get(ext, "txt")
                                # 从路径中提取 topic 和 subTopic（路径格式：knowledge/topic/subTopic/file.md）
                                topic = ""
                                sub_topic = ""
                                if path:
                                    parts = path.replace("\\", "/").split("/")
                                    # knowledge/topic/subTopic/file.md -> parts[-2] 是 subTopic, parts[-3] 是 topic
                                    if len(parts) >= 3:
                                        sub_topic = parts[-2]
                                        topic = parts[-3]
                                rag_sources.append({
                                    "id": name,  # 使用文件名作为 id
                                    "title": name,
                                    "type": file_type,
                                    "topic": topic,
                                    "subTopic": sub_topic,
                                })
                        if rag_sources:
                            # 返回字符串，前端 JSON 解析
                            yield json.dumps({'type': 'rag_sources', 'sources': rag_sources})

                    # 发送思维导图更新事件（供前端实时更新概念图）
                    # rag_skill_tool 返回 {"mindMap": {...}}，需要提取内部对象
                    if updated_mind_map:
                        inner_mind_map = updated_mind_map.get("mindMap", updated_mind_map)
                        yield json.dumps({'type': 'mind_map', 'mindMap': inner_mind_map})

                    # 发送证据引用片段（供前端显示引用详情）
                    if all_rela_texts:
                        # 截取每段前200字作为证据摘要
                        evidence_snippets = [
                            {
                                "content": text[:200] + "..." if len(text) > 200 else text,
                                "source": f.get("name", "") if isinstance(f, dict) else str(f),
                            }
                            for text, f in zip(all_rela_texts[:5], all_files[:5])
                        ]
                        yield json.dumps({'type': 'rag_evidence', 'evidence': evidence_snippets})

                    # 发送前置知识术语（供前端显示相关概念解释）
                    # 从 all_summaries 和 all_files 中提取关键术语
                    if all_files:
                        # 提取文件名中的关键概念作为术语
                        terms = []
                        for f in all_files[:5]:
                            if isinstance(f, dict):
                                name = f.get("name", "")
                                # 提取文件名中的主题作为术语
                                if name:
                                    # 移除扩展名
                                    term_name = name.replace(".txt", "").replace(".md", "")
                                    if term_name and term_name not in terms:
                                        terms.append(term_name)
                        if terms:
                            yield json.dumps({'type': 'pre_knowledge', 'terms': terms})

                    # 发送上下文数据来源（供前端显示当前对话使用的数据范围）
                    if rag_sources or all_files:
                        context_srcs = []
                        if rag_sources:
                            for src in rag_sources[:3]:
                                title = src.get("title", "")
                                topic = src.get("topic", "")
                                if title:
                                    context_srcs.append(f"知识库: {topic}/{title}...")
                        if not context_srcs:
                            context_srcs.append("知识库: 心理危机、抑郁症状、干预路径...")
                        yield json.dumps({'type': 'context_sources', 'sources': context_srcs})

                    combined_info = ""
                    if user_context_str:
                        combined_info += user_context_str + "\n"
                    if all_summaries:
                        combined_info += "【知识库检索到的信息】\n" + "\n\n".join(all_summaries)

                    synthesis_prompt = f"""用户原始问题：{user_input}
对话上下文：{context}

以下是检索到的相关信息：
{combined_info}

请基于以上信息，针对用户的原始问题，生成一个温暖、专业、有帮助的最终回答。要求：
1. 如果用户级上下文中有相关历史信息，请合理引用；
2. 结合知识库中的专业知识，不编造信息；
3. 表达理解和共情；
4. 提供具体建议或资源；
5. 如果知识不足，可适当补充常识性建议。

最终回答：
"""
                    # 如果有附件，使用多模态流式调用
                    if attachments:
                        full_response = ""
                        print(f"[stream_process_message] 开始多模态流式响应")
                        try:
                            async for token in async_stream_callLLM(
                                synthesis_prompt,
                                images=image_paths if image_paths else None,
                                attachments=attachments
                            ):
                                full_response += token
                                yield token
                            print(f"[stream_process_message] 多模态流式响应完成，长度: {len(full_response)}")
                        except Exception as e:
                            print(f"[stream_process_message] 多模态流式响应异常: {str(e)}")
                            # 降级：尝试非流式调用
                            print(f"[stream_process_message] 降级为非流式调用")
                            try:
                                full_response = callLLM(synthesis_prompt, attachments=attachments)
                                for chunk in _chunk_text(full_response, size=8):
                                    yield chunk
                            except Exception as fallback_error:
                                print(f"[stream_process_message] 降级调用也失败: {str(fallback_error)}")
                                error_msg = "抱歉，生成回答时遇到问题，请稍后再试。"
                                for chunk in _chunk_text(error_msg):
                                    yield chunk
                    else:
                        # 使用流式 LLM 调用
                        full_response = ""
                        print(f"[stream_process_message] 开始纯文本流式响应")
                        try:
                            async for token in async_stream_callLLM([
                                {"role": "system", "content": "你是心理健康与心身医学领域的专业辅助助手，擅长心理学与中医学常识性科普。"},
                                {"role": "user", "content": synthesis_prompt}
                            ]):
                                full_response += token
                                yield token
                            print(f"[stream_process_message] 纯文本流式响应完成，长度: {len(full_response)}")
                        except Exception as e:
                            print(f"[stream_process_message] 纯文本流式响应异常: {str(e)}")
                            # 降级：尝试非流式调用
                            print(f"[stream_process_message] 降级为非流式调用")
                            try:
                                full_response = callLLM(synthesis_prompt)
                                for chunk in _chunk_text(full_response, size=8):
                                    yield chunk
                            except Exception as fallback_error:
                                print(f"[stream_process_message] 降级调用也失败: {str(fallback_error)}")
                                error_msg = "抱歉，生成回答时遇到问题，请稍后再试。"
                                for chunk in _chunk_text(error_msg):
                                    yield chunk

                    try:
                        self.memory_manager.add_turn(user_input, full_response)
                    except Exception as e:
                        print(f"[stream_process_message] memory_manager.add_turn 异常: {str(e)}")
                    log_conversation(user_input, full_response, emocc_risk, fealearn_risk, intent)
                except Exception as e:
                    log_error("stream_professional_retrieval", str(e))
                    error_msg = "抱歉，生成回答时遇到问题，请稍后再试。"
                    for chunk in _chunk_text(error_msg):
                        yield chunk
                return

            elif intent == "emotional_support":
                if self.diagnosis_orchestrator is None:
                    self.diagnosis_orchestrator = DiagnosisOrchestrator(self.memory_manager, self.current_session_id)
                communicator_task = asyncio.create_task(
                    self._communicator_task(user_input, context, self.diagnosis_orchestrator)
                )
                try:
                    response = await communicator_task
                except Exception as e:
                    log_error("emotional_support", f"沟通任务失败: {str(e)}")
                    response = "抱歉，我暂时无法回复，请稍后再试。"
                # 使用慢速分块输出，每 4 字符延迟 60ms，实现逐字显示效果
                try:
                    async for chunk in _chunk_text_slow(response, size=4, delay_ms=60):
                        yield chunk
                except Exception as e:
                    log_error("_chunk_text_slow", str(e))
                    # 降级：快速输出
                    for chunk in _chunk_text(response, size=8):
                        yield chunk
                try:
                    self.memory_manager.add_turn(user_input, response)
                except Exception as e:
                    print(f"[stream_process_message] memory_manager.add_turn 异常 (emotional_support): {str(e)}")
                log_conversation(user_input, response, emocc_risk, fealearn_risk, intent)
                return

            else:  # casual_chat
                response = await self._generate_direct_response(user_input, context, emocc_risk, fealearn_risk)
                # 使用慢速分块输出，每 4 字符延迟 60ms，实现逐字显示效果
                try:
                    async for chunk in _chunk_text_slow(response, size=4, delay_ms=60):
                        yield chunk
                except Exception as e:
                    log_error("_chunk_text_slow", str(e))
                    # 降级：快速输出
                    for chunk in _chunk_text(response, size=8):
                        yield chunk
                try:
                    self.memory_manager.add_turn(user_input, response)
                except Exception as e:
                    print(f"[stream_process_message] memory_manager.add_turn 异常 (casual_chat): {str(e)}")
                log_conversation(user_input, response, emocc_risk, fealearn_risk, intent)
                return

        except Exception as e:
            import traceback
            log_error("stream_process_message", str(e))
            print(f"[stream_process_message] 异常: {str(e)}")
            print(f"[stream_process_message] 堆栈: {traceback.format_exc()}")
            # 确保 yield 至少一个错误消息
            error_msg = "抱歉，发生了错误，请稍后重试。"
            for chunk in _chunk_text(error_msg, size=8):
                yield chunk


async def _chunk_text(text: str, size: int = 8) -> AsyncIterator[str]:
    """将文本按固定字数拆分为异步片段。"""
    for i in range(0, len(text), size):
        yield text[i:i + size]


async def _chunk_text_slow(text: str, size: int = 4, delay_ms: int = 50) -> AsyncIterator[str]:
    """将文本按固定字数拆分为异步片段，每个片段后添加延迟以实现流畅的逐字显示效果。"""
    for i in range(0, len(text), size):
        await asyncio.sleep(delay_ms / 1000.0)
        yield text[i:i + size]
