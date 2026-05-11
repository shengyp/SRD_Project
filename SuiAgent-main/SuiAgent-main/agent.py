import json
import time
import asyncio
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor

from config import config, memory_config
from LLM import callLLM
from module import emocc, fealearn

from rag_skill_tool import RAGSkillTool
from MemoryManagerV2 import MemoryManagerV2, create_async_summary_agent

executor = ThreadPoolExecutor(max_workers=4)


class DialoguePlanner:
    def __init__(self, callLLM_func, executor, knowledge_base_path: str = "rag-skill/knowledge"):
        self.callLLM = callLLM_func
        self.executor = executor
        self.knowledge_base_path = Path(knowledge_base_path)

    def _get_knowledge_overview(self) -> str:
        index_path = self.knowledge_base_path / "data_structure.md"
        if not index_path.exists():
            print(f"知识库索引文件不存在: {index_path}")
            return "知识库包含：抑郁症治疗指南、药物手册、认知行为疗法、情绪调节技巧、危机干预方案、安全计划模板等。"

        try:
            with open(index_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"读取知识库索引失败: {e}")
            return "知识库结构未知，请仅根据用户问题搜索。"

        return content

    async def plan(self, user_input, risk, mem_ctx):
        prompt = self._build_planner_prompt(user_input, risk, mem_ctx)
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(self.executor, self.callLLM, prompt)
        print(response + "\n")
        return self._parse_plan(response)

    def _build_planner_prompt(self, user_input, risk, mem_ctx):
        knowledge_overview = self._get_knowledge_overview()

        return f"""
                你是一位自杀危机干预对话规划专家。当前对话目标是通过苏格拉底式提问逐步帮助用户，同时提供有研究依据的信息。
                
                【背景信息】
                - 用户输入：{user_input}
                - 哥伦比亚自杀风险等级：{risk}
                - 当前对话阶段：{mem_ctx.get('dialogue_phase', 'OPENING')}
                - 已探索主题：{', '.join(mem_ctx.get('explored_topics', []))}
                - 待追问节点：{', '.join(mem_ctx.get('pending_socratic_nodes', []))}
                - 用户关键事实：{json.dumps(mem_ctx.get('user_profile_facts', {}), ensure_ascii=False)}
                - 最近对话内容：{mem_ctx.get('history', '')}
                
                【知识库概览】
                {knowledge_overview}
                
                【任务】
                请制定一个行动计划（JSON格式），包含：
                1. "retrieval_queries"：你需要让RAG工具在后台文献数据中搜索的内容（数组），如果没有需要搜索的，则返回一个空数组“[]”。
                   每个查询包含：
                   - "type": 类型，可选 "cognitive"(回答用户问题)、"emotional_support"(安抚技巧)、"safety_plan"(安全干预)、"knowledge"(专业知识)
                   - "query": 具体搜索关键词或问题
                   - "priority": 数字，1最高
                2. "dialogue_strategy"：
                   - "phase": 下一轮对话阶段，可选 EXPLORING_EMOTION / OFFERING_EVIDENCE / GUIDING_ACTION / CLOSING
                   - "tone": 语气，如 empathic, supportive, firm
                   - "socratic_focus": 引导用户思考的具体方向（1句话）
                   - "pending_nodes": 打算下一步追问的主题列表（1-3个）
                3. "interruption":
                   -布尔值，默认 false。若用户输入明显是普通问题（如测试、询问历史、闲聊、与心理咨询、情感风险干预无关的元对话），则设为 true。
                
                【普通问答判定规则】（最高优先级）
                如果用户的当前输入明显与自杀危机干预进程无关，例如：
                - 对系统本身的测试
                - 闲聊、打招呼、询问你的功能
                - 一般性问题（如“今天天气怎么样”，除非与风险相关）
                则：
                1. 必须设置 "interruption": true。
                2. "retrieval_queries"：
                   - 若用户问题需要文献支持（如“抑郁症有什么症状”），可包含 type="knowledge" 的查询。
                   - 若为纯闲聊或测试（“你叫什么名字”），则为空数组 []。
                3. "dialogue_strategy" 中：
                   - "phase" 必须原样返回当前阶段：{mem_ctx.get('dialogue_phase', 'OPENING')}
                   - "pending_nodes" 必须原样返回当前待追问节点：{json.dumps(mem_ctx.get('pending_socratic_nodes', []))}
                   - "socratic_focus" 填写：“直接回应用户问题，随后自然引导回未完成的安全任务”
                   - "tone" 维持传入语气或设为 "supportive"
                
                【约束】
                - 如果风险为“高”或“极高”，必须包含至少一个 type=safety_plan 的查询。
                - 查询应使用知识库中可能出现的简短概念，如：“抑郁表现 兴趣下降”“药物副作用 头晕”“危机干预步骤”。
                - 禁止将多个专业术语拼接成一个长查询。
                - 只输出 JSON，无其他文字。
                """

    def _parse_plan(self, text: str) -> Dict:
        try:
            text = text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            return json.loads(text)
        except Exception as e:
            print(f"Failed to parse planner output: {e}")
            return {
                "retrieval_queries": [],
                "dialogue_strategy": {
                    "phase": "EXPLORING_EMOTION",
                    "tone": "empathic",
                    "socratic_focus": "了解用户当前感受和需求",
                    "pending_nodes": []
                }
            }


