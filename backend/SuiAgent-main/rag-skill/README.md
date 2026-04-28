# VIS4SRD 心理健康知识库检索 Skill

> 一个专为心理健康领域本地知识库智能检索设计的 AI Skill，展示如何通过分层索引和渐进式检索实现高效的多格式文件问答系统。

## 目录结构

```
rag-skill/
├── .agent/
│   └── skills/
│       └── rag-skill/          # 核心 Skill
│           ├── SKILL.md           # Skill 主文件
│           ├── references/        # 文件处理方法指南
│           │   ├── pdf_reading.md
│           │   ├── excel_reading.md
│           │   ├── excel_analysis.md
│           │   └── docx_reading.md
│           └── scripts/          # 转换脚本
│               ├── convert_pdf_to_images.py
│               ├── convert_docx_to_text.py
│               └── extract_docx_tables.py
├── knowledge/                    # 知识库
│   ├── data_structure.md         # 根目录索引
│   ├── 自杀与自伤/              # 主标题
│   │   ├── 自杀预防与教育/       # 子标题
│   │   └── ...
│   ├── 抑郁/
│   ├── 焦虑/
│   ├── 危机干预/
│   ├── 情绪/
│   ├── 睡眠与生理/
│   ├── 量表与筛查/
│   ├── 干预与求助资源/
│   └── 心理健康素养/
└── README.md                    # 本文件
```

## 核心特性

- **多格式支持** - Markdown、TXT、PDF、Excel、DOCX 等多种文件格式
- **分层索引** - 通过 `data_structure.md` 实现智能目录导航
- **渐进式检索** - 避免全文加载，按需局部读取，节省 token
- **强制学习机制** - 处理 PDF/Excel/DOCX 前必须先学习处理方法
- **多轮迭代** - 最多 5 轮智能检索，确保找到最相关信息

## 知识库主题

| 主题 | 说明 | 子主题数 |
|------|------|---------|
| 自杀与自伤 | WHO mhGAP 核心关注领域 | 4 |
| 抑郁 | 《中国抑郁障碍防治指南2025版》 | 4 |
| 焦虑 | GAD-7 评估与应对 | 3 |
| 危机干预 | 国家卫健委12356热线指南 | 3 |
| 情绪 | 循证情绪调节干预 | 3 |
| 睡眠与生理 | 失眠与药物管理 | 4 |
| 量表与筛查 | PHQ-9 / SAS / SDS / C-SSRS | 3 |
| 干预与求助资源 | 机构地图与热线资源 | 3 |
| 心理健康素养 | WHO标准、CBT、情绪调节 | 4 |

## 文件处理方法

### PDF 文件
1. **必须先读取** `references/pdf_reading.md`
2. 使用 `pdftotext input.pdf output.txt` 提取文本
3. 对提取结果执行 grep 检索

### Excel 文件
1. **必须先读取** `references/excel_reading.md` 和 `references/excel_analysis.md`
2. 使用 pandas 读取前 10-50 行了解结构
3. 按条件过滤和检索

### DOCX 文件
1. **必须先读取** `references/docx_reading.md`
2. 使用 `pandoc input.docx -o output.txt` 转换
3. 对转换结果执行 grep 检索

## 使用方式

此 Skill 作为 SuiAgent 的 RAG 检索工具使用，通过 `rag_skill_tool.py` 调用。

```python
from rag_skill_tool import RAGSkillTool

# 初始化 RAG 工具
rag_tool = RAGSkillTool(knowledge_base_path="rag-skill/knowledge")

# 检索
result = await rag_tool.retrieve("PHQ-9 量表如何评分？")
```

## 权威来源

- WHO Mental Health Gap Action Programme (mhGAP)
- 《中国抑郁障碍防治指南（2025版）》
- 国家卫生健康委员会
- Columbia University C-SSRS
- Pfizer PHQ-9 / GAD-7 官方指南

---

*VIS4SRD 心理健康知识库检索助手*
