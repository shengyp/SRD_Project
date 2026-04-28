import json
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import asdict


class AgentLogger:
    """自杀危机干预Agent专用日志类，记录对话、问题分解、记忆更新和错误信息"""

    def __init__(self,
                 log_dir: str = "./agent_logs",
                 agent_name: str = "suicide_intervention_agent",
                 session_id: Optional[str] = None):  # 新增session_id参数
        """
        初始化日志器
        :param log_dir: 日志存储目录
        :param agent_name: Agent名称（用于区分不同Agent的日志）
        :param session_id: 会话ID（若不传则自动生成，传则使用指定值）
        """
        self.log_dir = Path(log_dir)
        self.agent_name = agent_name

        # 创建日志目录结构
        self.base_dir = self.log_dir / agent_name
        self.conversation_dir = self.base_dir / "conversations"
        self.decomposition_dir = self.base_dir / "decomposition"
        self.memory_dir = self.base_dir / "memory_updates"
        self.error_dir = self.base_dir / "errors"

        # 确保目录存在
        for dir_path in [self.base_dir, self.conversation_dir, self.decomposition_dir,
                         self.memory_dir, self.error_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)

        # 会话ID（优先使用传入的，否则自动生成）
        self.session_id = session_id if session_id else f"session_{int(time.time())}"
        self.current_turn = 0

    def _get_timestamp(self) -> str:
        """获取格式化的时间戳"""
        return datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")[:-3]  # 精确到毫秒

    def _save_json(self, data: Dict[str, Any], save_dir: Path, prefix: str) -> str:
        """
        保存JSON数据到指定目录
        :param data: 要保存的字典数据
        :param save_dir: 保存目录
        :param prefix: 文件名前缀
        :return: 保存的文件路径
        """
        filename = f"{prefix}_{self.session_id}_turn_{self.current_turn}_{self._get_timestamp()}.json"
        file_path = save_dir / filename

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return str(file_path)

    def log_conversation(self, user_input: str, agent_response: str,
                         emocc_risk: str, fealearn_risk: str, intent: str) -> str:
        """
        记录单次对话内容
        :param user_input: 用户输入
        :param agent_response: Agent回复
        :param emocc_risk: emocc风险评估结果
        :param fealearn_risk: fealearn风险评估结果
        :param intent: 用户意图分类结果
        :return: 日志文件路径
        """
        self.current_turn += 1

        conversation_data = {
            "session_id": self.session_id,
            "turn": self.current_turn,
            "timestamp": self._get_timestamp(),
            "user_input": user_input,
            "agent_response": agent_response,
            "risk_assessment": {
                "emocc_risk": emocc_risk,
                "fealearn_risk": fealearn_risk
            },
            "intent_classification": intent,
            "agent_name": self.agent_name
        }

        return self._save_json(conversation_data, self.conversation_dir, "conversation")

    def log_decomposition(self, original_query: str, subquestions: List[Any],
                          retrieval_results: Dict[str, List[str]]) -> str:
        """
        记录问题分解流程（JSON格式）
        :param original_query: 原始用户问题
        :param subquestions: 分解后的子问题列表（SubQuestion对象列表）
        :param retrieval_results: 子问题对应的检索结果
        :return: 日志文件路径
        """
        # 转换SubQuestion对象为字典
        subquestions_dict = []
        for subq in subquestions:
            try:
                # 如果是SubQuestion对象，转换为字典
                subq_dict = asdict(subq) if hasattr(subq, '__dataclass_fields__') else subq
                # 添加该子问题的检索结果
                subq_dict["retrieval_results"] = retrieval_results.get(subq_dict.get("question", ""), [])
                subquestions_dict.append(subq_dict)
            except Exception as e:
                subquestions_dict.append({
                    "question": str(subq),
                    "error": f"转换失败: {str(e)}",
                    "retrieval_results": []
                })

        decomposition_data = {
            "session_id": self.session_id,
            "turn": self.current_turn,
            "timestamp": self._get_timestamp(),
            "original_query": original_query,
            "subquestions": subquestions_dict,
            "total_subquestions": len(subquestions_dict),
            "successful_retrievals": len([sq for sq in subquestions_dict if sq["retrieval_results"]]),
            "failed_retrievals": len([sq for sq in subquestions_dict if not sq["retrieval_results"]])
        }

        return self._save_json(decomposition_data, self.decomposition_dir, "decomposition")

    def log_memory_update(self, memory_type: str, memory_content: Dict[str, Any],
                          update_reason: str = "") -> str:
        """
        记录记忆更新（方法论记忆/应用记忆）
        :param memory_type: 记忆类型（methodology/application）
        :param memory_content: 要更新的记忆内容
        :param update_reason: 更新原因
        :return: 日志文件路径
        """
        memory_data = {
            "session_id": self.session_id,
            "turn": self.current_turn,
            "timestamp": self._get_timestamp(),
            "memory_type": memory_type,
            "update_reason": update_reason,
            "memory_content": memory_content,
            "agent_name": self.agent_name
        }

        return self._save_json(memory_data, self.memory_dir, f"memory_{memory_type}")

    def log_error(self, error_context: str, error_message: str,
                  traceback_info: Optional[str] = None) -> str:
        """
        记录错误信息
        :param error_context: 错误发生的上下文（如"问题分解"、"检索"、"生成回复"）
        :param error_message: 错误信息
        :param traceback_info: 堆栈跟踪信息
        :return: 日志文件路径
        """
        error_data = {
            "session_id": self.session_id,
            "turn": self.current_turn,
            "timestamp": self._get_timestamp(),
            "error_context": error_context,
            "error_message": error_message,
            "traceback": traceback_info or traceback.format_exc(),
            "agent_name": self.agent_name
        }

        return self._save_json(error_data, self.error_dir, "error")

    def set_session_id(self, session_id: str):
        """手动设置会话ID（用于接续会话）"""
        self.session_id = session_id
        # 可选：重置轮次计数（根据你的业务需求决定是否保留）
        # self.current_turn = 0

    def get_latest_logs(self, log_type: str = "conversation", limit: int = 5) -> List[str]:
        """
        获取最新的日志文件路径
        :param log_type: 日志类型（conversation/decomposition/memory/error）
        :param limit: 获取数量
        :return: 日志文件路径列表
        """
        dir_mapping = {
            "conversation": self.conversation_dir,
            "decomposition": self.decomposition_dir,
            "memory": self.memory_dir,
            "error": self.error_dir
        }

        log_dir = dir_mapping.get(log_type, self.conversation_dir)
        # 按修改时间排序，获取最新的文件
        log_files = sorted(
            log_dir.glob("*.json"),
            key=lambda f: f.stat().st_mtime,
            reverse=True
        )

        return [str(f) for f in log_files[:limit]]


