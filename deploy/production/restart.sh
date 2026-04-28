#!/bin/bash
# =============================================
# VIS4SRD 重启服务脚本
# 使用方法: ./restart.sh
# =============================================

echo "重启 VIS4SRD 服务..."

# 重启后端服务
systemctl restart vis4srd-api

# 检查服务状态
if systemctl is-active --quiet vis4srd-api; then
    echo "后端服务运行正常"
else
    echo "后端服务启动失败，请检查日志"
    journalctl -u vis4srd-api --no-pager -n 20
fi
