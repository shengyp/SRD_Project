import asyncio
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from config import config, memory_config
from LLM import callLLM
from logger import log_conversation, log_error, logger
from module import emocc, fealearn
from MemoryManagerV2 import MemoryManagerV2, create_async_summary_agent

executor = ThreadPoolExecutor(max_workers=16)


async def async_callLLM(prompt: str, attachments: Optional[List[Dict]] = None) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, lambda: callLLM(prompt, attachments=attachments))


class DialoguePlanner:
    def __init__(self, knowledge_base_path: str = "rag-skill/knowledge"):
        self.knowledge_base_path = Path(knowledge_base_path)

    def _get_knowledge_overview(self) -> str:
        index_path = self.knowledge_base_path / "data_structure.md"
        if not index_path.exists():
            return "知识库包含心理危机干预、常见心理障碍、求助资源、量表筛查等主题。"
        try:
            return index_path.read_text(encoding="utf-8")
        except Exception as e:
            print(f"读取知识库总览失败: {e}")
            return "知识库结构读取失败，请根据用户问题进行保守检索。"

    async def plan(self, user_input: str, risk: str, mem_ctx: Dict[str, Any]) -> Dict[str, Any]:
        prompt = f"""
你是一名心理健康对话规划助手。请基于当前输入、风险等级、近期上下文与知识库总览，输出下一步计划。

【用户输入】
{user_input}

【风险等级】
{risk}

【当前阶段】
{mem_ctx.get('dialogue_phase', 'OPENING')}

【已探索主题】
{', '.join(mem_ctx.get('explored_topics', []))}

【待追问节点】
{', '.join(mem_ctx.get('pending_socratic_nodes', []))}

【用户关键事实】
{json.dumps(mem_ctx.get('user_profile_facts', {}), ensure_ascii=False)}

【近期对话摘要】
{mem_ctx.get('history', '')}

【知识库总览】
{self._get_knowledge_overview()}

请输出 JSON，格式如下：
{{
  "retrieval_queries": [
    {{"type": "knowledge|emotional_support|safety_plan", "query": "检索词", "priority": 1}}
  ],
  "dialogue_strategy": {{
    "phase": "EXPLORING_EMOTION|OFFERING_EVIDENCE|GUIDING_ACTION|CLOSING",
    "tone": "empathic|supportive|firm",
    "socratic_focus": "一句话说明下一步聚焦点",
    "pending_nodes": ["节点1", "节点2"],
    "interruption": false
  }}
}}

规则：
1. 若用户主要在问知识、量表、症状、药物、资源，允许直接进入 OFFERING_EVIDENCE。
2. 若风险为高或极高，至少保留一个 safety_plan 类型检索。
3. 检索词要短，尽量贴近知识库主题词，不要写成长句。
4. 只输出 JSON。
"""
        raw = await async_callLLM(prompt)
        try:
            text = raw.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            data = json.loads(text)
            data.setdefault("retrieval_queries", [])
            data.setdefault("dialogue_strategy", {})
            data["dialogue_strategy"].setdefault("phase", "EXPLORING_EMOTION")
            data["dialogue_strategy"].setdefault("tone", "supportive")
            data["dialogue_strategy"].setdefault("socratic_focus", "理解用户当前需求")
            data["dialogue_strategy"].setdefault("pending_nodes", [])
            data["dialogue_strategy"].setdefault("interruption", False)
            return data
        except Exception as e:
            print(f"planner 解析失败: {e}")
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
    async def generate(
        self,
        user_input: str,
        risk: str,
        strategy: Dict[str, Any],
        evidence_items: List[Dict[str, Any]],
        history: str,
        attachments: Optional[List[Dict]] = None,
        direct_answer_only: bool = False,
    ) -> str:
        evidence_text = "\n".join(
            f"- 来源：{item['title']} | 主题：{item['theme']} | 子主题：{item['subtheme']}\n  证据：{item['snippet']}"
            for item in evidence_items[:6]
        ) if evidence_items else "暂无检索证据"

        if direct_answer_only:
            prompt = f"""
你是一名心理健康知识助手。请结合提供的证据，直接回答用户问题。

【用户问题】
{user_input}

【近期对话】
{history}

【检索证据】
{evidence_text}

要求：
1. 优先直接回答，不绕弯。
2. 若证据不足，明确说证据有限，再给保守建议。
3. 不编造来源中没有的信息。
4. 回答自然、简洁、专业。
"""
        else:
            prompt = f"""
你是一名专业、克制、温和的心理支持助手，请结合检索证据生成回复。

【用户输入】
{user_input}

【当前风险】
{risk}

【对话策略】
- 阶段：{strategy.get('phase', '')}
- 语气：{strategy.get('tone', '')}
- 聚焦：{strategy.get('socratic_focus', '')}

【近期对话】
{history}

【检索证据】
{evidence_text}

请按自然语言生成回复，满足：
1. 先共情或确认用户关切。
2. 再给出基于证据的回应或建议。
3. 最后给一个温和、具体的下一步问题或建议动作。
4. 风险越高，越优先安全和现实支持，不要空泛说教。
"""

        answer = await async_callLLM(prompt, attachments=attachments)
        return answer.strip() if answer else "抱歉，我暂时没能生成有效回复。"


