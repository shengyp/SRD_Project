# Chat 页面 Agent 返回结构交付文档

## 1. 文档目的

后端 / Agent 返回内容的实际需求。

同时返回：

- 主回答内容
- 参考资料
- 证据片段
- 知识图谱
- 知识清单
- 追问问题

这样前端才能完整渲染当前页面右侧的“知识清单 / 实体关系图谱 / 表格 / 追问入口”。

---

## 2. 结论先行

对于当前 `chat` 页面，后端建议至少返回以下四类内容：

1. `content`：主回答正文
2. `references`：参考资料列表
3. `ragContext.evidence`：证据片段列表
4. `ragContext.mindMap`：知识图谱数据

如果希望右侧“知识清单”完整可控，而不是依赖前端兜底生成，则还应返回：

5. `ragContext.knowledgePanel.tableRows`
6. `ragContext.knowledgePanel.preKnowledge`
7. `ragContext.knowledgePanel.relatedKnowledge`
8. `ragContext.knowledgePanel.deepDiveItems`
9. `ragContext.knowledgePanel.followUpQuestions`

---

## 3. 当前页面实际消费的内容

### 3.1 主回答区

主回答区直接消费：

- `content`

用途：

- 聊天正文展示
- Markdown / 分段文本渲染

要求：

- 必须有
- 支持流式增量返回

---

### 3.2 参考资料

前端会消费：

- `references`
- 兼容字段：`referencesJson`、`retrievalSources`、`retrieval_sources`

用途：

- 主回答下方“参考资料”数量徽标
- 右侧知识清单中的文档来源
- 文档预览入口

建议结构：

```json
[
  {
    "id": "doc_001",
    "title": "C-SSRS 安全计划模板",
    "type": "pdf"
  },
  {
    "id": "doc_002",
    "title": "心理危机干预工作手册",
    "type": "md"
  }
]
```

字段说明：

- `id`：文档唯一标识
- `title`：资料名称
- `type`：文档类型，如 `pdf` / `word` / `md` / `txt`

---

### 3.3 证据片段 evidence

前端会消费：

- `ragContext.evidence`
- 流式事件中也支持 `rag_evidence`

用途：

- 图谱节点联动证据说明
- 右侧“证据依据”展示
- 与知识图谱节点建立关联

建议结构：

```json
[
  {
    "id": "evidence_001",
    "title": "C-SSRS 安全计划模板",
    "sourceType": "pdf",
    "snippet": "原文片段或摘要片段",
    "claim": "该证据支撑的判断结论",
    "docId": "doc_001"
  }
]
```

字段说明：

- `id`：证据唯一标识
- `title`：证据标题
- `sourceType`：来源类型
- `snippet`：证据文本片段
- `claim`：该证据支撑的结论
- `docId`：对应参考资料 `id`

---

### 3.4 知识图谱 mindMap

这是当前页面右侧上方最关键的结构。

当前前端需要的不是普通脑图，而是：

- 实体节点
- 关系连边
- 边上的关系标签

也就是“实体-关系-实体”的三元组图谱展示。

前端消费：

- `ragContext.mindMap`
- 流式事件 `mind_map`

建议结构：

```json
{
  "nodes": [
    {
      "id": "n1",
      "label": "肠道菌群",
      "group": "core",
      "description": "实体说明",
      "relatedEvidenceIds": ["evidence_001"]
    },
    {
      "id": "n2",
      "label": "器官",
      "group": "support",
      "description": "实体说明",
      "relatedEvidenceIds": []
    }
  ],
  "edges": [
    {
      "source": "n1",
      "target": "n2",
      "label": "属于"
    }
  ],
  "summary": "该知识图谱主要涉及哪些实体和关系",
  "focusNodeId": "n1"
}
```

#### nodes 字段说明

- `id`：节点唯一标识
- `label`：节点显示名称
- `group`：节点分组
- `description`：节点说明
- `relatedEvidenceIds`：该节点关联的证据 id 列表

#### edges 字段说明

- `source`：起始节点 id
- `target`：目标节点 id
- `label`：关系名，如 `属于`、`导致`、`支撑`、`映射到`

#### group 建议值

当前前端兼容这些分组：

- `question`
- `core`
- `support`
- `action`

说明：

- 这几个分组主要影响颜色，不影响是否能渲染

---

## 4. 右侧知识清单建议返回结构