class ResponseGenerator:
    def __init__(self, callLLM_func, executor):
        self.callLLM = callLLM_func
        self.executor = executor

    async def generate(
            self,
            user_input: str,
            risk: str,
            strategy: Dict[str, Any],
            triples: List[Dict],
            history: str
    ) -> str:
        prompt = self._build_generation_prompt(user_input, risk, strategy, triples, history)
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(self.executor, self.callLLM, prompt)
        return response.strip()

    def _build_generation_prompt(self, user_input, risk, strategy, triples, history):
        triple_text = "\n".join(
            f"- {t.get('subject', '')} {t.get('predicate', '')} {t.get('object', '')} (来源: {t.get('source', '')})"
            for t in triples[:5]
        ) if triples else "暂无文献证据"

        print(f"history:{json.dumps(history, indent=2, ensure_ascii=False)}")

        interruption = strategy.get("interruption", False)
        if interruption:
            pending = strategy.get("pending_nodes", [])
            pending_text = "、".join(pending) if pending else "继续关注您的安全"
            return f"""
                    【用户输入】{user_input}
                    【近期对话摘要】{history}
                    
                    当前是一次普通问答，用户的问题与危机干预主线无关。请按以下方式生成回复：
                    1. 用1-2句话自然、简洁地回答用户本次问题。如果提供的证据可用于回答，可以引用；否则直接回答或诚实告知不了解。
                    2. 紧接着，用温和的语气自然过渡，提醒用户之前尚未完成的安全对话，例如：“对了，关于之前提到的……我想再问问你，{pending_text}，你愿意聊聊吗？”
                    3. 整体语气保持 {strategy.get('tone', 'supportive')}，不要生硬打断。
                    """
        return f"""
                你是一位专业的自杀危机干预人员，正在与用户进行苏格拉底引导式对话。
                
                【用户输入】{user_input}
                【当前风险等级】{risk}
                【对话策略】
                - 阶段：{strategy.get('phase', '')}
                - 语气：{strategy.get('tone', '')}
                - 引导方向：{strategy.get('socratic_focus', '')}
                
                【可引用的文献证据】
                {triple_text}
                
                【近期对话摘要】{history}
                
                请生成一个回答，严格按照以下三部分结构（不要标注数字序号，自然衔接）：
                1. 共情/确认 —— 用1-2句话复述用户的感受，表达理解。
                2. 基于证据的回应 —— 根据检索到的证据，提供1-2条有用信息或建议（如果有证据）。如果证据不足，可以如实说并建议专业帮助。
                3. 引导式追问 —— 根据对话策略中的引导方向，提出一个开放但聚焦的问题，鼓励用户进一步探索自己的情况。
                
                语气要求：{strategy.get('tone', 'empathic')}
                风险越高，越要温和并优先确保安全。不要使用诊断术语。
                只输出最终回答，不要附加解释。
                """


