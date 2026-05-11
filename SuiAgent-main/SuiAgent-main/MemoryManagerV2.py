import json
import asyncio
import time
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple, Callable, Awaitable, Union
from pathlib import Path
from dataclasses import dataclass, field


@dataclass
class TurnMemory:
    role: str
    content: str
    timestamp: float = field(default_factory=time.time)
    risk: Optional[str] = None
    triples: List[Dict] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)


class MemoryManagerV2:
    def __init__(
            self,
            memory_dir: Union[str, Path],
            output_dir: Union[str, Path],
            short_term_limit: int = 20,
            token_limit: int = 4000,
            summary_agent: Optional[Callable[[List[TurnMemory]], Awaitable[Tuple[str, Dict[str, Any]]]]] = None,
            compress_turn_interval: Optional[int] = 20
    ):
        self.memory_dir = Path(memory_dir)
        self.output_dir = Path(output_dir)
        self.short_term_limit = short_term_limit
        self.token_limit = token_limit
        self.summary_agent = summary_agent
        self.compress_turn_interval = compress_turn_interval

        self.short_term_memory: deque[TurnMemory] = deque(maxlen=short_term_limit)

        self.working_memory: Dict[str, Any] = {
            "dialogue_phase": "OPENING",
            "risk_trajectory": [],
            "explored_topics": [],
            "pending_socratic_nodes": [],
            "accumulated_triples": [],
            "user_profile_facts": {},
            "last_planner_plan": None,
        }

        self.long_term_summaries: List[str] = []

        self.work_memory_path = self.output_dir / "working_memory.json"
        self.long_term_path = self.output_dir / "long_term_summaries.json"
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.restore()
        self._restore_short_term()

        self._compress_lock = asyncio.Lock()

    def add_turn(
            self,
            role: str,
            content: str,
            risk: Optional[str] = None,
            triples: Optional[List[Dict]] = None,
            metadata: Optional[Dict] = None
    ):
        turn = TurnMemory(
            role=role,
            content=content,
            risk=risk if role == "user" else None,
            triples=[],
            metadata=metadata or {}
        )
        self.short_term_memory.append(turn)
        self.working_memory["turn_counter"] += 1

        if role == "user" and risk:
            entry = {
                "turn": self.working_memory["turn_counter"],
                "risk_label": risk,
                "timestamp": time.time()
            }
            self.working_memory["risk_trajectory"].append(entry)
            if len(self.working_memory["risk_trajectory"]) > 10:
                self.working_memory["risk_trajectory"].pop(0)

        if triples:
            self._merge_triples(triples)

        self.save()

        if len(self.short_term_memory) >= self.short_term_limit:
            self.compress()
            self._save_short_term()
            return
        self._save_short_term()

    async def compress(self):
        async with self._compress_lock:
            if len(self.short_term_memory) < 10:
                return

            turns_to_compress = []
            for _ in range(8):
                turns_to_compress.append(self.short_term_memory.popleft())

            if self.summary_agent:
                try:
                    summary_text, facts = await self.summary_agent(turns_to_compress)
                except Exception as e:
                    print(f"摘要生成失败: {e}")
                    summary_text = "\n".join(
                        f"{t.role}: {t.content}" for t in turns_to_compress
                    )[:200]
                    facts = {}
            else:
                print("压缩错误")
                return

            compressed_turn = TurnMemory(
                role="summary",
                content=summary_text,
                triples=[],
                metadata={
                    "compressed_turns": len(turns_to_compress),
                    "original_timestamps": [t.timestamp for t in turns_to_compress],
                    "extracted_facts": facts
                }
            )

            self.short_term_memory.appendleft(compressed_turn)

            if facts:
                self._merge_user_facts(facts)

            self.save()
            self._save_short_term()

    def _merge_user_facts(self, new_facts: Dict[str, Any]):
        existing = self.working_memory.setdefault("user_profile_facts", {})
        for k, v in new_facts.items():
            existing[k] = v
        self.working_memory["user_profile_facts"] = existing

    def _merge_triples(self, new_triples: List[Dict]):
        acc = self.working_memory.get("accumulated_triples", [])
        sigs = {(t.get("subject"), t.get("predicate"), t.get("object")) for t in acc}
        for t in new_triples:
            sig = (t.get("subject"), t.get("predicate"), t.get("object"))
            if sig not in sigs:
                acc.append(t)
                sigs.add(sig)
        if len(acc) > 30:
            acc[:] = acc[-30:]
        self.working_memory["accumulated_triples"] = acc

    def get_user_facts(self) -> Dict[str, Any]:
        return self.working_memory.get("user_profile_facts", {})

    def get_recent_user_inputs(self, hours: float = 24.0, limit: int = 100) -> List[str]:
        now = time.time()
        inputs = []
        for turn in self.short_term_memory:
            if turn.role != "user":
                continue
            if (now - turn.timestamp) <= hours * 3600:
                inputs.append(turn.content)
            if len(inputs) >= limit:
                break
        return inputs

    def get_planner_context(self) -> Dict[str, Any]:
        recent_turns = list(self.short_term_memory)[-3:]
        recent_dialogue = "\n".join(
            f"{t.role}: {t.content[:200]}" for t in recent_turns
        )

        history_turns = list(self.short_term_memory)[-10:]
        full_history = "\n".join(
            f"[摘要 {t.metadata.get('compressed_turns', '?')}轮] {t.content}" if t.role == "summary"
            else f"{t.role}: {t.content}"
            for t in history_turns
        )

        return {
            "recent_dialogue": recent_dialogue,
            "history": full_history,
            "dialogue_phase": self.working_memory["dialogue_phase"],
            "risk_trajectory": self.working_memory["risk_trajectory"][-5:],
            "explored_topics": self.working_memory["explored_topics"],
            "pending_socratic_nodes": self.working_memory["pending_socratic_nodes"],
            "user_profile_facts": self.working_memory["user_profile_facts"],
        }

    def update_phase(self, phase: str):
        self.working_memory["dialogue_phase"] = phase

    def update_explored_topics(self, topics: List[str]):
        current = set(self.working_memory.get("explored_topics", []))
        self.working_memory["explored_topics"] = list(current | set(topics))

    def update_pending_nodes(self, nodes: List[str]):
        self.working_memory["pending_socratic_nodes"] = nodes

    def update_last_plan(self, plan: Dict):
        self.working_memory["last_planner_plan"] = plan

    def save(self):
        try:
            with open(self.work_memory_path, 'w', encoding='utf-8') as f:
                json.dump(self.working_memory, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存工作记忆失败: {e}")

    def _save_long_term(self):
        try:
            with open(self.long_term_path, 'w', encoding='utf-8') as f:
                json.dump(self.long_term_summaries, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存长期记忆失败: {e}")

    def restore(self):
        if self.work_memory_path.exists():
            try:
                with open(self.work_memory_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.working_memory.update(data)
                self.working_memory.setdefault("explored_topics", [])
                self.working_memory.setdefault("pending_socratic_nodes", [])
                self.working_memory.setdefault("accumulated_triples", [])
                self.working_memory.setdefault("user_profile_facts", {})
                self.working_memory.setdefault("risk_trajectory", [])
                self.working_memory.setdefault("last_planner_plan", None)
                self.working_memory.setdefault("turn_counter", 0)
                print("工作记忆已恢复")
            except Exception as e:
                print(f"恢复工作记忆失败: {e}")

        if self.long_term_path.exists():
            try:
                with open(self.long_term_path, 'r', encoding='utf-8') as f:
                    self.long_term_summaries = json.load(f)
                print("长期摘要已恢复")
            except Exception as e:
                print(f"恢复长期摘要失败: {e}")

    def get_memory_stats(self) -> Dict:
        return {
            "short_term_turns": len(self.short_term_memory),
            "user_facts_count": len(self.working_memory["user_profile_facts"]),
            "triples_count": len(self.working_memory["accumulated_triples"]),
            "turn_counter": self.working_memory["turn_counter"]
        }

    def _save_short_term(self):
        data = [self._turn_to_dict(t) for t in self.short_term_memory]
        path = self.output_dir / "short_term_memory.json"
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _restore_short_term(self):
        path = self.output_dir / "short_term_memory.json"
        if path.exists():
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.short_term_memory.clear()
            for item in data:
                self.short_term_memory.append(self._dict_to_turn(item))
            print(f"历史记忆已恢复:f{self.short_term_memory}")

    @staticmethod
    def _turn_to_dict(t: TurnMemory) -> dict:
        return {
            "role": t.role,
            "content": t.content,
            "timestamp": t.timestamp,
            "risk": t.risk,
            "triples": t.triples,
            "metadata": t.metadata
        }

    @staticmethod
    def _dict_to_turn(d: dict) -> TurnMemory:
        return TurnMemory(
            role=d["role"],
            content=d["content"],
            timestamp=d.get("timestamp", time.time()),
            risk=d.get("risk"),
            triples=d.get("triples", []),
            metadata=d.get("metadata", {})
        )


def create_async_summary_agent(callLLM_func, executor):
    async def summary_agent(turns: List[TurnMemory]) -> Tuple[str, Dict[str, Any]]:
        dialogue_text = "\n".join(
            f"{t.role}: {t.content}" for t in turns
        )
        prompt = f"""你是一个心理危机干预的记忆分析与总结助手。请仔细阅读以下对话片段，然后完成两个任务：
                    1. 用不超过150字概括这段对话的核心内容（用户表达了什么情绪、遇到了什么困难、得到了什么回应）。
                    2. 提取用户在这段对话中透露的**关键事实**，以 JSON 对象返回。请重点关注以下维度（如果缺失则忽略该字段，但尽量提取）：
                       - "mood": 当前情绪状态（如 "低落", "焦虑", "愤怒", "绝望" 等）
                       - "suicidal": 是否出现自杀意念、计划、自伤行为（例如：{{"ideation": true, "plan": false, "means": null}}）
                       - "medication": 用户提到的药物名称、剂量、依从情况（字符串）
                       - "sleep": 睡眠问题（如 "失眠", "早醒", "入睡困难"），无则留空
                       - "appetite": 食欲变化（如 "减退", "增加"）
                       - "social_support": 社会支持状况（如 "家人支持", "感到孤独", "无朋友"）
                       - "recent_stressors": 近期压力事件（如 "失业", "失恋", "学业压力"）
                       - "coping": 应对方式（如 "运动", "听音乐", "酗酒"）
                       - "help_seeking": 求助意愿（如 "愿意", "抗拒", "犹豫"）
                       - "protective_factors": 保护因素（如 "有孩子", "未来计划", "宗教信念"）
                    
                       输出格式（严格遵守，不要额外说明）：
                       summary: <摘要文本>
                       facts: <JSON对象>
                    
                    对话片段：
                    {dialogue_text}
                    """
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(executor, callLLM_func, prompt)

        try:
            parts = response.split("facts:")
            summary_part = parts[0].replace("summary:", "").strip()
            facts_part = parts[1].strip() if len(parts) > 1 else "{}"
            facts = json.loads(facts_part)
        except Exception:
            summary_part = response[:200]
            facts = {}
        return summary_part, facts

    return summary_agent