如果不返回这些字段，前端会用当前问题和回答内容做兜底生成。  
但如果希望页面内容更稳定、可控、可解释，建议后端直接返回。

---

### 4.1 tableRows

用途：

- 右侧图谱下方的表格

建议结构：

```json
[
  {
    "topic": "主题",
    "knowledge": "知识",
    "description": "描述"
  }
]
```

字段说明：

- `topic`：主题列
- `knowledge`：知识列
- `description`：解释说明列

---

### 4.2 preKnowledge

用途：

- 前置知识块

建议结构：

```json
[
  {
    "id": "pre_001",
    "title": "即时危险表达",
    "description": "围绕该点做前置判断说明",
    "prompt": "请解释该点在当前场景中的判断作用",
    "relatedEvidenceIds": ["evidence_001"]
  }
]
```

---

### 4.3 relatedKnowledge

用途：

- 关联知识块

结构同 `preKnowledge`。

---

### 4.4 deepDiveItems

用途：

- 深入理解块

结构同 `preKnowledge`。

---

### 4.5 followUpQuestions

用途：

- 主回答下方的快捷追问按钮

建议结构：

```json
[
  "这段对话里最需要立即核实的危险细节是什么？",
  "如果今晚只能安排一次现实干预，最优先应该做哪三步？"
]
```

---

## 5. 推荐的统一返回结构

建议后端最终统一为以下结构：

```json
{
  "id": "msg_001",
  "role": "ai",
  "content": "主回答正文",
  "processingTimeMs": 4280,
  "references": [
    {
      "id": "doc_001",
      "title": "C-SSRS 安全计划模板",
      "type": "pdf"
    }
  ],
  "ragContext": {
    "evidence": [
      {
        "id": "evidence_001",
        "title": "C-SSRS 安全计划模板",
        "sourceType": "pdf",
        "snippet": "这里是证据片段",
        "claim": "支持当前结论",
        "docId": "doc_001"
      }
    ],
    "mindMap": {
      "nodes": [
        {
          "id": "n1",
          "label": "肠道菌群",
          "group": "core",
          "description": "实体说明",
          "relatedEvidenceIds": ["evidence_001"]
        },
        {
          "id": "n2",
          "label": "器官",
          "group": "support",
          "description": "实体说明",
          "relatedEvidenceIds": []
        }
      ],
      "edges": [
        {
          "source": "n1",
          "target": "n2",
          "label": "属于"
        }
      ],
      "summary": "该图谱展示主要实体及其关系",
      "focusNodeId": "n1"
    },
    "knowledgePanel": {
      "tableRows": [
        {
          "topic": "主题",
          "knowledge": "知识",
          "description": "描述"
        }
      ],
      "preKnowledge": [
        {
          "id": "pre_001",
          "title": "即时危险表达",
          "description": "说明",
          "prompt": "点击后继续追问给 Agent 的问题",
          "relatedEvidenceIds": ["evidence_001"]
        }
      ],
      "relatedKnowledge": [],
      "deepDiveItems": [],
      "followUpQuestions": [
        "下一步最该核实什么？"
      ]
    }
  }
}
```

---

## 6. 流式返回事件约定

当前前端已支持以下 SSE / 流式事件类型：

```json
{ "type": "chunk", "content": "回答正文增量文本" }
{ "type": "done" }
{ "type": "error", "message": "错误信息" }

{ "type": "rag_sources", "sources": [...] }
{ "type": "mind_map", "mindMap": {...} }
{ "type": "rag_evidence", "evidence": [...] }
{ "type": "pre_knowledge", "terms": [...] }
{ "type": "context_sources", "sources": [...] }
```

### 6.1 最重要的事件

优先保证：

1. `chunk`
2. `done`
3. `rag_sources`
4. `mind_map`
5. `rag_evidence`

---

![image-20260428205716475](E:\Typora图片保存\image-20260428205716475.png)

![image-20260428205730034](E:\Typora图片保存\image-20260428205730034.png)

![image-20260428205741111](E:\Typora图片保存\image-20260428205741111.png)

![image-20260428205749688](E:\Typora图片保存\image-20260428205749688.png)

![image-20260428205756306](E:\Typora图片保存\image-20260428205756306.png)

![image-20260428205803639](E:\Typora图片保存\image-20260428205803639.png)

![image-20260428205811586](E:\Typora图片保存\image-20260428205811586.png)
