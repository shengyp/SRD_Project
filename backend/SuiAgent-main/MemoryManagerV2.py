import asyncio
import json
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple, Union


@dataclass
class TurnMemory:
    role: str
    content: str
    timestamp: float = field(default_factory=time.time)
    risk: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class MemoryManagerV2:
    def __init__(
        self,
        memory_dir: Union[str, Path],
        output_dir: Union[str, Path],
        short_term_limit: int = 20,
        token_limit: int = 4000,
        summary_agent: Optional[Callable[[List[TurnMemory]], Awaitable[Tuple[str, Dict[str, Any]]]]] = None,
    ):
        self.memory_dir = Path(memory_dir)
        self.output_dir = Path(output_dir)
        self.short_term_limit = short_term_limit
        self.token_limit = token_limit
        self.summary_agent = summary_agent
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        self.short_term_memory: deque[TurnMemory] = deque(maxlen=short_term_limit)
        self.working_memory: Dict[str, Any] = {
            "dialogue_phase": "OPENING",
            "risk_trajectory": [],
            "explored_topics": [],
            "pending_socratic_nodes": [],
            "user_profile_facts": {},
            "last_planner_plan": None,
            "turn_counter": 0,
        }

        self.work_memory_path = self.output_dir / "working_memory.json"
        self.short_term_path = self.output_dir / "short_term_memory.json"
        self._compress_lock = asyncio.Lock()

        self.restore()
        self._restore_short_term()

    def add_turn(
        self,
        role: str,
        content: str,
        risk: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        turn = TurnMemory(role=role, content=content, risk=risk if role == "user" else None, metadata=metadata or {})
        self.short_term_memory.append(turn)
        self.working_memory["turn_counter"] = self.working_memory.get("turn_counter", 0) + 1

        if role == "user" and risk:
            risk_entry = {
                "turn": self.working_memory["turn_counter"],
                "risk_label": risk,
                "timestamp": time.time(),
            }
            self.working_memory.setdefault("risk_trajectory", []).append(risk_entry)
            self.working_memory["risk_trajectory"] = self.working_memory["risk_trajectory"][-10:]

        self.save()
        self._save_short_term()

        if len(self.short_term_memory) >= self.short_term_limit:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.compress())
            except RuntimeError:
                pass

    async def compress(self):
        async with self._compress_lock:
            if len(self.short_term_memory) < 10 or not self.summary_agent:
                return

            turns_to_compress: List[TurnMemory] = []
            keep_tail = 8
            while len(self.short_term_memory) > keep_tail and len(turns_to_compress) < 8:
                turns_to_compress.append(self.short_term_memory.popleft())

            if not turns_to_compress:
                return

            try:
                summary_text, facts = await self.summary_agent(turns_to_compress)
            except Exception as e:
                print(f"记忆压缩失败: {e}")
                summary_text = "\n".join(f"{t.role}: {t.content}" for t in turns_to_compress)[:300]
                facts = {}

            self.short_term_memory.appendleft(
                TurnMemory(
                    role="summary",
                    content=summary_text,
                    metadata={
                        "compressed_turns": len(turns_to_compress),
                        "extracted_facts": facts,
                    },
                )
            )

            if facts:
                self.working_memory.setdefault("user_profile_facts", {}).update(facts)

            self.save()
            self._save_short_term()

    def get_recent_user_inputs(self, hours: float = 24.0, limit: int = 100) -> List[str]:
        cutoff = time.time() - hours * 3600
        values = []
        for turn in self.short_term_memory:
            if turn.role == "user" and turn.timestamp >= cutoff:
                values.append(turn.content)
        return values[-limit:]

    def get_planner_context(self) -> Dict[str, Any]:
        history_turns = list(self.short_term_memory)[-10:]
        history = "\n".join(
            f"[摘要 {t.metadata.get('compressed_turns', '?')} 轮] {t.content}" if t.role == "summary"
            else f"{t.role}: {t.content}"
            for t in history_turns
        )
        return {
            "history": history,
            "dialogue_phase": self.working_memory.get("dialogue_phase", "OPENING"),
            "risk_trajectory": self.working_memory.get("risk_trajectory", [])[-5:],
            "explored_topics": self.working_memory.get("explored_topics", []),
            "pending_socratic_nodes": self.working_memory.get("pending_socratic_nodes", []),
            "user_profile_facts": self.working_memory.get("user_profile_facts", {}),
        }

    def update_phase(self, phase: str):
        self.working_memory["dialogue_phase"] = phase
        self.save()

    def update_explored_topics(self, topics: List[str]):
        current = set(self.working_memory.get("explored_topics", []))
        current.update([item for item in topics if item])
        self.working_memory["explored_topics"] = list(current)
        self.save()

    def update_pending_nodes(self, nodes: List[str]):
        self.working_memory["pending_socratic_nodes"] = nodes or []
        self.save()

    def update_last_plan(self, plan: Dict[str, Any]):
        self.working_memory["last_planner_plan"] = plan
        self.save()

    def save(self):
        with open(self.work_memory_path, "w", encoding="utf-8") as f:
            json.dump(self.working_memory, f, ensure_ascii=False, indent=2)

    def restore(self):
        if not self.work_memory_path.exists():
            return
        try:
            data = json.loads(self.work_memory_path.read_text(encoding="utf-8"))
            self.working_memory.update(data)
            self.working_memory.setdefault("dialogue_phase", "OPENING")
            self.working_memory.setdefault("risk_trajectory", [])
            self.working_memory.setdefault("explored_topics", [])
            self.working_memory.setdefault("pending_socratic_nodes", [])
            self.working_memory.setdefault("user_profile_facts", {})
            self.working_memory.setdefault("last_planner_plan", None)
            self.working_memory.setdefault("turn_counter", 0)
        except Exception as e:
            print(f"恢复工作记忆失败: {e}")

    def _save_short_term(self):
        payload = [self._turn_to_dict(turn) for turn in self.short_term_memory]
        with open(self.short_term_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    def _restore_short_term(self):
        if not self.short_term_path.exists():
            return
        try:
            payload = json.loads(self.short_term_path.read_text(encoding="utf-8"))
            self.short_term_memory.clear()
            for item in payload:
                self.short_term_memory.append(self._dict_to_turn(item))
        except Exception as e:
            print(f"恢复短期记忆失败: {e}")

    @staticmethod
    def _turn_to_dict(turn: TurnMemory) -> Dict[str, Any]:
        return {
            "role": turn.role,
            "content": turn.content,
            "timestamp": turn.timestamp,
            "risk": turn.risk,
            "metadata": turn.metadata,
        }

    @staticmethod
    def _dict_to_turn(data: Dict[str, Any]) -> TurnMemory:
        return TurnMemory(
            role=data.get("role", "user"),
            content=data.get("content", ""),
            timestamp=data.get("timestamp", time.time()),
            risk=data.get("risk"),
            metadata=data.get("metadata", {}),
        )


def create_async_summary_agent(callLLM_func, executor):
    async def summary_agent(turns: List[TurnMemory]) -> Tuple[str, Dict[str, Any]]:
        dialogue_text = "\n".join(f"{t.role}: {t.content}" for t in turns)
        prompt = f"""你是一名心理支持对话摘要助手。请阅读以下对话片段，完成两件事：
1. 用不超过150字总结这段对话的核心情况。
2. 提取用户关键事实，输出 JSON 对象，字段可包含 mood、recent_stressors、sleep、social_support、help_seeking、protective_factors。

输出格式严格为：
summary: <摘要>
facts: <JSON>

对话片段：
{dialogue_text}
"""
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(executor, lambda: callLLM_func(prompt))
        try:
            parts = response.split("facts:")
            summary_part = parts[0].replace("summary:", "").strip()
            facts_part = parts[1].strip() if len(parts) > 1 else "{}"
            facts = json.loads(facts_part)
        except Exception:
            summary_part = response[:150]
            facts = {}
        return summary_part, facts

    return summary_agent
