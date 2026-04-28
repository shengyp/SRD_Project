import json
import traceback
from pathlib import Path
from dataclasses import asdict
from typing import Dict, Any, List, Optional
from datetime import datetime

from utils import dict_to_outline_str, deep_update, pretty_print_trajectory


class MemoryManager:
    # 默认思维导图结构
    DEFAULT_MIND_MAP = {
        "mindMap": {
            "root": {
                "name": "心理健康话题",
                "children": []
            }
        }
    }

    def __init__(
            self,
            memory_dir: str,
            output_dir: Path,
            use_memory: bool = True
    ):
        self.memory_dir = Path(memory_dir)
        self.output_dir = output_dir
        self.use_memory = use_memory

        self.application_memory: Dict[str, Any] = self._load_memory(
            self.memory_dir / "application_memory.json"
        )
        self.methodology_memory: Dict[str, Any] = self._load_memory(
            self.memory_dir / "methodology_memory.json"
        )

        self.history: List[dict] = self._load_memory(
            self.memory_dir / "history.json",
            default=[]
        )

        # 思维导图存储
        self.mind_map: Dict[str, Any] = self._load_memory(
            self.memory_dir / "mind_map.json",
            default=self.DEFAULT_MIND_MAP
        )

        self.app_guide_str = dict_to_outline_str(self.application_memory)
        self.metho_guide_str = dict_to_outline_str(self.methodology_memory)

        self.update_system_prompt()

    @staticmethod
    def _load_memory(memory_path: Path, default=None):
        if default is None:
            default = {}
        try:
            with open(memory_path, "r", encoding="utf-8") as f:
                text = f.read().strip()
                if not text:
                    return default
                return json.loads(text)
        except FileNotFoundError:
            return default
        except Exception as e:
            print(f"{e}")
            traceback.print_exc()
            return default

    @staticmethod
    def _save_memory(memory_path: Path, data: Any):
        try:
            memory_path.parent.mkdir(parents=True, exist_ok=True)
            with open(memory_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f" {e}")
            traceback.print_exc()

    def _build_system_prompt(self) -> str:
        if self.use_memory:
            memory_section = f"""
                                【应用记忆】（检索优化经验）
                                {self.app_guide_str}
                                
                                【方法论记忆】（成功问题分解模式）
                                {self.metho_guide_str}
                            """
        else:
            memory_section = ""

        system_prompt = f"""
                            你是一名专业的自杀危机干预助手。
                            {memory_section}
                            请基于对话历史，结合你的专业知识，提供温暖、共情、有效的心理支持。
                        """
        return system_prompt

    def update_system_prompt(self):
        sys_content = self._build_system_prompt()
        system_msg = {"role": "system", "content": sys_content}

        if not self.history or self.history[0].get("role") != "system":
            self.history.insert(0, system_msg)
        else:
            self.history[0] = system_msg

    def add_turn(self, user_message: str, assistant_message: str):
        timestamp = datetime.now().timestamp()
        self.history.append({
            "role": "user",
            "content": user_message,
            "timestamp": timestamp
        })
        self.history.append({
            "role": "assistant",
            "content": assistant_message,
            "timestamp": timestamp
        })
        self._save_memory(self.memory_dir / "history.json", self.history)

    def add_message(self, role: str, content: str):
        self.history.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().timestamp()
        })
        self._save_memory(self.memory_dir / "history.json", self.history)

    def add_traj(self, trajectory: List[dict]):
        for msg in trajectory:
            if "timestamp" not in msg:
                msg["timestamp"] = datetime.now().timestamp()
            self.history.append(msg)
        self._save_memory(self.memory_dir / "history.json", self.history)

    def get_history(self) -> List[dict]:
        return self.history

    def get_recent_history(self, hours: Optional[float] = None, limit: Optional[int] = None) -> List[dict]:
        filtered = self.history

        if hours is not None:
            cutoff = datetime.now().timestamp() - hours * 3600
            filtered = [msg for msg in filtered if msg.get("timestamp", 0) >= cutoff]

        if limit is not None:
            filtered = filtered[-limit:]

        return filtered

    def get_recent_user_inputs(self, hours: float = 24, limit: int = 50) -> List[str]:
        recent = self.get_recent_history(hours=hours, limit=limit)
        return [msg["content"] for msg in recent if msg.get("role") == "user"]

    def trim_history(self, preserve_last: int = 10):
        if len(self.history) < 2:
            return
        system = self.history[0] if self.history[0].get("role") == "system" else None
        keep = 1 + 2 * preserve_last
        if system:
            self.history = [system] + self.history[-keep + 1:] if len(self.history) > keep else self.history
        else:
            self.history = self.history[-keep:] if len(self.history) > keep else self.history
        self._save_memory(self.memory_dir / "history.json", self.history)

    def update_application_memory(self, new_conclusion: dict):
        if not self.use_memory:
            return
        deep_update(self.application_memory, new_conclusion)
        self.app_guide_str = dict_to_outline_str(self.application_memory)
        self._save_memory(self.memory_dir / "application_memory.json", self.application_memory)
        self.update_system_prompt()

    def update_methodology_memory(self, new_pattern: dict, pattern_key: Optional[str] = None):
        if not self.use_memory:
            return
        if pattern_key is None:
            pattern_key = f"pattern_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.methodology_memory[pattern_key] = new_pattern
        self.metho_guide_str = dict_to_outline_str(self.methodology_memory)
        self._save_memory(self.memory_dir / "methodology_memory.json", self.methodology_memory)
        self.update_system_prompt()

    def get_all_methodology(self) -> Dict:
        return self.methodology_memory

    def get_all_application_memory(self) -> Dict:
        return self.application_memory

    def save_all_memory_to_disk(self):
        self._save_memory(self.memory_dir / "application_memory.json", self.application_memory)
        self._save_memory(self.memory_dir / "methodology_memory.json", self.methodology_memory)

    def save_run_artifacts(self, extra_info: dict = None):
        output_dir = self.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        history_path = output_dir / "history.txt"
        history_str = pretty_print_trajectory(self.history, show_full_content=True, print_to_terminal=False)
        with open(history_path, "w", encoding="utf-8") as f:
            f.write(history_str)

        overall_state = {
            "monitor_state": {},
            "memory_snapshot": {
                "application_memory": self.application_memory,
                "methodology_memory": self.methodology_memory,
                "history_count": len(self.history)
            }
        }
        if extra_info:
            overall_state.update(extra_info)

        state_path = output_dir / "overall_state.json"
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(overall_state, f, indent=4, ensure_ascii=False)

    def get_patient_record(self, session_id: str) -> Optional[Dict]:
        record_path = self.memory_dir / f"patient_record_{session_id}.json"
        return self._load_memory(record_path, default=None)

    def save_patient_record(self, session_id: str, record_data: Dict):
        record_path = self.memory_dir / f"patient_record_{session_id}.json"
        self._save_memory(record_path, record_data)

    def get_mind_map(self) -> Dict:
        """获取当前思维导图。"""
        return self.mind_map

    def save_mind_map(self, mind_map_data: Dict):
        """保存思维导图。"""
        self.mind_map = mind_map_data
        self._save_memory(self.memory_dir / "mind_map.json", self.mind_map)

    def reset_mind_map(self):
        """重置思维导图到默认状态。"""
        self.mind_map = self.DEFAULT_MIND_MAP.copy()
        self._save_memory(self.memory_dir / "mind_map.json", self.mind_map)
