#!/bin/bash
# =============================================
# VIS4SRD 停止服务脚本
# 使用方法: ./stop.sh
# =============================================

echo "停止 VIS4SRD 服务..."

# 停止后端服务
systemctl stop vis4srd-api 2>/dev/null || true

# 重载 Nginx
nginx -s reload 2>/dev/null || true

echo "服务已停止"
