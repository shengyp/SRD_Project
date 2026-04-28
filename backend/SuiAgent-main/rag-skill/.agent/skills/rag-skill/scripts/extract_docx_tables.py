#!/usr/bin/env python3
"""
DOCX 表格提取脚本

从 DOCX 文件中提取所有表格，输出为 CSV 或 DataFrame 格式。

用法:
    python extract_docx_tables.py input.docx [output_dir]

示例:
    # 提取所有表格到 CSV
    python extract_docx_tables.py document.docx tables/

    # 提取到标准输出
    python extract_docx_tables.py document.docx

    # 输出为 JSON
    python extract_docx_tables.py document.docx --format json
"""

import sys
import os
import csv
import json
from pathlib import Path
from typing import List, Dict, Any


def extract_tables(docx_path: str) -> List[List[List[str]]]:
    """从 DOCX 文件提取所有表格"""
    try:
        from docx import Document

        doc = Document(docx_path)
        tables_data = []

        for table in doc.tables:
            table_data = []
            for row in table.rows:
                row_data = [cell.text.strip() for cell in row.cells]
                table_data.append(row_data)
            tables_data.append(table_data)

        return tables_data

    except ImportError:
        print("错误: 请安装 python-docx (pip install python-docx)")
        return []
    except Exception as e:
        print(f"读取错误: {e}")
        return []


def tables_to_csv(tables: List[List[List[str]]], output_dir: str = None) -> List[str]:
    """将表格保存为 CSV 文件"""
    csv_files = []

    for i, table in enumerate(tables):
        if not table:
            continue

        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            csv_path = os.path.join(output_dir, f"table_{i+1}.csv")
        else:
            # 输出到标准输出
            csv_path = None

        if csv_path:
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                for row in table:
                    writer.writerow(row)
            csv_files.append(csv_path)
            print(f"已保存: {csv_path}")
        else:
            # 打印到标准输出
            for row in table:
                print("\t".join(row))
            print()  # 空行分隔表格

    return csv_files


def tables_to_json(tables: List[List[List[str]]]) -> str:
    """将表格转换为 JSON 格式"""
    result = []
    for i, table in enumerate(tables):
        result.append({
            "table_index": i,
            "rows": table,
            "row_count": len(table),
            "col_count": len(table[0]) if table else 0
        })
    return json.dumps(result, ensure_ascii=False, indent=2)


def tables_to_markdown(tables: List[List[List[str]]]) -> str:
    """将表格转换为 Markdown 格式"""
    md_lines = []

    for i, table in enumerate(tables):
        if not table:
            continue

        md_lines.append(f"### 表格 {i + 1}\n")

        # 表头
        headers = table[0]
        md_lines.append("| " + " | ".join(headers) + " |")
        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

        # 数据行
        for row in table[1:]:
            md_lines.append("| " + " | ".join(row) + " |")

        md_lines.append("")  # 空行

    return "\n".join(md_lines)


def print_table(table: List[List[str]], title: str = None):
    """打印表格到控制台"""
    if title:
        print(f"\n{'=' * 40}")
        print(f"  {title}")
        print(f"{'=' * 40}\n")

    if not table:
        print("(空表格)")
        return

    # 计算每列最大宽度
    col_widths = [max(len(str(cell)) for cell in col) for col in zip(*table)]

    for row_idx, row in enumerate(table):
        row_str = "|"
        for cell, width in zip(row, col_widths):
            row_str += f" {str(cell).ljust(width)} |"
        print(row_str)

        # 表头后加分隔线
        if row_idx == 0:
            sep = "+"
            for width in col_widths:
                sep += "-" + "-" * width + "+"
            print(sep)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    docx_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None

    if not os.path.exists(docx_path):
        print(f"错误: 文件不存在 - {docx_path}")
        sys.exit(1)

    # 解析格式参数
    format = "csv"
    if "--format" in sys.argv:
        idx = sys.argv.index("--format")
        if idx + 1 < len(sys.argv):
            format = sys.argv[idx + 1]

    # 提取表格
    tables = extract_tables(docx_path)

    if not tables:
        print("未找到表格")
        sys.exit(1)

    print(f"找到 {len(tables)} 个表格\n")

    # 根据格式输出
    if format == "json":
        print(tables_to_json(tables))
    elif format == "markdown":
        print(tables_to_markdown(tables))
    elif format == "console":
        for i, table in enumerate(tables):
            print_table(table, f"表格 {i + 1}")
    else:  # csv
        csv_files = tables_to_csv(tables, output_dir)
        if not csv_files:
            # 输出到标准输出
            tables_to_csv(tables, None)

    sys.exit(0)


if __name__ == "__main__":
    main()