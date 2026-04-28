# DOCX 文件读取与转换

> ⚠️ **使用本文档前请注意**：本文档应在实际处理 DOCX 文件之前完整阅读，以选择最合适的工具和方法。

用于从 DOCX 文件中提取文本、表格和元数据的方法。

## 快速决策表

| 场景 | 推荐工具 | 原因 | 命令/代码示例 |
|------|----------|------|--------------|
| 文本提取（最常见） | pandoc | 最快最简单 | `pandoc input.docx -o output.txt` |
| 保留格式转为 Markdown | pandoc | 支持格式转换 | `pandoc input.docx -o output.md` |
| 提取表格 | python-docx | 表格识别能力强 | `extract_tables()` |
| 编辑现有文档 | python-docx | API 友好 | 打开-修改-保存 |
| 创建新文档 | docx-js | 格式丰富 | Node.js API |

## 文本提取优先级

**推荐优先级（从高到低）**：
1. **pandoc 命令行工具**（最快，适合大多数场景）
2. python-docx（适合需要提取表格或精细控制）
3. mammoth（适合纯文本提取，体积小）

## 快速开始：使用 pandoc（推荐）

> ⚠️ **重要**：必须将输出保存到文件，不要直接输出到终端（stdout），否则会占用大量 token！

```bash
# ✅ 正确：转换为纯文本（最快最简单）
pandoc input.docx -o output.txt

# ✅ 正确：转换为 Markdown（保留基本格式）
pandoc input.docx -o output.md

# ✅ 正确：转换为 HTML
pandoc input.docx -o output.html

# ✅ 正确：保留跟踪修订
pandoc --track-changes=all input.docx -o output.md

# ❌ 错误：不要使用 stdout（会占用大量 token）
# pandoc input.docx
```

**使用流程**：
1. 使用 pandoc 将 docx 转换为文本或 markdown
2. 对生成的文本文件使用 grep 或 Read 工具进行检索
3. 只读取匹配部分的上下文，而非全文

## Python 库

### python-docx - 表格和段落提取

```python
from docx import Document

doc = Document("document.docx")

# 提取所有段落文本
for para in doc.paragraphs:
    print(para.text)

# 提取所有表格
for table in doc.tables:
    for row in table.rows:
        row_text = [cell.text for cell in row.cells]
        print("\t".join(row_text))

# 提取指定段落（按索引）
if len(doc.paragraphs) > 5:
    print(doc.paragraphs[5].text)
```

### mammoth - 轻量级纯文本提取

```python
import mammoth

# 提取纯文本
with open("document.docx", "rb") as docx_file:
    result = mammoth.extract_raw_text(docx_file)
    text = result.value
    print(text)

# 转换为 Markdown
with open("document.docx", "rb") as docx_file:
    result = mammoth.convert_to_markdown(docx_file)
    markdown = result.value
    print(markdown)
```

### 提取带格式的文本

```python
from docx import Document
from docx.shared import RGBColor

doc = Document("document.docx")

for para in doc.paragraphs:
    for run in para.runs:
        text = run.text
        bold = run.bold
        italic = run.italic
        color = run.font.color.rgb if run.font.color.type else None
        print(f"{'[B]' if bold else ''}{'[I]' if italic else ''}{text}")
```

## 命令行工具

### pandoc（推荐）

```bash
# ✅ 转换为纯文本
pandoc input.docx -o output.txt

# ✅ 转换为 Markdown（保留标题结构）
pandoc input.docx --wrap=none -o output.md

# ✅ 转换为带 YAML frontmatter 的 Markdown
pandoc input.docx --metadata title="文档标题" -o output.md

# ✅ 保留跟踪修订
pandoc --track-changes=all input.docx -o output.md

# ✅ 批量转换
for f in *.docx; do pandoc "$f" -o "${f%.docx}.txt"; done
```

### 表格提取为 CSV

```bash
# 使用 python-docx 脚本提取表格
python -c "
from docx import Document
import csv

doc = Document('document.docx')
for i, table in enumerate(doc.tables):
    with open(f'table_{i}.csv', 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        for row in table.rows:
            writer.writerow([cell.text for cell in row.cells])
"
```

## 表格提取

```python
from docx import Document

doc = Document("document.docx")

# 提取第一个表格
if doc.tables:
    table = doc.tables[0]

    # 按行迭代
    for row in table.rows:
        cells = [cell.text.strip() for cell in row.cells]
        print(" | ".join(cells))

    # 转换为 DataFrame（需要 pandas）
    import pandas as pd

    data = []
    headers = None
    for i, row in enumerate(table.rows):
        cells = [cell.text.strip() for cell in row.cells]
        if i == 0:
            headers = cells
        else:
            data.append(cells)

    df = pd.DataFrame(data, columns=headers)
    print(df)
```

## 处理 .doc 旧格式

> ⚠️ **重要**：旧版 .doc 文件必须先转换为 .docx！

```bash
# 使用 LibreOffice 转换
# soffice --headless --convert-to docx document.doc --outdir output/

# 或者使用 Python
from subprocess import run
run(["soffice", "--headless", "--convert-to", "docx",
     "document.doc", "--outdir", "output/"])
```

## 批量处理

```python
import os
import glob
from docx import Document

def batch_extract_text(input_dir, output_dir):
    """批量提取文本"""
    docx_files = glob.glob(os.path.join(input_dir, "*.docx"))

    for docx_file in docx_files:
        try:
            doc = Document(docx_file)

            # 提取所有文本
            text = "\n\n".join([para.text for para in doc.paragraphs])

            # 保存到同名 .txt 文件
            output_file = os.path.join(
                output_dir,
                os.path.basename(docx_file).replace('.docx', '.txt')
            )
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(text)

            print(f"Extracted: {docx_file}")

        except Exception as e:
            print(f"Failed: {docx_file} - {e}")

# 使用
batch_extract_text("input/", "output/")
```

## 性能优化

1. **文件输出优先**：始终将转换输出保存到文件，然后用 grep/Read 检索
2. **pandoc 优先**：文本提取时优先使用 pandoc，比 python-docx 快
3. **表格单独处理**：如果只需要表格，用 python-docx 的表格提取功能
4. **批量处理**：多个文件时使用循环批量处理

## 禁止事项

- ❌ 在未读取本文档的情况下直接尝试处理 DOCX
- ❌ 跳过文档转换步骤，直接对原始 DOCX 进行全文检索
- ❌ 使用 stdout 输出大量文本（占用 token）

## 快速参考

| 任务 | 最佳工具 | 命令/代码 |
|------|----------|-----------|
| 提取文本 | pandoc | `pandoc input.docx -o output.txt` |
| 转换为 Markdown | pandoc | `pandoc input.docx -o output.md` |
| 提取表格 | python-docx | `doc.tables[0]` |
| 批量处理 | python-docx | 循环处理 |
| 旧 .doc 转换 | LibreOffice | `soffice --convert-to docx` |

## 可用包

- **python-docx** - 读取、编辑 DOCX（MIT 许可）
- **mammoth** - 轻量级纯文本提取（BSD 许可）
- **pandoc** - 命令行格式转换（GPL 许可）
- **LibreOffice** - .doc 转 .docx（LGPL 许可）
