#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAG Knowledge Base System Dependency Checker
Check if all required Python packages and system tools are installed for SuiAgent RAG
"""

import subprocess
import sys
import os
from pathlib import Path
from typing import Tuple

# Fix Windows console encoding
if sys.platform == "win32":
    os.system("chcp 65001 > nul 2>&1")

# Use ASCII symbols for compatibility
OK = "[OK]"
MISSING = "[MISSING]"
ERROR = "[ERROR]"


def check_python_package(package_name: str, import_name: str = None) -> Tuple[bool, str]:
    """Check if Python package is installed"""
    if import_name is None:
        import_name = package_name
    
    try:
        __import__(import_name)
        return True, f"{OK} {package_name} is installed"
    except ImportError:
        return False, f"{MISSING} {package_name} not installed, run: pip install {package_name}"


def check_system_tool(tool_name: str, install_hint: str) -> Tuple[bool, str]:
    """Check if system tool is installed"""
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["where", tool_name],
                capture_output=True,
                text=True,
                shell=True
            )
        else:
            result = subprocess.run(
                ["which", tool_name],
                capture_output=True,
                text=True
            )
        
        if result.returncode == 0:
            path = result.stdout.strip().split('\n')[0]
            return True, f"{OK} {tool_name} is installed: {path}"
        else:
            return False, f"{MISSING} {tool_name} not installed, {install_hint}"
    except Exception as e:
        return False, f"{ERROR} {tool_name} check failed: {e}"


def check_knowledge_base() -> Tuple[bool, str]:
    """Check knowledge base directory structure"""
    script_dir = Path(__file__).parent
    rag_skill_dir = script_dir.parent / "rag-skill"
    knowledge_dir = rag_skill_dir / "knowledge"
    references_dir = rag_skill_dir / "references"
    
    results = []
    has_error = False
    
    if not rag_skill_dir.exists():
        results.append(f"{MISSING} rag-skill directory not found: {rag_skill_dir}")
        return False, "\n".join(results)
    
    results.append(f"{OK} rag-skill directory exists")
    
    if not knowledge_dir.exists():
        results.append(f"{MISSING} knowledge directory not found: {knowledge_dir}")
        has_error = True
    else:
        root_index = knowledge_dir / "data_structure.md"
        if root_index.exists():
            results.append(f"{OK} knowledge directory with root index")
        else:
            results.append(f"{MISSING} root index data_structure.md not found")
            has_error = True
    
    if not references_dir.exists():
        results.append(f"{MISSING} references directory not found: {references_dir}")
        has_error = True
    else:
        results.append(f"{OK} references directory exists")
        required_refs = [
            "pdf_reading.md",
            "excel_reading.md", 
            "excel_analysis.md",
            "docx_reading.md"
        ]
        for ref_file in required_refs:
            ref_path = references_dir / ref_file
            if ref_path.exists():
                results.append(f"  {OK} {ref_file}")
            else:
                results.append(f"  {MISSING} {ref_file}")
                has_error = True
    
    return not has_error, "\n".join(results)


def main():
    print("=" * 60)
    print("RAG Knowledge Base Dependency Checker")
    print("=" * 60)
    print()
    
    all_passed = True
    
    # 1. Python dependencies check
    print("[1/3] Checking Python dependencies...")
    print("-" * 40)
    
    python_deps = [
        ("jieba", "jieba"),
        ("pandas", "pandas"),
        ("python-docx", "docx"),
        ("pdfplumber", "pdfplumber"),
        ("langchain-core", "langchain_core"),
        ("openai", "openai"),
    ]
    
    for pkg, import_name in python_deps:
        passed, msg = check_python_package(pkg, import_name)
        print(msg)
        if not passed:
            all_passed = False
    
    print()
    
    # 2. System tools check
    print("[2/3] Checking system tools...")
    print("-" * 40)
    
    if sys.platform == "win32":
        system_tools = [
            ("pandoc", "Windows: Download from https://pandoc.org/installing.html"),
            ("pdftotext", "Windows: Install via conda: conda install -c conda-forge poppler"),
        ]
    else:
        system_tools = [
            ("pandoc", "Linux: sudo apt install pandoc | Mac: brew install pandoc"),
            ("pdftotext", "Linux: sudo apt install poppler-utils | Mac: brew install poppler"),
        ]
    
    for tool, hint in system_tools:
        passed, msg = check_system_tool(tool, hint)
        print(msg)
        if not passed:
            all_passed = False
    
    print()
    
    # 3. Knowledge base check
    print("[3/3] Checking knowledge base structure...")
    print("-" * 40)
    
    passed, msg = check_knowledge_base()
    print(msg)
    if not passed:
        all_passed = False
    
    print()
    print("=" * 60)
    
    if all_passed:
        print("[SUCCESS] All checks passed! RAG system is ready.")
        return 0
    else:
        print("[WARNING] Some checks failed. Please install missing dependencies.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
