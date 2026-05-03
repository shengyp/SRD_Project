import os
from dataclasses import dataclass
from typing import Dict, Any, List, Optional


@dataclass
class MemoryConfig:
    memory_dir: str = "memory"
    short_term_window: int = 3600
    long_term_window: int = 86400
    use_memory: bool = True
    update_memory: bool = True


@dataclass
class AgentConfig:
    agent_name: str = "suicide_intervention_agent"
    output_dir: str = "outputs"
    max_retrieval_attempts: int = 3
    rag_chunk_size: int = 1000
    rag_top_k: int = 5
    max_subquestions: int = 10
    subquestion_confidence_threshold: float = 0.7


config = AgentConfig()
memory_config = MemoryConfig()