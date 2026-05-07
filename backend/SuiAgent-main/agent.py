import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from config import config, memory_config
from LLM import callLLM, callLLM_stream
from MemoryManagerV2 import MemoryManagerV2, create_async_summary_agent
from module import emocc, fealearn
from rag_skill_tool import RAGSkillTool

executor = ThreadPoolExecutor(max_workers=4)


class DialoguePlanner:
    def __init__(self, callLLM_func, executor, knowledge_base_path: str = "rag-skill/knowledge"):
        self.callLLM = callLLM_func
        self.executor = executor
        self.knowledge_base_path = Path(knowledge_base_path)

    def _get_knowledge_overview(self) -> str:
        index_path = self.knowledge_base_path / "data_structure.md"
        if not index_path.exists():
            return "知识库包含心理健康障碍、自杀预防、危机资源、临床路径和统计资料。"
        try:
            return index_path.read_text(encoding="utf-8")
        except Exception as e:
            print(f"读取知识库索引失败: {e}")
            return "知识库结构未知，请根据用户问题直接检索。"

    async def plan(self, user_input: str, risk: str, mem_ctx: Dict[str, Any]) -> Dict[str, Any]:
        prompt = f"""
你是一位自杀危机干预对话规划专家。请根据当前信息生成下一步计划，只输出 JSON。

【背景信息】
- 用户输入：{user_input}
- 风险等级：{risk}
- 当前对话阶段：{mem_ctx.get('dialogue_phase', 'OPENING')}
- 已探索主题：{', '.join(mem_ctx.get('explored_topics', []))}
- 待追问节点：{', '.join(mem_ctx.get('pending_socratic_nodes', []))}
- 用户关键事实：{json.dumps(mem_ctx.get('user_profile_facts', {}), ensure_ascii=False)}
- 最近对话内容：{mem_ctx.get('history', '')}

【知识库概览】
{self._get_knowledge_overview()}

输出格式：
{{
  "retrieval_queries": [
    {{"type": "knowledge|emotional_support|safety_plan", "query": "检索词", "priority": 1}}
  ],
  "dialogue_strategy": {{
    "phase": "EXPLORING_EMOTION|OFFERING_EVIDENCE|GUIDING_ACTION|CLOSING",
    "tone": "empathic|supportive|firm",
    "socratic_focus": "一句话说明引导方向",
    "pending_nodes": ["节点1", "节点2"],
    "interruption": false
  }}
}}

规则：
1. 普通知识问答可以设置 interruption=true。
2. 高风险和极高风险时，至少包含一个 safety_plan 查询。
3. 查询词尽量短，不要写成长段句子。
4. 只输出 JSON。
"""
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(self.executor, self.callLLM, prompt)
        try:
            text = response.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            plan = json.loads(text)
            plan.setdefault("retrieval_queries", [])
            plan.setdefault("dialogue_strategy", {})
            plan["dialogue_strategy"].setdefault("phase", "EXPLORING_EMOTION")
            plan["dialogue_strategy"].setdefault("tone", "supportive")
            plan["dialogue_strategy"].setdefault("socratic_focus", "理解用户当前需求")
            plan["dialogue_strategy"].setdefault("pending_nodes", [])
            plan["dialogue_strategy"].setdefault("interruption", False)
            return plan
        except Exception as e:
            print(f"planner 输出解析失败: {e}")
            return {
                "retrieval_queries": [{"type": "knowledge", "query": user_input, "priority": 1}],
                "dialogue_strategy": {
                    "phase": "OFFERING_EVIDENCE",
                    "tone": "supportive",
                    "socratic_focus": "直接回答用户当前问题",
                    "pending_nodes": [],
                    "interruption": True,
                },
            }


