#!/bin/bash
# =============================================
# VIS4SRD 日志查看脚本
# 使用方法: ./logs.sh [lines]
# 默认显示最后 100 行
# =============================================

LINES=${1:-100}

echo "========== VIS4SRD 后端日志 (最后 $LINES 行) =========="
tail -n "$LINES" /www/wwwroot/vis4srd-V2.0/deploy/production/logs/vis4srd-api.log

echo ""
echo "========== VIS4SRD 错误日志 (最后 $LINES 行) =========="
tail -n "$LINES" /www/wwwroot/vis4srd-V2.0/deploy/production/logs/vis4srd-api-error.log
