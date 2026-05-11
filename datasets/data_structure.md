# 数据集目录索引：datasets

## 用途

本目录存放 VIS4SRD 系统使用的所有数据集原始数据及处理脚本，当前系统已按四个系列接入：

- `reddit/`
- `bigdata/`
- `sigir/`
- `weibo/`

每个系列都按“贴文文本数据 + 微表情序列数据”配对组织，供系统统一解析。

## 文件说明

| 子目录 / 文件 | 内容说明 |
|---|---|
| `archives/` | 用户自定义导入档案（符合导入模板格式的 CSV/TXT） |
| `bigdata/` | Reddit Bigdata 数据集（贴文 + Emoji 情绪特征） |
| `reddit/` | Reddit 500 条数据集（贴文 + Emoji 情绪特征） |
| `sigir/` | SIGIR 2021 自杀风险数据集（贴文 + Emoji 情绪特征） |
| `weibo/` | 微博数据集（贴文文本原始数据） |
| `merged_data.csv` | bigdata + reddit + sigir 三合一合并数据集（merge_datasets.py 生成） |
| `merge_datasets.py` | 数据集合并脚本 |
| `data_structure.md` | 本文件，作为 datasets 目录索引 |

## 各数据集文件说明

### archives/
- `reddit_导入模板.csv/.txt/.xlsx` - Reddit 系列导入模板
- `bigdata_导入模板.csv/.txt/.xlsx` - Bigdata 系列导入模板
- `sigir_导入模板.csv/.txt/.xlsx` - SIGIR 系列导入模板
- `weibo_导入模板.csv/.txt/.xlsx` - Weibo 系列导入模板
- `导入模板_Excel.csv` / `导入模板_TAB.txt` - 历史通用模板，保留兼容

### bigdata/
- `bigdata.csv` - Reddit Bigdata 贴��数据（user_id, created_utc, post_sequence, suicide_risk）
- `bigdata_emoji_batch.csv` - 对应贴文的 Emoji 情绪特征序列

### reddit/
- `reddit_500.csv` - Reddit 500 条贴文数据（User, Post, Label）
- `reddit_500_emoji_batch.csv` - 对应贴文的 Emoji 情绪特征序列

### sigir/
- `sigir.csv` - SIGIR 2021 数据集贴文数据（Post, Label）
- `sigir_emojis.csv` - 对应贴文的 Emoji 情绪特征序列

### weibo/
- `weibo_1000.csv` - 微博贴文数据（`user_id, Post, label`）
- `weibo_1000_emoji_batch.csv` - 对应贴文的 Emoji / 微表情序列数据

## merged_data.csv 合并格式

| 字段 | 说明 |
|---|---|
| `user_id` | 用户标识符 |
| `created_utc` | 贴文发布时间（bigdata 有时间戳，其他为空） |
| `post_sequence` | 贴文内容 |
| `emjio_sequence` | Emoji 情绪特征序列 |
| `suicide_risk` | 自杀风险标签（0=无风险，1/2=有风险） |

## 四个内置系列的导入口径

### reddit
- 主文件字段：`User, Post, Label`
- `Post` 必须是 Python list 字符串
- 列表中的每个元素都会被系统拆成 1 条贴文
- 标签范围：`0..4`

### bigdata
- 主文件字段：`user_id, created_utc, post_sequence, suicide_risk`
- `post_sequence` 必须是列表字符串，列表中的每个元素都会被系统拆成 1 条贴文
- `created_utc` 必须与贴文顺序对齐
- 标签范围：`0..3`
- 若要补充 emoji，可在导入文件中追加 `emjio_sequenc` 或 `emjio_sequence`

### sigir
- 主文件字段：`Post, Label`
- 1 行 = 1 用户 = 1 条贴文
- 数据本身没有显式 `user_id`，系统按行号生成 `row_1 / row_2 / ...`
- 标签范围：`0/1`

### weibo
- 主文件字段：`user_id, Post, label`
- `Post` 为多行文本，系统按换行拆分，每行视为 1 条贴文
- 若提供 `emoji_sequence`，系统按逗号分段并与贴文顺序对齐
- 标签范围：`0/1`

## 关键词
- 数据集导入
- 自杀风险评估
- Reddit / Bigdata / SIGIR / Weibo
- Emoji 情绪特征
- 贴文文本分析
- 数据合并
