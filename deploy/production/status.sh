#!/bin/bash
# =============================================
# VIS4SRD 状态检查脚本
# 使用方法: ./status.sh
# =============================================

echo "========================================"
echo "VIS4SRD 服务状态检查"
echo "========================================"

echo -e "\n【后端服务状态】"
systemctl status vis4srd-api --no-pager || true

echo -e "\n【Nginx 状态】"
systemctl status nginx --no-pager | head -10 || true

echo -e "\n【数据库连接】"
# MySQL
if mysql -u root -proot -e "SELECT 1" vis4srd &>/dev/null; then
    echo "✓ MySQL vis4srd: 已连接"
else
    echo "✗ MySQL vis4srd: 连接失败"
fi

# PostgreSQL
if sudo -u postgres psql -d mental_health -c "SELECT 1" &>/dev/null; then
    echo "✓ PostgreSQL mental_health: 已连接"
else
    echo "✗ PostgreSQL mental_health: 连接失败"
fi

echo -e "\n【端口监听】"
ss -tlnp | grep -E ':(8000|80|3306|5432)' || netstat -tlnp 2>/dev/null | grep -E ':(8000|80|3306|5432)' || echo "端口检查完成"

echo -e "\n【API 健康检查】"
curl -s http://localhost:8000/api/health 2>/dev/null | head -c 200 || echo "API 未响应"

echo ""
echo "========================================"
