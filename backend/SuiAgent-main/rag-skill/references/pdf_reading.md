# PDF 文件处理方法指南

> 处理 PDF 文件前必须先阅读本文档，学习正确的处理方法。

---

## 一、快速决策表

| 场景 | 推荐工具 | 备注 |
|-----|---------|------|
| 快速提取全文文本 | pdftotext | 最快，适合纯文本 PDF |
| 提取表格数据 | pdfplumber | Python 库，表格识别好 |
| 提取图片/复杂布局 | pypdf2 / PyMuPDF | 需要更多处理 |
| 提取特定页面 | pdftotext -f -l | 指定页码范围 |

---

## 二、工具使用说明

### 2.1 pdftotext（推荐）

```bash
# 提取全文到文件（不要输出到 stdout！）
pdftotext input.pdf output.txt

# 提取特定页面
pdftotext -f 1 -l 5 input.pdf output.txt

# 保留布局
pdftotext -layout input.pdf output.txt
```

### 2.2 pdfplumber（Python）

```python
import pdfplumber

with pdfplumber.open("input.pdf") as pdf:
    # 提取所有文本
    text = ""
    for page in pdf.pages:
        text += page.extract_text() or ""
    
    # 提取表格
    tables = page.extract_tables()
```

### 2.3 PyMuPDF (fitz)

```python
import fitz  # PyMuPDF

doc = fitz.open("input.pdf")
for page_num, page in enumerate(doc):
    text = page.get_text()
```

---

## 三、性能优化

1. **输出到文件**：不要用 `pdftotext input.pdf -` 输出到 stdout，会占用大量 token
2. **分页处理**：大文件分页提取，每页单独处理
3. **选择性提取**：只提取需要的页面，用 `-f -l` 参数

---

## 四、检索流程

1. **学习本文档**：理解推荐工具和使用方法
2. **提取文本到文件**：使用 pdftotext 输出到 .txt 文件
3. **grep 检索**：对提取的文本文件进行 grep 搜索
4. **局部读取**：只读取匹配行的上下文

---

## 五、禁止事项

- ❌ 未学习本文档就直接处理 PDF
- ❌ 使用 `pdftotext input.pdf -` 输出到 stdout
- ❌ 一次性读取整个大 PDF
- ❌ 直接加载 PDF 进行全文检索