def _chunk_text(text: str, size: int = 24) -> List[str]:
    if not text:
        return []
    return [text[i:i + size] for i in range(0, len(text), size)]


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
        self.knowledge_base_path = Path(knowledge_base_path).resolve()

        async_summary_agent = create_async_summary_agent(callLLM, executor)
        self.memory = MemoryManagerV2(
            memory_dir=memory_dir,
            output_dir=self.output_dir,
            short_term_limit=short_term_limit,
            token_limit=token_limit,
            summary_agent=async_summary_agent,
        )
        self.planner = DialoguePlanner(knowledge_base_path)
        self.response_gen = ResponseGenerator()

        from rag_skill_tool import create_rag_skill_tool
        self.rag_tool = create_rag_skill_tool(knowledge_base_path or "rag-skill/knowledge")

        logger.set_session_id(self.current_session_id)

    def _classify_risk(self, emocc_risk: str, fealearn_risk: str) -> str:
        current_text = str(emocc_risk)
        history_text = str(fealearn_risk)
        if "极高" in current_text or "极高" in history_text:
            return "极高"
        if "高" in current_text or "高" in history_text:
            return "高"
        if "中" in current_text or "中" in history_text:
            return "中"
        return "低"

    def _is_obvious_smalltalk(self, user_input: str) -> bool:
        text = (user_input or "").strip()
        if len(text) > 8:
            return False
        keywords = {
            "你好", "您好", "嗨", "哈喽", "在吗", "谢谢", "感谢", "再见", "拜拜",
            "早上好", "中午好", "晚上好",
        }
        return text in keywords or text.lower() in {"hi", "hello", "thanks", "bye"}

    def _apply_preset_intent(
        self,
        plan: Dict[str, Any],
        user_input: str,
        risk: str,
    ) -> Dict[str, Any]:
        plan = plan or {}
        retrieval_queries = plan.setdefault("retrieval_queries", [])
        strategy = plan.setdefault("dialogue_strategy", {})
        strategy.setdefault("phase", "EXPLORING_EMOTION")
        strategy.setdefault("tone", "supportive")
        strategy.setdefault("socratic_focus", "理解用户当前需求")
        strategy.setdefault("pending_nodes", [])
        strategy.setdefault("interruption", False)

        if self.preset_intent == "professional_query":
            plan["retrieval_queries"] = [{"type": "knowledge", "query": user_input, "priority": 1}]
            strategy.update({
                "phase": "OFFERING_EVIDENCE",
                "tone": "supportive",
                "socratic_focus": "直接回答用户当前问题",
                "pending_nodes": [],
                "interruption": True,
            })
        elif self.preset_intent == "emotional_support":
            strategy["interruption"] = False
            if risk in {"高", "极高"} and not any(q.get("type") == "safety_plan" for q in retrieval_queries):
                retrieval_queries.insert(0, {"type": "safety_plan", "query": "危机干预 即时求助", "priority": 1})
        elif self.preset_intent == "casual_chat":
            plan["retrieval_queries"] = []
            strategy.update({
                "phase": "CLOSING",
                "tone": "supportive",
                "socratic_focus": "自然回应用户",
                "pending_nodes": [],
                "interruption": True,
            })
        return plan

    async def _generate_smalltalk_response(
        self,
        user_input: str,
        risk: str,
        attachments: Optional[List[Dict]] = None,
    ) -> str:
        prompt = f"""
你是一名温和自然的心理健康助手。

用户输入：{user_input}
当前风险等级：{risk}

如果这是问候或简短闲聊，就自然回应；
如果隐含不舒服或压力，也可以轻微接住情绪，但不要过度上价值。
"""
        return await async_callLLM(prompt, attachments=attachments)

    def _parse_semantic_path(self, file_path: str) -> Dict[str, str]:
        normalized = str(file_path).replace("\\", "/")
        marker = "/rag-skill/knowledge/"
        if marker in normalized:
            rel = normalized.split(marker, 1)[1]
        else:
            rel = Path(file_path).name
        parts = [p for p in rel.split("/") if p]
        theme = parts[0] if len(parts) >= 1 else "未分类主题"
        subtheme = parts[1] if len(parts) >= 3 else (parts[1] if len(parts) >= 2 else "未分类子主题")
        title = Path(parts[-1]).stem if parts else Path(file_path).stem
        return {"theme": theme, "subtheme": subtheme, "title": title}

    def _build_mind_map(self, files: List[Dict[str, str]]) -> Dict[str, Any]:
        root = {"name": "知识语义结构", "children": []}
        theme_map: Dict[str, Dict[str, Any]] = {}

        for file_info in files:
            semantic = self._parse_semantic_path(file_info.get("path", ""))
            theme_name = semantic["theme"]
            subtheme_name = semantic["subtheme"]
            title = semantic["title"]

            theme_node = theme_map.setdefault(theme_name, {"name": theme_name, "children": []})
            sub_map = {node["name"]: node for node in theme_node["children"]}
            if subtheme_name not in sub_map:
                sub_map[subtheme_name] = {"name": subtheme_name, "children": []}
                theme_node["children"].append(sub_map[subtheme_name])

            doc_names = {node["name"] for node in sub_map[subtheme_name]["children"]}
            if title not in doc_names:
                sub_map[subtheme_name]["children"].append({"name": title})

        root["children"] = list(theme_map.values())
        return {"root": root}

    async def _retrieve_evidence(self, retrieval_queries: List[Dict[str, Any]]) -> Dict[str, Any]:
        evidence_items: List[Dict[str, Any]] = []
        files: List[Dict[str, str]] = []
        seen_files = set()

        for query_item in sorted(retrieval_queries, key=lambda x: x.get("priority", 1)):
            query = str(query_item.get("query", "")).strip()
            if not query:
                continue
            try:
                result = await self.rag_tool(query)
            except Exception as e:
                log_error("rag_retrieve", f"{query}: {e}")
                continue

            if not isinstance(result, dict):
                continue

            target_files = result.get("target_file", []) or result.get("target_files", [])
            snippets = result.get("rela_text", []) or []

            current_file = target_files[0] if target_files else None
            if current_file and isinstance(current_file, dict):
                file_path = current_file.get("path", "")
                if file_path and file_path not in seen_files:
                    files.append(current_file)
                    seen_files.add(file_path)

            semantic = self._parse_semantic_path(current_file.get("path", "")) if isinstance(current_file, dict) else {
                "theme": "未分类主题",
                "subtheme": "未分类子主题",
                "title": "未知文档",
            }

            for snippet in snippets[:5]:
                evidence_items.append({
                    "snippet": snippet[:500],
                    "theme": semantic["theme"],
                    "subtheme": semantic["subtheme"],
                    "title": semantic["title"],
                    "query_type": query_item.get("type", "knowledge"),
                })

        references = []
        for idx, file_info in enumerate(files, start=1):
            semantic = self._parse_semantic_path(file_info.get("path", ""))
            file_name = file_info.get("name", semantic["title"])
            ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "txt"
            references.append({
                "id": f"doc_{idx:03d}",
                "title": semantic["title"],
                "type": ext,
                "theme": semantic["theme"],
                "subTopic": semantic["subtheme"],
                "path": file_info.get("path", ""),
            })

        return {
            "evidence_items": evidence_items,
            "files": files,
            "references": references,
            "mind_map": self._build_mind_map(files),
        }

    async def process_message(
        self,
        user_input: str,
        attachments: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        try:
            emocc_risk = emocc(user_input)
            recent_inputs = self.memory.get_recent_user_inputs(hours=24, limit=100)
            fealearn_risk = fealearn(recent_inputs)
            risk_classification = self._classify_risk(emocc_risk, fealearn_risk)

            self.memory.add_turn("user", user_input, risk=risk_classification)

            if self.preset_intent == "casual_chat" or (not self.preset_intent and self._is_obvious_smalltalk(user_input)):
                response = await self._generate_smalltalk_response(user_input, risk_classification, attachments=attachments)
                self.memory.add_turn("assistant", response)
                log_conversation(user_input, response, emocc_risk, fealearn_risk, "casual_chat")
                return {
                    "LLM_ans": response,
                    "content": response,
                    "target_file": [],
                    "target_files": [],
                    "references": [],
                    "mind_map": self._build_mind_map([]),
                }

            mem_ctx = self.memory.get_planner_context()
            plan = await self.planner.plan(user_input, risk_classification, mem_ctx)
            plan = self._apply_preset_intent(plan, user_input, risk_classification)
            self.memory.update_last_plan(plan)

            strategy = plan.get("dialogue_strategy", {})
            if not strategy.get("interruption", False):
                self.memory.update_phase(strategy.get("phase", "EXPLORING_EMOTION"))
                self.memory.update_explored_topics([strategy.get("socratic_focus", "")])
                self.memory.update_pending_nodes(strategy.get("pending_nodes", []))

            retrieval_result = await self._retrieve_evidence(plan.get("retrieval_queries", []))
            evidence_items = retrieval_result["evidence_items"]

            direct_answer_only = self.preset_intent == "professional_query" or strategy.get("interruption", False)
            response = await self.response_gen.generate(
                user_input=user_input,
                risk=risk_classification,
                strategy=strategy,
                evidence_items=evidence_items,
                history=mem_ctx.get("history", ""),
                attachments=attachments,
                direct_answer_only=direct_answer_only,
            )

            self.memory.add_turn(
                "assistant",
                response,
                metadata={
                    "references": retrieval_result["references"],
                    "phase": strategy.get("phase", ""),
                },
            )

            intent = self.preset_intent or ("professional_query" if direct_answer_only else "emotional_support")
            log_conversation(user_input, response, emocc_risk, fealearn_risk, intent)

            return {
                "LLM_ans": response,
                "content": response,
                "target_file": retrieval_result["files"],
                "target_files": retrieval_result["files"],
                "references": retrieval_result["references"],
                "mind_map": retrieval_result["mind_map"],
                "ragContext": {
                    "evidence": evidence_items,
                    "sources": retrieval_result["references"],
                },
            }
        except Exception as e:
            log_error("process_message", str(e))
            return {
                "LLM_ans": "抱歉，当前回答生成失败，请稍后再试。",
                "content": "抱歉，当前回答生成失败，请稍后再试。",
                "target_file": [],
                "target_files": [],
                "references": [],
                "mind_map": self._build_mind_map([]),
            }

    async def stream_process_message(
        self,
        user_input: str,
        attachments: Optional[List[Dict]] = None,
    ) -> AsyncIterator[str]:
        result = await self.process_message(user_input, attachments=attachments)
        for chunk in _chunk_text(result.get("LLM_ans", ""), size=24):
            yield chunk
