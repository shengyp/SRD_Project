#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VIS4SRD 数据集导入 API 调用脚本

实现导入数据集的全流程:
1. POST /api/upload/archive - 上传档案数据文件
2. POST /api/upload/archive/confirm - 确认导入档案数据

使用方式:
    python scripts/import_dataset_api.py <csv_file_path> [--base-url http://localhost:8000]

示例:
    python scripts/import_dataset_api.py ../datasets/archives/测试导入_模拟数据.csv
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="VIS4SRD 数据集导入 API 调用脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/import_dataset_api.py ../datasets/archives/测试导入_模拟数据.csv
  python scripts/import_dataset_api.py ../datasets/archives/测试导入_模拟数据.csv --base-url http://localhost:8000
        """
    )
    parser.add_argument(
        "csv_file",
        help="CSV 文件路径（支持相对路径或绝对路径）"
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="后端服务地址 (默认: http://localhost:8000)"
    )
    parser.add_argument(
        "--data-source",
        default="custom",
        help="数据来源标识 (默认: custom)"
    )
    return parser.parse_args()


def upload_archive(base_url: str, csv_file_path: str, data_source: str) -> dict:
    """
    调用 POST /api/upload/archive 上传档案数据文件
    
    Args:
        base_url: 后端服务地址
        csv_file_path: CSV 文件路径
        data_source: 数据来源标识
    
    Returns:
        上传响应数据，包含 datasetKey, filePath, preview 等
    """
    upload_url = f"{base_url}/api/upload/archive"
    
    # 读取文件内容
    with open(csv_file_path, 'rb') as f:
        file_content = f.read()
    
    filename = os.path.basename(csv_file_path)
    
    # 构建 multipart/form-data 请求
    boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    
    # 构建表单数据
    form_data = (
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="data_source"\r\n\r\n'
        f'{data_source}\r\n'
        f'--{boundary}--\r\n'
    ).encode('utf-8')
    
    # 构建文件数据
    file_data = (
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f'Content-Type: text/csv\r\n\r\n'
    ).encode('utf-8') + file_content + f'\r\n--{boundary}--\r\n'.encode('utf-8')
    
    # 合并数据
    body = file_data + form_data
    
    # 发送请求
    req = urllib.request.Request(
        upload_url,
        data=body,
        method='POST'
    )
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    
    print(f"\n{'='*60}")
    print("步骤 1: 上传档案数据文件")
    print(f"{'='*60}")
    print(f"URL: {upload_url}")
    print(f"文件: {csv_file_path}")
    print(f"文件名: {filename}")
    print(f"数据来源: {data_source}")
    print(f"文件大小: {len(file_content)} bytes")
    
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.loads(response.read().decode('utf-8'))
            
            if result.get('success'):
                data = result['data']
                print(f"\n✅ 上传成功!")
                print(f"   数据集标识: {data.get('datasetKey')}")
                print(f"   保存路径: {data.get('filePath')}")
                print(f"   总用户数: {data.get('totalUsers')}")
                print(f"   总帖子数: {data.get('totalPosts')}")
                print(f"   风险分布: {data.get('riskDistribution')}")
                print(f"\n   预览数据 (前5条):")
                for i, preview in enumerate(data.get('preview', [])[:5]):
                    print(f"   [{i+1}] {preview.get('userId')}: "
                          f"风险={preview.get('riskLabel')}({preview.get('riskValue')}), "
                          f"帖子数={preview.get('postCount')}")
                return data
            else:
                print(f"\n❌ 上传失败: {result.get('detail', '未知错误')}")
                sys.exit(1)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        try:
            error_data = json.loads(error_body)
            print(f"\n❌ HTTP 错误 {e.code}: {error_data.get('detail', error_body)}")
        except:
            print(f"\n❌ HTTP 错误 {e.code}: {error_body}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"\n❌ 连接错误: {e.reason}")
        print("请确保后端服务正在运行 (例如: uvicorn main:app --reload)")
        sys.exit(1)


def confirm_import(base_url: str, dataset_key: str, file_path: str, data_source: str) -> dict:
    """
    调用 POST /api/upload/archive/confirm 确认导入档案数据
    
    Args:
        base_url: 后端服务地址
        dataset_key: 数据集标识
        file_path: 文件路径
        data_source: 数据来源标识
    
    Returns:
        确认导入响应数据
    """
    confirm_url = f"{base_url}/api/upload/archive/confirm"
    
    # 构建请求体
    payload = {
        "datasetKey": dataset_key,
        "filePath": file_path,
        "dataSource": data_source,
        "isManualAnnotation": False
    }
    
    # 发送请求
    req = urllib.request.Request(
        confirm_url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        method='POST'
    )
    
    print(f"\n{'='*60}")
    print("步骤 2: 确认导入档案数据到数据库")
    print(f"{'='*60}")
    print(f"URL: {confirm_url}")
    print(f"请求体: {json.dumps(payload, ensure_ascii=False, indent=2)}")
    
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode('utf-8'))
            
            if result.get('success'):
                data = result['data']
                print(f"\n✅ 导入成功!")
                print(f"   批次编号: {data.get('batchCode')}")
                print(f"   总用户数: {data.get('totalUsers')}")
                print(f"   总帖子数: {data.get('totalPosts')}")
                print(f"   风险分布: {data.get('riskDistribution')}")
                return data
            else:
                print(f"\n❌ 导入失败: {result.get('detail', '未知错误')}")
                sys.exit(1)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        try:
            error_data = json.loads(error_body)
            print(f"\n❌ HTTP 错误 {e.code}: {error_data.get('detail', error_body)}")
        except:
            print(f"\n❌ HTTP 错误 {e.code}: {error_body}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"\n❌ 连接错误: {e.reason}")
        sys.exit(1)


def main():
    args = parse_args()
    
    # 解析 CSV 文件路径
    csv_file = args.csv_file
    if not os.path.isabs(csv_file):
        # 相对于当前工作目录解析
        csv_file = os.path.abspath(csv_file)
    
    if not os.path.exists(csv_file):
        print(f"❌ 文件不存在: {csv_file}")
        sys.exit(1)
    
    if not csv_file.lower().endswith(('.csv', '.txt')):
        print(f"❌ 仅支持 CSV 或 TXT 文件: {csv_file}")
        sys.exit(1)
    
    print(f"\n{'#'*60}")
    print("# VIS4SRD 数据集导入工具")
    print(f"{'#'*60}")
    print(f"后端地址: {args.base_url}")
    print(f"CSV 文件: {csv_file}")
    print(f"数据来源: {args.data_source}")
    
    # 步骤 1: 上传文件
    upload_result = upload_archive(args.base_url, csv_file, args.data_source)
    
    # 步骤 2: 确认导入
    confirm_result = confirm_import(
        args.base_url,
        upload_result['datasetKey'],
        upload_result['filePath'],
        args.data_source
    )
    
    print(f"\n{'='*60}")
    print("导入流程完成!")
    print(f"{'='*60}")
    print(f"\n总结:")
    print(f"  - 数据集标识: {upload_result['datasetKey']}")
    print(f"  - 批次编号: {confirm_result['batchCode']}")
    print(f"  - 总用户数: {confirm_result['totalUsers']}")
    print(f"  - 总帖子数: {confirm_result['totalPosts']}")
    print(f"\n下一步:")
    print(f"  - 访问 {args.base_url}/api/datasets 查看数据集列表")
    print(f"  - 访问 {args.base_url}/api/datasets/{upload_result['datasetKey']}/archives 查看档案列表")


if __name__ == "__main__":
    main()