class ResponseGenerator:
    DEFAULT_SYSTEM_PROMPT = "你是心理健康与心身医学领域的专业辅助助手，擅长心理学与中医学常识性科普。用户若询问医学/中医术语或机制，应结合专业知识作答；勿用固定模板敷衍。"

    def __init__(self, callLLM_func, executor, callLLM_stream_func=None):
        self.callLLM = callLLM_func
        self.executor = executor
        self.callLLM_stream = callLLM_stream_func

    async def generate(
        self,
        user_input: str,
        risk: str,
        strategy: Dict[str, Any],
        triples: List[Dict],
        history: str,
    ) -> str:
        prompt = self._build_generation_prompt(user_input, risk, strategy, triples, history)
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(self.executor, self.callLLM, prompt)
        return response.strip()

    async def generate_stream(
        self,
        user_input: str,
        risk: str,
        strategy: Dict[str, Any],
        triples: List[Dict],
        history: str,
    ) -> AsyncIterator[str]:
        if self.callLLM_stream is None:
            response = await self.generate(user_input, risk, strategy, triples, history)
            if response:
                yield response
            return

        prompt = self._build_generation_prompt(user_input, risk, strategy, triples, history)
        messages = [
            {"role": "system", "content": self.DEFAULT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _worker():
            try:
                for chunk in self.callLLM_stream(messages):
                    if chunk:
                        loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception as exc:
                loop.call_soon_threadsafe(queue.put_nowait, json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False))
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        worker_task = asyncio.create_task(asyncio.to_thread(_worker))
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            await worker_task

    def _build_generation_prompt(
        self,
        user_input: str,
        risk: str,
        strategy: Dict[str, Any],
        triples: List[Dict],
        history: str,
    ) -> str:
        triple_text = "\n".join(
            f"- {t.get('subject', '')} {t.get('predicate', '')} {t.get('object', '')}"
            for t in triples[:5]
        ) if triples else "暂无文献证据"

        if strategy.get("interruption", False):
            return f"""
【用户输入】{user_input}
【近期对话摘要】{history}
【参考证据】{triple_text}

当前是普通问答。请直接、自然、简洁地回答用户问题。
如果有证据就结合证据，没有证据也可以给出保守回答。
不要生硬转回危机流程。
"""

        return f"""
你是一位专业的自杀危机干预人员，正在与用户进行支持性对话。

【用户输入】{user_input}
【当前风险等级】{risk}
【对话策略】
- 阶段：{strategy.get('phase', '')}
- 语气：{strategy.get('tone', '')}
- 引导方向：{strategy.get('socratic_focus', '')}

【可引用的文献证据】
{triple_text}

【近期对话摘要】
{history}

请生成一个回答：
1. 先表达理解或确认关切。
2. 再给出基于证据的回应或建议。
3. 最后给一个温和的下一步引导。
4. 风险越高，越优先安全和现实支持。
只输出最终回答。
"""


def _chunk_text(text: str, size: int = 24) -> List[str]:
    if not text:
        return []
    return [text[i:i + size] for i in range(0, len(text), size)]


def _build_mind_map_from_triples(
    user_input: str,
    triples: List[Dict[str, Any]],
    evidence_objects: List[Dict[str, Any]],
) -> Dict[str, Any]:
    question_label = user_input[:18] + "..." if len(user_input) > 18 else user_input
    nodes: List[Dict[str, Any]] = [
        {
            "id": "question",
            "label": question_label or "当前问题",
            "group": "question",
            "description": "当前问答中心问题，图谱围绕它展开风险判断、事实依据与行动建议。",
            "relatedEvidenceIds": [item.get("id") for item in evidence_objects[:3] if item.get("id")],
        }
    ]
    edges: List[Dict[str, Any]] = []
    seen_labels = {"question"}

    for index, triple in enumerate(triples[:6]):
        subject = str(triple.get("subject", "")).strip()
        predicate = str(triple.get("predicate", "")).strip()
        obj = str(triple.get("object", "")).strip()
        evidence = str(triple.get("evidence", "")).strip()
        if not subject or not obj:
            continue

        node_id = f"triple_{index}"
        label = obj[:18] + "..." if len(obj) > 18 else obj
        if label in seen_labels:
            continue
        seen_labels.add(label)

        nodes.append(
            {
                "id": node_id,
                "label": label,
                "group": "core" if index < 3 else "support",
                "description": evidence or f"{subject} 与 {obj} 存在“{predicate or '相关'}”关系。",
                "relatedEvidenceIds": [evidence_objects[index]["id"]] if index < len(evidence_objects) else [],
            }
        )
        edges.append(
            {
                "source": "question",
                "target": node_id,
                "label": predicate or "相关",
            }
        )

    if len(nodes) == 1:
        for index, evidence in enumerate(evidence_objects[:4]):
            node_id = f"evidence_{index}"
            nodes.append(
                {
                    "id": node_id,
                    "label": evidence.get("title", f"证据{index + 1}")[:18],
                    "group": "core" if index < 2 else "support",
                    "description": evidence.get("snippet", "")[:120] or "检索到的证据片段。",
                    "relatedEvidenceIds": [evidence.get("id")] if evidence.get("id") else [],
                }
            )
            edges.append(
                {
                    "source": "question",
                    "target": node_id,
                    "label": "证据支撑",
                }
            )

    return {
        "nodes": nodes,
        "edges": edges,
        "summary": "图谱展示当前问题与检索证据之间的核心关系，可用于解释回答依据与后续处置方向。",
        "focusNodeId": "question",
    }


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
        preset_intent: str = "",
    ):
        self.preset_intent = preset_intent
        self.agent_name = agent_name
        self.current_session_id = f"session_{session_id}"
        self.output_dir = Path(output_dir) / agent_name / self.current_session_id
        self.output_dir.mkdir(parents=True, exist_ok=True)

        async_summary_agent = create_async_summary_agent(callLLM, executor)
        self.memory = MemoryManagerV2(
            memory_dir=memory_dir,
            output_dir=self.output_dir,
            short_term_limit=short_term_limit,
            token_limit=token_limit,
            summary_agent=async_summary_agent,
        )

        self.planner = DialoguePlanner(callLLM, executor, knowledge_base_path)
        self.response_gen = ResponseGenerator(callLLM, executor, callLLM_stream)
        self.rag_tool = RAGSkillTool(knowledge_base_path)

    def _classify_risk(self, emocc_risk: str, fealearn_risk: str) -> str:
        high_keywords = ["极高风险", "高风险", "高", "high"]
        if any(k in str(emocc_risk).lower() for k in high_keywords) or any(
            k in str(fealearn_risk).lower() for k in high_keywords
        ):
            return "高"
        medium_keywords = ["中风险", "中", "medium"]
        if any(k in str(emocc_risk).lower() for k in medium_keywords) or any(
            k in str(fealearn_risk).lower() for k in medium_keywords
        ):
            return "中"
        return "低"

    def _apply_preset_intent(self, user_input: str, risk: str, plan: Dict[str, Any]) -> Dict[str, Any]:
        strategy = plan.setdefault("dialogue_strategy", {})
        strategy.setdefault("phase", "EXPLORING_EMOTION")
        strategy.setdefault("tone", "supportive")
        strategy.setdefault("socratic_focus", "理解用户当前需求")
        strategy.setdefault("pending_nodes", [])
        strategy.setdefault("interruption", False)

        if self.preset_intent == "professional_query":
            plan["retrieval_queries"] = [{"type": "knowledge", "query": user_input, "priority": 1}]
            strategy["interruption"] = True
            strategy["phase"] = "OFFERING_EVIDENCE"
        elif self.preset_intent == "intervention_query":
            plan["retrieval_queries"] = [
                {"type": "knowledge", "query": user_input, "priority": 1},
                {"type": "safety_plan", "query": "危机干预 5行动步骤 安全计划", "priority": 2},
                {"type": "knowledge", "query": "心理危机援助热线 988 求助资源", "priority": 3},
            ]
            strategy["interruption"] = True
            strategy["phase"] = "GUIDING_ACTION"
        elif self.preset_intent == "casual_chat":
            plan["retrieval_queries"] = []
            strategy["interruption"] = True
            strategy["phase"] = "CLOSING"
        elif self.preset_intent == "emotional_support":
            if risk == "高" and not any(q.get("type") == "safety_plan" for q in plan.get("retrieval_queries", [])):
                plan.setdefault("retrieval_queries", []).insert(
                    0, {"type": "safety_plan", "query": "suicide crisis help", "priority": 1}
                )
        return plan

    async def _prepare_response_context(self, user_input: str) -> Dict[str, Any]:
        loop = asyncio.get_running_loop()
        emocc_risk = await loop.run_in_executor(executor, emocc, user_input)
        recent_inputs = self.memory.get_recent_user_inputs(hours=24, limit=100)
        fealearn_risk = await loop.run_in_executor(executor, fealearn, recent_inputs)
        risk_classification = self._classify_risk(emocc_risk, fealearn_risk)
        self.memory.add_turn("user", user_input, risk=risk_classification)

        mem_ctx = self.memory.get_planner_context()
        plan = await self.planner.plan(user_input, risk_classification, mem_ctx)
        plan = self._apply_preset_intent(user_input, risk_classification, plan)
        self.memory.update_last_plan(plan)

        if not plan["dialogue_strategy"].get("interruption", False):
            self.memory.update_phase(plan["dialogue_strategy"]["phase"])
            self.memory.update_explored_topics([plan["dialogue_strategy"]["socratic_focus"]])
            self.memory.update_pending_nodes(plan["dialogue_strategy"].get("pending_nodes", []))

        retrieval_queries = sorted(plan.get("retrieval_queries", []), key=lambda x: x.get("priority", 1))
        evidence_items = []
        target_files_info = []

        for rq in retrieval_queries:
            result = await self.rag_tool.retrieve_evidence(rq["query"])
            if not result:
                continue
            file_info = result.get("target_file", [])
            current_file = file_info[0] if file_info else None
            snippets = result.get("rela_text", [])
            for snippet in snippets:
                evidence_items.append({"snippet": snippet, "file": current_file})
            if current_file and not any(f["path"] == current_file["path"] for f in target_files_info):
                target_files_info.append(current_file)

        doc_map = {file_info["path"]: file_info["name"] for file_info in target_files_info}

        evidence_objects = []
        for i, item in enumerate(evidence_items):
            file = item["file"]
            if file:
                file_name = file["name"]
                title = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
                ext = file_name.rsplit(".", 1)[-1] if "." in file_name else ""
                doc_id = doc_map.get(file["path"], file_name)
            else:
                title, ext, doc_id = "未知来源", "", "未知来源"
            evidence_objects.append(
                {
                    "id": f"evidence_{i + 1:03d}",
                    "title": title,
                    "sourceType": ext,
                    "snippet": item["snippet"][:500],
                    "claim": "",
                    "docId": doc_id,
                }
            )

        references = []
        for file_info in target_files_info:
            path = file_info["path"]
            name = file_info["name"]
            title = name.rsplit(".", 1)[0] if "." in name else name
            ext = name.rsplit(".", 1)[-1] if "." in name else ""
            references.append({"id": doc_map[path], "title": title, "type": ext})

        all_fragments = [item["snippet"] for item in evidence_items]
        all_triples = self.rag_tool._extract_triples(all_fragments, user_input)
        mind_map = _build_mind_map_from_triples(user_input, all_triples, evidence_objects)

        return {
            "risk_classification": risk_classification,
            "mem_ctx": mem_ctx,
            "plan": plan,
            "retrieval_queries": retrieval_queries,
            "target_file": target_files_info,
            "references": references,
            "triples": all_triples,
            "mind_map": mind_map,
            "evidence_objects": evidence_objects,
            "context_sources": [q.get("query", "") for q in retrieval_queries if q.get("query")],
        }

    async def process_message(
        self,
        user_input: str,
        attachments: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        del attachments
        try:
            context = await self._prepare_response_context(user_input)

            response = await self.response_gen.generate(
                user_input=user_input,
                risk=context["risk_classification"],
                strategy=context["plan"]["dialogue_strategy"],
                triples=context["triples"],
                history=context["mem_ctx"].get("history", ""),
            )

            self.memory.add_turn("assistant", response, triples=context["triples"])

            return {
                "LLM_ans": response,
                "content": response,
                "target_file": context["target_file"],
                "references": context["references"],
                "ragContext.mindMap": context["mind_map"],
                "ragContext.evidence": context["evidence_objects"],
                "ragContext.contextSources": context["context_sources"],
            }
        except Exception as e:
            print("process_message:", str(e))
            return {
                "LLM_ans": "LLM错误",
                "content": "LLM错误",
                "target_file": [],
                "references": [],
                "ragContext.mindMap": {"nodes": [], "edges": [], "summary": "", "focusNodeId": None},
                "ragContext.evidence": [],
                "ragContext.contextSources": [],
            }

    async def stream_process_message(
        self,
        user_input: str,
        attachments: Optional[List[Dict]] = None,
    ) -> AsyncIterator[str]:
        del attachments
        context = await self._prepare_response_context(user_input)
        references = context.get("references", [])
        if references:
            yield json.dumps({"type": "rag_sources", "sources": references}, ensure_ascii=False)

        mind_map = context.get("mind_map")
        if mind_map:
            yield json.dumps({"type": "mind_map", "mindMap": mind_map}, ensure_ascii=False)

        evidence = context.get("evidence_objects", [])
        if evidence:
            yield json.dumps({"type": "rag_evidence", "evidence": evidence}, ensure_ascii=False)

        context_sources = context.get("context_sources", [])
        if context_sources:
            yield json.dumps({"type": "context_sources", "sources": context_sources}, ensure_ascii=False)

        response_parts: List[str] = []
        async for chunk in self.response_gen.generate_stream(
            user_input=user_input,
            risk=context["risk_classification"],
            strategy=context["plan"]["dialogue_strategy"],
            triples=context["triples"],
            history=context["mem_ctx"].get("history", ""),
        ):
            if not chunk:
                continue
            try:
                parsed = json.loads(chunk)
                if isinstance(parsed, dict) and parsed.get("type") == "error":
                    raise RuntimeError(parsed.get("message") or "流式生成失败")
            except json.JSONDecodeError:
                pass
            response_parts.append(chunk)
            yield chunk

        self.memory.add_turn("assistant", "".join(response_parts).strip(), triples=context["triples"])