# 修改全局日志器实例（默认仍自动生成session_id，保持向后兼容）
logger = AgentLogger()


# 便捷函数（新增一个创建指定session_id的日志器的函数）
def create_logger_with_session_id(session_id: str,
                                 log_dir: str = "./agent_logs",
                                 agent_name: str = "suicide_intervention_agent") -> AgentLogger:
    """创建带有指定session_id的日志器实例"""
    return AgentLogger(log_dir=log_dir, agent_name=agent_name, session_id=session_id)


def log_conversation(user_input: str, agent_response: str, emocc_risk: str, fealearn_risk: str, intent: str):
    """便捷记录对话"""
    return logger.log_conversation(user_input, agent_response, emocc_risk, fealearn_risk, intent)


def log_decomposition(original_query: str, subquestions: List[Any], retrieval_results: Dict[str, List[str]]):
    """便捷记录问题分解"""
    return logger.log_decomposition(original_query, subquestions, retrieval_results)


def log_memory_update(memory_type: str, memory_content: Dict[str, Any], update_reason: str = ""):
    """便捷记录记忆更新"""
    return logger.log_memory_update(memory_type, memory_content, update_reason)


def log_error(error_context: str, error_message: str, traceback_info: Optional[str] = None):
    """便捷记录错误"""
    return logger.log_error(error_context, error_message, traceback_info)


def set_logger_session_id(session_id: str):
    """设置日志器会话ID"""
    logger.set_session_id(session_id)