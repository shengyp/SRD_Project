# VIS4SRD 知识库结构规范

## 1. 目标
本规范用于统一新 agent 的 `rag-skill/knowledge` 目录设计，使其同时满足：

- 新 agent 的两层检索逻辑：`主题目录 -> 文件`
- 系统前端和管理端的三级展示逻辑：`主题 -> 子主题 -> 关键词`

核心原则是：**目录做检索，元数据做展示。**

## 2. 物理结构
知识库物理层保持两级，不再增加子主题目录或关键词目录：

```text
knowledge/
  data_structure.md
  knowledge_schema.md
  knowledge_catalog.json
  Theme A/
    data_structure.md
    doc_1.pdf
    doc_2.pdf
  Theme B/
    data_structure.md
    doc_3.pdf
```

说明：
- 根目录 `data_structure.md`：给 planner 和目录定位使用。
- 主题目录 `data_structure.md`：给文件定位使用。
- `knowledge_catalog.json`：给前端展示、后台维护、后续扩展使用。

## 3. 语义结构
语义层保留三级：

1. 主题 `theme`
2. 子主题 `subtheme`
3. 关键词 `keywords`

其中：
- `theme` 对应物理目录
- `subtheme` 和 `keywords` 只存在于索引与元数据

## 4. 元数据字段建议
每个主题包含：
- `theme_dir`：物理目录名
- `theme_name_zh`：中文主题名
- `theme_name_en`：英文主题名
- `theme_aliases`：主题别名
- `description`：主题用途
- `subthemes`：子主题数组

每个子主题包含：
- `name`
- `description`
- `keywords`
- `documents`

每个文档包含：
- `filename`
- `title`
- `summary`
- `keywords`
- `aliases`
- `source`
- `audience`

## 5. data_structure.md 写法要求

### 根索引要求
根索引必须写清：
- 主题用途
- 子主题列表
- 核心关键词
- 适用问题

这样新 agent 在根目录选择主题时，不会因为只有目录名而丢失语义。

### 主题索引要求
主题目录内索引必须按“子主题”组织文件，至少包含：
- 子主题名称
- 子主题关键词
- 文件名
- 文件用途

这样新 agent 在主题目录内选择文件时，仍能借助原本的三级知识设计。

## 6. 迁移原则
- 不把关键词单独做成文件夹。
- 不要求文档按子主题拆目录。
- 文档可属于多个关键词，但应有一个主子主题。
- 优先保留现有文件名，减少对存量文档的扰动。

## 7. 前端展示建议
前端建议直接读取 `knowledge_catalog.json`，展示：

`主题 -> 子主题 -> 关键词标签 -> 文档卡片`

不要再从物理目录结构反推子主题和关键词，否则后续维护成本会持续升高。
