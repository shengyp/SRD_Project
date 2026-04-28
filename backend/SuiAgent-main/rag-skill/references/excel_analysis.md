# Excel 数据分析方法指南

> 处理 Excel 数据分析任务前必须先阅读本文档。

---

## 一、分组聚合

### 1.1 按列分组统计

```python
import pandas as pd

df = pd.read_excel("data.xlsx")

# 按单列分组求和
grouped = df.groupby("类别")["数值列"].sum()

# 按多列分组
grouped = df.groupby(["类别", "地区"])["销售额"].mean()

# 多种聚合
result = df.groupby("部门").agg({
    "销售额": ["sum", "mean", "count"],
    "利润": ["sum", "mean"]
})
```

### 1.2 分组后筛选

```python
# 筛选分组后满足条件的组
grouped = df.groupby("类别").filter(lambda x: x["销售额"].sum() > 1000)
```

---

## 二、数据过滤

### 2.1 基础过滤

```python
# 等于
df[df["列"] == "值"]

# 不等于
df[df["列"] != "值"]

# 大于/小于
df[df["数值列"] > 10]

# 范围
df[(df["列"] >= 5) & (df["列"] <= 15)]
```

### 2.2 字符串过滤

```python
# 包含
df[df["文本列"].str.contains("关键词")]

# 开头/结尾
df[df["文本列"].str.startswith("前缀")]
df[df["文本列"].str.endswith("后缀")]

# 正则匹配
df[df["文本列"].str.match(r"正则表达式")]
```

---

## 三、派生指标

### 3.1 新增计算列

```python
# 简单计算
df["新列"] = df["列A"] + df["列B"]

# 百分比
df["占比"] = df["数值"] / df["数值"].sum() * 100

# 条件赋值
df["等级"] = df["分数"].apply(lambda x: "高" if x >= 80 else "低")
```

### 3.2 时间处理

```python
# 转换日期格式
df["日期"] = pd.to_datetime(df["日期"])

# 提取年月日
df["年"] = df["日期"].dt.year
df["月"] = df["日期"].dt.month

# 按月分组
df.groupby(df["日期"].dt.to_period("M")).sum()
```

---

## 四、排序与排名

```python
# 按列排序
df.sort_values("列名", ascending=True)

# 多列排序
df.sort_values(["列1", "列2"], ascending=[True, False])

# 排名
df["排名"] = df["分数"].rank(ascending=False)
```

---

## 五、数据清洗

```python
# 去除重复
df.drop_duplicates()

# 填充缺失值
df.fillna(0)

# 删除缺失值
df.dropna()

# 替换值
df.replace({"旧值": "新值"})
```

---

## 六、禁止事项

- ❌ 未学习本文档就直接进行数据分析
- ❌ 在不了解数据结构时就读取全量数据
- ❌ 不进行数据清洗就开始分析
