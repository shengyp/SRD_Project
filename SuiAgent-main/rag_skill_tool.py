from langchain_core.tools import tool
from pathlib import Path
import subprocess
import asyncio
import time
import re
import jieba
import json
from typing import List, Dict, Optional, Union, Tuple
from LLM import callLLM


class RAGSkillTool:
    def __init__(self, knowledge_base_path: str = "rag-skill/knowledge",
                 references_path: str = "rag-skill/.agent/skills/rag-skill/references",
                 max_search_attempts: int = 3,
                 context_window: int = 300):
        self.knowledge_base_path = Path(knowledge_base_path).absolute()
        self.references_path = Path(references_path).absolute()
        self.max_attempts = max_search_attempts
        self.context_window = context_window
        self.top_k = 5
        self.format_handlers = {
            ".md": lambda fp: self._read_markdown(fp),
            ".pdf": lambda fp: self._read_pdf(fp),
            ".xlsx": lambda fp: self._read_excel(fp),
            ".xls": lambda fp: self._read_excel(fp),
            ".txt": lambda fp: self._read_text(fp)
        }
        self.index_cache = {}
        self.last_index_load = 0
        self.index_cache_ttl = 3600

    def _read_markdown(self, file_path: Path) -> str:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            print(f"读取Markdown失败: {e}")
            return ""

    def _read_text(self, file_path: Path) -> str:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            print(f"读取文本失败: {e}")
            return ""

    def _read_pdf(self, file_path: Path) -> str:
        pdf_handler_md = self.references_path / "pdf_reading.md"
        if pdf_handler_md.exists():
            with open(pdf_handler_md, "r", encoding="utf-8") as f:
                _ = f.read()

        try:
            result = subprocess.run(
                ["pdftotext", str(file_path), "-"],
                capture_output=True,
                encoding="utf-8"
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            try:
                import pdfplumber
                with pdfplumber.open(file_path) as pdf:
                    return "\n".join([page.extract_text() or "" for page in pdf.pages])
            except Exception as e:
                print(f"读取PDF失败: {e}")
                return ""

    def _read_excel(self, file_path: Path) -> str:
        excel_handler_md = self.references_path / "excel_reading.md"
        if excel_handler_md.exists():
            with open(excel_handler_md, "r", encoding="utf-8") as f:
                _ = f.read()
        try:
            import pandas as pd
            df = pd.read_excel(file_path)
            return (
                f"文件：{file_path.name}\n"
                f"列名：{', '.join(df.columns.tolist())}\n"
                f"数据行数：{len(df)}\n"
                f"前10行数据：\n{df.head(10).to_string(index=False)}"
            )
        except Exception as e:
            print(f"读取Excel失败: {e}")
            return ""

    def _extract_query_keywords(self, query: str) -> List[str]:
        prompt = f"""
        请从以下用户查询中提取用于检索文献的具体关键词。
        要求：
        - 关键词应当是领域专业术语，而非通用词汇。
        - 返回一个JSON数组，格式如：["关键词1", "关键词2", ...]
        - 如果查询本身已经是具体术语，直接返回包含该术语的数组。
        - 优先使用大概率在文中直接出现的简短表达，每个关键词都要有2-3个近义表达。

        用户查询：{query}
        """
        try:
            response = callLLM(prompt).strip()
            keywords = json.loads(response)
            if isinstance(keywords, list):
                return [k for k in keywords if isinstance(k, str) and k.strip()]
        except Exception as e:
            print(f"LLM关键词提取失败，使用jieba备用方案: {e}")
            return self._extract_keywords(query)
        return []

    def _extract_keywords(self, text: str) -> List[str]:
        try:
            stopwords = {'的', '了', '和', '是', '我', '你', '他', '她', '它', '在', '有', '就', '不', '及', '与', '对于'}
            words = jieba.lcut(text)
            return [w for w in words if w not in stopwords and len(w) > 1][:10]
        except ImportError:
            return [w for w in text.split() if len(w) > 1][:10]

    def _generate_retreat_keywords(self, current_keywords: List[str]) -> List[str]:
        prompt = f"""
        以下关键词在文档中未找到匹配内容：
        {current_keywords}

        请生成 1~3 个更宽泛、更常见、更短的关键词（例如从“抑郁核心症状”泛化为“抑郁”）。
        要求：
        - 每个关键词不超过 3 个汉字或英文单词
        - 优先使用文档中可能直接出现的表达
        - 输出一个 JSON 数组，如：["抑郁", "depression"]
        只输出 JSON，无其他文字。
        """
        try:
            response = callLLM(prompt).strip()
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
            new_kws = json.loads(response)
            if isinstance(new_kws, list) and len(new_kws) > 0:
                return [kw for kw in new_kws if isinstance(kw, str) and kw.strip()]
        except Exception as e:
            print(f"泛化关键词生成失败: {e}")

    def _search_context_in_file(self, file_path: Path, keywords: List[str]) -> List[str]:
        suffix = file_path.suffix.lower()
        if suffix not in self.format_handlers:
            print(f"不支持的文件格式: {suffix}")
            return []

        content = self.format_handlers[suffix](file_path)
        if not content:
            return []

        positions = []
        for kw in keywords:
            if not kw:
                continue
            pattern = re.compile(re.escape(kw), re.IGNORECASE)
            for match in pattern.finditer(content):
                positions.append(match.start())

        if not positions:
            return []

        positions = sorted(set(positions))

        fragments = []
        half_window = self.context_window // 2
        merged_start = None
        merged_end = None

        for pos in positions:
            start = max(0, pos - half_window)
            end = min(len(content), pos + half_window)

            if merged_start is None:
                merged_start, merged_end = start, end
            elif start <= merged_end:
                merged_end = max(merged_end, end)
            else:
                fragments.append(content[merged_start:merged_end].strip())
                merged_start, merged_end = start, end

        if merged_start is not None:
            fragments.append(content[merged_start:merged_end].strip())

        unique_fragments = []
        seen = set()
        for frag in fragments:
            if frag not in seen:
                seen.add(frag)
                unique_fragments.append(frag)

        return unique_fragments

    def _evaluate_context_and_generate_keyword(self, query: str, cur_kw: List[str], context_fragments: List[str],
                                               attempt: int) -> Tuple[bool, List[str]]:
        if not context_fragments:
            if attempt >= self.max_attempts - 1:
                return False, []
            else:
                prompt = f"""
                用户查询：{query}
                以下针对用户查询生成的关键词在文档中未找到匹配内容：
                {cur_kw}

                请为每个关键词生成 1~3 个更宽泛、更常见、更短的关键词（例如从“抑郁核心症状”泛化为“抑郁”）。
                要求：
                - 每个关键词不超过 3 个汉字或英文单词
                - 优先使用文档中可能直接出现的表达
                最终的输出格式为关键词组成的数组，无其他文字。
                返回格式：只返回关键词组成的数组本身，无其他内容。
                """
                response = callLLM(prompt).strip()
                print(response)
                try:
                    if response.startswith("```json"):
                        response = response[7:]
                    if response.endswith("```"):
                        response = response[:-3]
                    new_keywords = json.loads(response)
                    if isinstance(new_keywords, list):
                        new_keywords = [kw for kw in new_keywords if isinstance(kw, str) and kw.strip()]
                        return False, new_keywords
                    else:
                        return False, []
                except Exception as e:
                    print(f"解析泛化关键词失败: {e}")
                    return False, []

        context_str = "\n\n---\n\n".join(context_fragments)
        prompt = f"""
        请判断以下检索到的上下文片段是否足以回答用户查询。
        用户查询：{query}
        当前已检索到的上下文片段（共{len(context_fragments)}段）：
        {context_str}

        如果信息充分，可以生成高质量答案，请返回 JSON：{{"sufficient": true, "new_keyword": null}}
        如果信息不足，请提供一个新的搜索关键词（单个专业术语，用于在文献中定位更多相关内容），返回 JSON：{{"sufficient": false, "new_keyword": "你的新关键词"}}
        仅返回JSON，无其他内容。
        """

        try:
            response = callLLM(prompt).strip()
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
            data = json.loads(response)
            sufficient = data.get("sufficient", False)
            new_keyword = data.get("new_keyword")
            if sufficient:
                return True, []
            else:
                return False, [new_keyword] if new_keyword else []
        except Exception as e:
            print(f"LLM评估失败: {e}")
            return False, []

    def _call_llm_for_dir(self, index_content: str, query: str, prompt_type: str = "root") -> Union[str, List[str]]:
        if prompt_type == "root":
            prompt = f"""
            你需要分析用户查询和根目录索引文件内容，返回需要进入的子目录名称（仅返回目录名，无多余内容）。
            用户查询：{query}
            根索引内容：
            {index_content}
            """
            llm_response = callLLM(prompt)
            return llm_response.strip()
        else:
            prompt = f"""
            你需要分析用户查询和子目录索引文件内容，返回所有可能需要检索的文件名（含后缀，
            比如 "guide.md"、"tables.xlsx"）。请将文件名以 JSON 数组格式输出，例如
            ["file1.md", "file2.pdf"]。如果查询只对应一个文件，也仍然用数组格式包裹。
            只输出 JSON 数组，不要包含任何其他文字。
            用户查询：{query}
            子索引内容：
            {index_content}
            """
            llm_response = callLLM(prompt).strip()
            try:
                if llm_response.startswith("```json"):
                    llm_response = llm_response[7:]
                if llm_response.endswith("```"):
                    llm_response = llm_response[:-3]
                filenames = json.loads(llm_response)
                if isinstance(filenames, list):
                    return [f.strip() for f in filenames if isinstance(f, str) and f.strip()]
                else:
                    print("LLM 返回的不是列表，使用原字符串作为单个文件名")
                    return [llm_response.strip()] if llm_response.strip() else []
            except Exception as e:
                print(f"解析子目录文件名列表失败: {e}，使用原字符串作为单个文件名")
                return [llm_response.strip()] if llm_response.strip() else []

    async def _locate_target_file(self, query: str) -> List[Path]:
        root_index_path = self.knowledge_base_path / "data_structure.md"
        if not root_index_path.exists():
            print("根索引文件不存在，无法定位")
            return []

        root_index_content = self._read_markdown(root_index_path)
        target_subdir_name = self._call_llm_for_dir(root_index_content, query, prompt_type="root")
        if not target_subdir_name or not isinstance(target_subdir_name, str):
            print("LLM未返回有效子目录")
            return []

        subdir_path = self.knowledge_base_path / target_subdir_name
        sub_index_path = subdir_path / "data_structure.md"
        if not sub_index_path.exists():
            print(f"子目录{target_subdir_name}无索引文件")
            return []

        sub_index_content = self._read_markdown(sub_index_path)
        target_filenames = self._call_llm_for_dir(sub_index_content, query, prompt_type="sub")
        if not target_filenames:
            print("LLM未返回有效文件名列表")
            return []

        valid_files = []
        for fname in target_filenames:
            file_path = subdir_path / fname
            if file_path.exists():
                valid_files.append(file_path)
            else:
                print(f"文件不存在: {file_path}")
        return valid_files

    def _search_in_file(self, file_path: Path, query: str) -> List[str]:
        suffix = file_path.suffix.lower()
        if suffix not in self.format_handlers:
            return []

        content = self.format_handlers[suffix](file_path)
        if not content:
            return []

        prompt = f"""
                    请你从以下文件内容中，精准提取与用户查询直接相关的原文内容（不要改写、不要总结，仅复制原文，若原文为英文，则将相关原文内容翻译后返回）。
                    如果有多个相关段落/句子，都列出来；如果没有相关内容，返回空字符串。

                    文件名称：{file_path.name}
                    用户查询：{query}
                    文件内容：
                    {content}

                    输出要求：
                    1. 仅返回提取的原文内容，每行一个相关片段；
                    2. 不要添加任何解释、标题、格式标记；
                    3. 确保内容完全来自原文，不编造任何信息；
                    4. 最多返回{self.top_k}个相关片段。
                    """
        llm_extracted = callLLM(prompt).strip()
        # print(f"llm_extracted:{llm_extracted}\n")
        if not llm_extracted:
            return []

        matched_lines = []
        extracted_fragments = [frag.strip() for frag in llm_extracted.split("\n") if frag.strip()]
        for fragment in extracted_fragments[:self.top_k]:
            matched_lines.append(fragment)
        return matched_lines

    def _call_llm_for_answer(self, query: str, context_list: List[str]) -> str:
        context_str = "\n\n".join(context_list)
        prompt = f"""
                基于以下检索到的上下文信息，回答用户查询。要求答案准确、简洁，仅基于上下文内容，不编造信息，回答前缀为：”根据检索到的信息“。注意：当检索上下文为空时，使用你已有的知识直接进行回答，并且不需要回答前缀。
                用户查询：{query}
                检索上下文：
                {context_str}
                """
        return callLLM(prompt)

    async def retrieve(self, query: str) -> Dict[str, Union[str, List[Dict[str, str]], List[str]]]:
        if not query.strip():
            return {"LLM_ans": "查询内容不能为空", "target_file": [], "rela_text": []}

        target_files = await self._locate_target_file(query)
        if not target_files:
            print("未找到目标文件")
            return {"LLM_ans": "未找到匹配的目标文件", "target_file": [], "rela_text": []}

        print(f"已找到 {len(target_files)} 个目标文件: {[f.name for f in target_files]}")

        initial_keywords = self._extract_query_keywords(query)
        print(f"初始关键词: {initial_keywords}")

        all_context_fragments = []
        file_infos = [{"name": fp.name, "path": str(fp)} for fp in target_files]

        for file_path in target_files:
            print(f"开始搜索文件: {file_path.name}")
            current_keywords = initial_keywords.copy()
            used_keywords = set(current_keywords)
            file_fragments = []

            for attempt in range(self.max_attempts):
                print(f" 第 {attempt + 1} 次搜索，关键词: {current_keywords}")
                new_fragments = self._search_context_in_file(file_path, current_keywords)
                print(f" 找到 {len(new_fragments)} 个新上下文片段")

                for frag in new_fragments:
                    if frag not in file_fragments:
                        file_fragments.append(frag)

                sufficient, new_keywords = self._evaluate_context_and_generate_keyword(
                    query, current_keywords, file_fragments, attempt
                )

                if sufficient:
                    print(" 上下文已充分")
                    break

                if attempt == self.max_attempts - 1:
                    print("已达到最大尝试次数")
                    break

                if not new_keywords:
                    print("无法生成有效新关键词")
                    break

                for kw in new_keywords:
                    if kw and kw not in used_keywords:
                        used_keywords.add(kw)
                        if kw not in current_keywords:
                            current_keywords.append(kw)

            if not file_fragments:
                print(f"使用LLM阅读: {file_path.name}")
                llm_fragments = self._search_in_file(file_path, query)
                for frag in llm_fragments:
                    if frag not in file_fragments:
                        file_fragments.append(frag)

            all_context_fragments.extend(file_fragments)

        if not all_context_fragments:
            return {
                "LLM_ans": "未在所有目标文件中找到相关信息",
                "target_file": file_infos,
                "rela_text": []
            }

        final_answer = self._call_llm_for_answer(query, all_context_fragments)

        return {
            "LLM_ans": final_answer,
            "target_file": file_infos,
            "rela_text": all_context_fragments
        }

    def _extract_triples(self, context_fragments: List[str],query:str) -> List[Dict]:
        if not context_fragments:
            return []

        combined_text = "\n\n".join(context_fragments)

        prompt = f"""你是一个知识图谱构建专家。请从以下文献片段中提取与用户查询相关的、心理健康、自杀干预相关的知识三元组。
                    每个三元组表示为：主语、谓语、宾语，并附带出处和原文证据。
                    
                    要求：
                    - 主语、宾语应是具体的实体或概念（如“抑郁症”、“氟西汀”、“失眠”）。
                    - 谓语描述两者之间的关系（如“一线药物”、“副作用”、“推荐剂量”、“危险因素”）。
                    - 每个三元组必须给出原文证据（直接引用原文中支持该三元组的句子）。
                    - 如果同一关系有多个宾语，分拆为多个三元组。
                    - 输出一个 JSON 数组，每个元素包含 subject, predicate, object, evidence 字段。
                    - 只输出 JSON，不要其他文字。
                    
                    文献内容：
                    {combined_text}
                    用户查询：
                    {query}
                    
                    输出示例：
                    [
                      {{
                        "subject": "抑郁症",
                        "predicate": "一线药物",
                        "object": "SSRI类",
                        "evidence": "选择性5-羟色胺再摄取抑制剂（SSRIs）是抑郁症的一线治疗药物。"
                      }},
                      {{
                        "subject": "氟西汀",
                        "predicate": "常见副作用",
                        "object": "恶心",
                        "evidence": "氟西汀最常见的副作用包括恶心、失眠和头痛。"
                      }}
                    ]
                    """
        try:
            response = callLLM(prompt).strip()
            if response.startswith("```json"):
                response = response[7:]
            if response.endswith("```"):
                response = response[:-3]
            triples = json.loads(response)
            if isinstance(triples, list):
                return triples
            return []
        except Exception as e:
            print(f"三元组抽取失败: {e}")
        return []


@tool(
    "rag_skill_local_knowledge",
    return_direct=False,
    description="从本地知识库中检索与查询相关的信息，返回包含答案、来源文件（含文件名和路径）和相关文本片段的字典。"
)
async def rag_skill_tool_func(query: str, knowledge_base_path: str = "./knowledge") -> Dict[
    str, Union[str, List[Dict[str, str]], List[str]]]:
    rag_skill = RAGSkillTool(knowledge_base_path)
    return await rag_skill.retrieve(query)


def create_rag_skill_tool(knowledge_base_path: str = "./knowledge"):
    async def bound_rag_skill(query: str) -> Dict[str, Union[str, List[Dict[str, str]], List[str]]]:
        return await rag_skill_tool_func.ainvoke({
            "query": query,
            "knowledge_base_path": knowledge_base_path
        })

    return bound_rag_skill


async def test_rag_skill():
    rag_tool = RAGSkillTool()
    print("查询：2026年AI Agent技术有哪些关键发展趋势？")
    result = await rag_tool.retrieve("2026年AI Agent技术有哪些关键发展趋势？")
    print("答案:", result["LLM_ans"])
    print("来源文件:", result["target_file"])
    print("相关文本片段:", result["rela_text"])


if __name__ == "__main__":
    start_time = time.time()
    asyncio.run(test_rag_skill())
    end_time = time.time()
    print(f"总用时:{end_time - start_time}s")
