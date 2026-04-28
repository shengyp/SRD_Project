# VIS4SRD 心理量表数据结构说明

## 量表选型依据

针对自杀风险检测系统（VIS4SRD），内置6个经过国际验证的心理量表，形成完整的自杀风险评估矩阵：

| 量表代码 | 量表名称 | 评估维度 | 题数 | 用时 |
|---------|---------|---------|------|------|
| PHQ-9 | 患者健康问卷-9 | 抑郁（含自杀意念条目） | 9题 | 3-5分钟 |
| C-SSRS | 哥伦比亚自杀严重程度评定量表（筛查版） | 专项自杀风险（国际金标准） | 6题 | 3-5分钟 |
| GAD-7 | 广泛性焦虑障碍量表 | 焦虑 | 7题 | 2-3分钟 |
| DASS-21 | 抑郁焦虑压力量表 | 抑郁/焦虑/压力（三维） | 21题 | 5-8分钟 |
| SDS | Zung抑郁自评量表 | 抑郁（国内经典） | 20题 | 5-7分钟 |
| BHS | 贝克绝望量表 | 绝望感（自杀预测力强） | 20题 | 5-7分钟 |

## 文件结构

```
scales/
├── data_structure.md       # 本说明文件
├── PHQ-9.json             # 患者健康问卷-9
├── C-SSRS.json            # 哥伦比亚自杀严重程度评定量表
├── GAD-7.json             # 广泛性焦虑障碍量表
├── DASS-21.json           # 抑郁焦虑压力量表
├── SDS.json               # Zung抑郁自评量表
└── BHS.json               # 贝克绝望量表
```

## JSON 数据格式规范

每个量表文件遵循以下结构：

```json
{
  "code": "PHQ-9",
  "name": "患者健康问卷-9",
  "full_name": "Patient Health Questionnaire-9",
  "version": "Chinese Simplified v2.0",
  "description": "...",
  "estimated_minutes": 4,
  "total_questions": 9,
  "scoring": {
    "type": "sum",          // sum=直接求和, weighted=加权, dimensional=多维
    "max_score": 27,
    "dimensions": []        // 多维量表时填写
  },
  "thresholds": [
    { "min": 0, "max": 4, "level": "normal", "label": "无抑郁", "risk_level": "low" },
    ...
  ],
  "questions": [
    {
      "id": 1,
      "text": "...",
      "dimension": null,     // 多维量表时标注所属维度
      "reverse": false,      // 是否反向计分
      "options": [
        { "value": 0, "label": "完全不会" },
        ...
      ]
    }
  ],
  "interpretation": "...",
  "references": "..."
}
```

## 量表使用说明

- PHQ-9 + GAD-7：标准化组合，用于初步筛查抑郁和焦虑
- C-SSRS：发现高风险信号后的专项自杀风险深度评估
- DASS-21：需要了解压力维度时的补充评估
- SDS：面向中国本土患者，与PHQ-9互补验证
- BHS：评估认知层面的绝望感，是自杀行为的独立预测因子