class SuicideAgent:
    def __init__(
            self,
            session_id: str,
            agent_name: str = config.agent_name,
            output_dir: str = config.output_dir,
            memory_dir: str = memory_config.memory_dir,
            knowledge_base_path: str = "rag-skill/knowledge",
            short_term_limit: int = 20,
            token_limit: int = 4000,
    ):
        self.agent_name = agent_name
        self.output_dir = Path(output_dir) / agent_name
        self.output_dir.mkdir(parents=True, exist_ok=True)

        async_summary_agent = create_async_summary_agent(callLLM, executor)

        self.memory = MemoryManagerV2(
            memory_dir=memory_dir,
            output_dir=self.output_dir,
            short_term_limit=short_term_limit,
            token_limit=token_limit,
            summary_agent=async_summary_agent
        )

        self.planner = DialoguePlanner(callLLM, executor)
        self.response_gen = ResponseGenerator(callLLM, executor)
        self.rag_tool = RAGSkillTool(knowledge_base_path)

        self.current_session_id = f"session_{session_id}"

    # --------------------------------------------------------------------------
    # 风险分类（简化版，可扩展为完整哥伦比亚分类）
    # --------------------------------------------------------------------------
    def _classify_risk(self, emocc_risk: str, fealearn_risk: str) -> str:
        """将两个风险模型结果合并为一个等级"""
        # 假设 emocc/fealearn 返回类似 "高风险"/"中风险"/"低风险" 或 "0.8"/"0.2"
        # 此处做简单映射，实际可细化
        high_keywords = ["高风险", "高", "high"]
        if any(k in str(emocc_risk).lower() for k in high_keywords) or \
                any(k in str(fealearn_risk).lower() for k in high_keywords):
            return "高"
        medium_keywords = ["中风险", "中", "medium"]
        if any(k in str(emocc_risk).lower() for k in medium_keywords) or \
                any(k in str(fealearn_risk).lower() for k in medium_keywords):
            return "中"
        return "低"

    async def process_message(self, user_input: str) -> Dict[str, Any]:
        try:
            loop = asyncio.get_running_loop()
            emocc_risk = await loop.run_in_executor(executor, emocc, user_input)
            recent_inputs = self.memory.get_recent_user_inputs(hours=24, limit=100)
            fealearn_risk = await loop.run_in_executor(executor, fealearn, recent_inputs)
            risk_classification = self._classify_risk(emocc_risk, fealearn_risk)
            self.memory.add_turn("user", user_input, risk=risk_classification)

            mem_ctx = self.memory.get_planner_context()

            plan = await self.planner.plan(user_input, risk_classification, mem_ctx)
            self.memory.update_last_plan(plan)

            is_interruption = plan["dialogue_strategy"].get("interruption", False)

            if not is_interruption:
                self.memory.update_phase(plan["dialogue_strategy"]["phase"])
                self.memory.update_explored_topics(
                    [plan["dialogue_strategy"]["socratic_focus"]]
                )
                self.memory.update_pending_nodes(
                    plan["dialogue_strategy"].get("pending_nodes", [])
                )

            retrieval_queries = sorted(
                plan.get("retrieval_queries", []),
                key=lambda x: x.get("priority", 1)
            )

            evidence_items = []
            target_files_info = []

            def _sync_retrieve(query: str):
                try:
                    return asyncio.run(self.rag_tool.retrieve(query))
                except Exception as e:
                    print(f"RAG查询失败 [{query}]: {e}")
                    return {
                        "LLM_ans": "未在所有目标文件中找到相关信息",
                        "target_file": [],
                        "rela_text": []
                    }

            async def _run_single_retrieve(rq: dict, loop: asyncio.AbstractEventLoop):
                print(f"{rq.get('query', '')}启动并行rag")
                result = await loop.run_in_executor(executor, _sync_retrieve, rq["query"])
                return result

            tasks = [_run_single_retrieve(rq, loop) for rq in retrieval_queries]
            results = await asyncio.gather(*tasks, return_exceptions=False)

            for result in results:
                if not result:
                    continue
                file_info = result.get("target_file", [])
                current_file = file_info[0] if file_info else None
                rela_text = result.get("rela_text", [])
                for text in rela_text:
                    evidence_items.append({
                        "rela_text": text,
                        "file": current_file
                    })
                if current_file and not any(f["path"] == current_file["path"] for f in target_files_info):
                    target_files_info.append(current_file)

            # claims = await self._generate_claims(user_input, evidence_items)

            doc_map = {}
            for idx, file_info in enumerate(target_files_info):
                doc_id = f"doc_{idx + 1:03d}"
                doc_map[file_info["path"]] = doc_id

            evidence_objects = []
            for i, item in enumerate(evidence_items):
                file = item["file"]
                if file:
                    file_name = file["name"]
                    title = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
                    ext = file_name.rsplit(".", 1)[-1] if "." in file_name else ""
                    doc_id = doc_map.get(file["path"], "doc_000")
                else:
                    title, ext, doc_id = "未知来源", "", "doc_000"

                evidence_objects.append({
                    "id": f"evidence_{i + 1:03d}",
                    "title": title,
                    "sourceType": ext,
                    "rela_text": item["rela_text"][:500],
                    # "claim": claims[i] if i < len(claims) else "相关证据片段",
                    "claim":"",
                    "docId": doc_id
                })

            references = []
            for file_info in target_files_info:
                path = file_info["path"]
                name = file_info["name"]
                title = name.rsplit(".", 1)[0] if "." in name else name
                ext = name.rsplit(".", 1)[-1] if "." in name else ""
                references.append({
                    "id": doc_map[path],
                    "title": title,
                    "type": ext
                })

            all_fragments = [item["rela_text"] for item in evidence_items]
            all_triples = self.rag_tool._extract_triples(all_fragments,user_input)

            response = await self.response_gen.generate(
                user_input=user_input,
                risk=risk_classification,
                strategy=plan["dialogue_strategy"],
                triples=all_triples,
                history=mem_ctx.get("history", "")
            )

            self.memory.add_turn("assistant", response, triples=all_triples)

            return {
                "content": response,
                "references": references,
                "ragContext.mindMap": all_triples,
                "ragContext.evidence": evidence_objects
            }

        except Exception as e:
            print("process_message:", str(e))
            return {
                "content": "LLM错误",
                "references": [],
                "ragContext-mindMap": [],
                "ragContext-evidence": []
            }

    async def _generate_claims(self, query: str, evidence_items: list) -> List[str]:
        if not evidence_items:
            return []

        fragments_text = ""
        for i, item in enumerate(evidence_items):
            rela_text = item["rela_text"][:300]
            fragments_text += f"{i + 1}. {rela_text}\n"

        prompt = f"""请为以下与用户问题相关的证据片段生成简洁的结论（claim），每个结论描述该证据所支持或证明的观点。
                    用户问题：{query}
                    
                    证据片段：
                    {fragments_text}
                    
                    要求：
                    - 每个证据对应一个 claim，若无法明确推断，则用“相关证据片段”代替。
                    - 返回一个 JSON 数组，顺序与片段编号一致。
                    只输出 JSON 数组，无其他文字。"""

        loop = asyncio.get_running_loop()
        try:
            raw = await loop.run_in_executor(executor, self.planner.callLLM, prompt)
            raw = raw.strip()
            if raw.startswith("```json"):
                raw = raw[7:]
            if raw.endswith("```"):
                raw = raw[:-3]
            claims = json.loads(raw)
            if isinstance(claims, list):
                return [str(c) for c in claims]
        except Exception as e:
            print(f"Failed to generate claims: {e}")

        return ["相关证据片段"] * len(evidence_items)
