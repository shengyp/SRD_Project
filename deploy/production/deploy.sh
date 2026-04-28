#!/bin/bash
# =============================================
# VIS4SRD 部署脚本
# 使用方法: ./deploy.sh
# =============================================

set -e

echo "========================================"
echo "VIS4SRD 生产环境部署脚本"
echo "========================================"

# 定义颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="/www/wwwroot/vis4srd-V2.0"
DEPLOY_DIR="$PROJECT_ROOT/deploy/production"

# 切换到项目根目录
cd "$PROJECT_ROOT"

# ========== 步骤 1: 安装 Python 依赖 ==========
echo -e "\n${GREEN}[1/7]${NC} 安装后端 Python 依赖..."
cd "$PROJECT_ROOT/backend"

# 使用国内镜像安装
pip3 install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple --break-system-packages

# ========== 步骤 2: 创建数据库 ==========
echo -e "\n${GREEN}[2/7]${NC} 创建数据库..."

# MySQL
mysql -u root -proot -e "CREATE DATABASE IF NOT EXISTS vis4srd CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo -e "${GREEN}✓${NC} MySQL 数据库 vis4srd 创建完成"

# PostgreSQL
sudo -u postgres psql -c "CREATE DATABASE mental_health;" 2>/dev/null || echo "PostgreSQL 数据库已存在"
echo -e "${GREEN}✓${NC} PostgreSQL 数据库 mental_health 创建完成"

# ========== 步骤 3: 导入数据 ==========
echo -e "\n${GREEN}[3/7]${NC} 导入数据库..."

# MySQL 数据导入
mysql -u root -proot vis4srd < "$PROJECT_ROOT/backend/deploy/mysql_full.sql"
echo -e "${GREEN}✓${NC} MySQL 数据导入完成"

# PostgreSQL 数据导入
sudo -u postgres psql -d mental_health -f "$PROJECT_ROOT/backend/deploy/postgres_full.sql"
echo -e "${GREEN}✓${NC} PostgreSQL 数据导入完成"

# ========== 步骤 4: 配置后端环境变量 ==========
echo -e "\n${GREEN}[4/7]${NC} 配置后端环境变量..."
cp "$DEPLOY_DIR/.env.production" "$PROJECT_ROOT/backend/.env"
echo -e "${GREEN}✓${NC} 环境变量配置完成"

# ========== 步骤 5: 构建前端 ==========
echo -e "\n${GREEN}[5/7]${NC} 构建前端..."
cd "$PROJECT_ROOT/frontend"

# 安装前端依赖
npm install --registry=https://registry.npmmirror.com

# 构建生产版本
npm run build
echo -e "${GREEN}✓${NC} 前端构建完成"

# ========== 步骤 6: 配置 Nginx ==========
echo -e "\n${GREEN}[6/7]${NC} 配置 Nginx..."

# 复制 Nginx 配置
cp "$PROJECT_ROOT/frontend/nginx.conf" /etc/nginx/conf.d/vis4srd.conf

# 创建前端静态文件目录
mkdir -p /usr/share/nginx/html/vis4srd
cp -r "$PROJECT_ROOT/frontend/dist"/* /usr/share/nginx/html/vis4srd/

# 测试 Nginx 配置
nginx -t

# 重载 Nginx
systemctl reload nginx
echo -e "${GREEN}✓${NC} Nginx 配置完成"

# ========== 步骤 7: 启动后端服务 ==========
echo -e "\n${GREEN}[7/7]${NC} 启动后端服务..."

# 创建 systemd 服务文件
cat > /etc/systemd/system/vis4srd-api.service << 'EOF'
[Unit]
Description=VIS4SRD FastAPI Backend Service
After=network.target

[Service]
User=root
WorkingDirectory=/www/wwwroot/vis4srd-V2.0/backend
Environment="PATH=/usr/bin:/usr/local/bin:/bin"
ExecStart=/usr/local/bin/uvicorn src.app:app --host 0.0.0.0 --port 8000 --workers 4
Restart=always
RestartSec=5
StandardOutput=append:/www/wwwroot/vis4srd-V2.0/deploy/production/logs/vis4srd-api.log
StandardError=append:/www/wwwroot/vis4srd-V2.0/deploy/production/logs/vis4srd-api-error.log

[Install]
WantedBy=multi-user.target
EOF

# 重载 systemd
systemctl daemon-reload

# 启动服务
systemctl enable vis4srd-api
systemctl restart vis4srd-api

echo -e "${GREEN}✓${NC} 后端服务启动完成"

# ========== 验证 ==========
echo -e "\n${GREEN}[完成]${NC} 部署完成!"
echo -e "\n服务状态:"
systemctl status vis4srd-api --no-pager || true
echo -e "\n访问地址: http://localhost"
echo -e "API 地址: http://localhost:8000"
echo -e "API 文档: http://localhost:8000/docs"
