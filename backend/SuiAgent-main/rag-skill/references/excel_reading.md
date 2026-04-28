# Excel 文件读取方法指南

> 处理 Excel 文件前必须先阅读本文档，学习正确的处理方法。

---

## 一、快速决策表

| 场景 | 推荐方法 | 备注 |
|-----|---------|------|
| 读取前 N 行了解结构 | pandas nrows | 最快，推荐使用 |
| 读取特定列 | pandas usecols | 按列名或索引 |
| 条件筛选 | pandas query/df[] | 高效过滤 |
| 统计分析 | pandas agg/groupby | 分组聚合 |

---

## 二、pandas 基础用法

### 2.1 读取 Excel

```python
import pandas as pd

# 读取前 10 行（推荐！快速了解结构）
df = pd.read_excel("file.xlsx", nrows=10)

# 读取所有数据
df = pd.read_excel("file.xlsx")

# 读取指定列
df = pd.read_excel("file.xlsx", usecols=["列名1", "列名2"])

# 读取多个 sheet
xlsx = pd.ExcelFile("file.xlsx")
df1 = pd.read_excel(xlsx, sheet_name="Sheet1")
df2 = pd.read_excel(xlsx, sheet_name="Sheet2")
```

### 2.2 数据筛选

```python
# 按条件筛选
filtered = df[df["列名"] == "值"]

# 多条件筛选
filtered = df[(df["列A"] > 10) & (df["列B"] == "条件")]

# 模糊匹配
filtered = df[df["列名"].str.contains("关键词")]
```

### 2.3 数据概览

```python
# 查看前几行
print(df.head())

# 查看列名
print(df.columns.tolist())

# 查看数据类型
print(df.dtypes)

# 查看基本统计
print(df.describe())
```

---

## 三、性能优化

1. **使用 nrows**：读取前 10-50 行快速了解结构
2. **指定列名**：用 usecols 只读取需要的列
3. **条件筛选**：在读取后立即筛选，减少内存占用

---

## 四、禁止事项

- ❌ 未学习本文档就直接处理 Excel
- ❌ 使用 `pd.read_excel()` 一次性读取超大文件
- ❌ 不指定 nrows 就读取大型数据集
- ❌ 先读取全部数据再筛选（应该边读边筛）

---

## 五、检索流程

1. **学习本文档**：理解 pandas 的正确用法
2. **读取前 N 行**：用 nrows=10 了解数据结构
3. **识别关键列**：找到时间、名称、分类等关键列
4. **条件筛选**：按需求筛选数据
5. **输出结果**：只返回用户需要的数据
