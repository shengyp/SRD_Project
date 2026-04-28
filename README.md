# VIS4SRD - 自杀风险可视化检测系统

<div align="center">

![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688.svg)
![React](https://img.shields.io/badge/React-18.2-61DAFB.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10-3776AB.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

**面向医生的自杀风险评估可视化系统（前后端完整版）**
本版本包含完整的前后端系统，支持真实数据存储、AI 智能分析、心理咨询地图等功能。

</div>

---

## 目录

- [系统简介](#系统简介)
- [技术架构](#技术架构)
- [功能模块](#功能模块)
- [项目结构](#项目结构)
- [快速部署](#快速部署)
- [环境变量配置](#环境变量配置)
- [API 接口文档](#api-接口文档)
- [常见问题](#常见问题)

---

## 系统简介

VIS4SRD（Visual Interactive System with Sentiment Analysis for Suicide Risk Detection）是一个面向医生的心理健康服务系统，主要功能包括：

- **心理档案管理**：导入、管理患者心理档案数据，支持 Excel/CSV 格式批量导入
- **风险检测分析**：基于机器学习模型（FeaLearner）自动评估自杀风险等级
- **量表评估系统**：支持 PHQ-9、SAS、SDS、MINI 等标准化心理量表
- **AI 智能问答**：基于 RAG 技术的心理咨询对话助手
- **心理援助地图**：基于高德地图的全国心理咨询机构查询与导航
- **知识库管理**：心理健康相关文档的上传、预览和管理
- **3D 情绪可视化**：Three.js 粒子云图展示情绪分布

> **注意**：本系统为完整前后端版本，需要配置 MySQL 和 PostgreSQL 数据库。

---

## 技术架构

### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| FastAPI | 0.109 | Web 框架 |
| Python | 3.10+ | 后端语言 |
| PostgreSQL | 15+ | 地图/机构数据存储 |
| MySQL | 8.0+ | 主业务数据存储 |
| SQLAlchemy | 2.0 | ORM |
| Uvicorn | 0.27 | ASGI 服务器 |
| Torch | 2.0+ | 深度学习模型 |
| Transformers | 4.36+ | NLP 模型 |
| LangChain | 0.3+ | RAG 知识库 |

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.2 | 前端框架 |
| TypeScript | 5.3 | 类型检查 |
| Vite | 5.0 | 构建工具 |
| Ant Design | 5.12 | UI 组件库 |
| Tailwind CSS | 3.3 | 样式框架 |
| Zustand | 4.4 | 状态管理 |
| ECharts | 5.4 | 数据可视化 |
| Three.js | 0.160 | 3D 渲染 |
| React Router | 6.20 | 路由管理 |
| Lucide React | 0.294 | 图标库 |

---

## 功能模块

### 后端模块 (`backend/`)

| 模块 | 路径 | 功能说明 |
|------|------|----------|
| 用户认证 | `src/routes/auth.py` | JWT 登录注册、密码管理 |
| 心理档案 | `src/routes/upload_archive.py` | 档案导入、查询、删除 |
| 数据集管理 | `src/routes/dataset_routes.py` | 数据集配置、CSV 处理 |
| 风险检测 | `src/routes/risk.py` | FeaLearner 模型推理 |
| 量表系统 | `src/routes/scales.py` | 量表配置、答题、结果存储 |
| 知识库 | `src/routes/knowledge.py` | 文档管理、RAG 检索 |
| 智能问答 | `src/routes/chat.py` | AI 对话、历史记录 |
| 心理地图 | `src/routes/map_routes.py` | 机构查询、热线管理 |
| 模型中心 | `src/routes/models.py` | 模型管理、状态监控 |
| 首页数据 | `src/routes/home.py` | 仪表盘统计数据 |

### 前端页面 (`frontend/src/pages/`)

| 页面 | 文件 | 功能说明 |
|------|------|----------|
| 首页仪表盘 | `HomePage.tsx` | 数据概览、快捷入口 |
| 心理档案 | `ArchivePage.tsx` | 档案列表、搜索、导入 |
| 档案详情 | `ArchiveDetailPage.tsx` | 单个档案详细信息 |
| 风险检测 | `RiskPage.tsx` | 风险评估、模型推理 |
| 量表列表 | `ScalePage.tsx` | 量表选择 |
| 量表答题 | `ScaleAnswerPage.tsx` | 在线答题 |
| 量表结果 | `ScaleResultPage.tsx` | 结果展示、历史 |
| 模型中心 | `ModelCenterPage.tsx` | 模型状态管理 |
| 知识库 | `KnowledgeBasePage.tsx` | 文档列表 |
| 知识详情 | `KnowledgeDocDetailPage.tsx` | 文档预览 |
| 智能问答 | `ChatPage.tsx` | AI 对话界面 |
| 心理地图 | `MapPage.tsx` | 机构地图、定位 |
| 文档预览 | `DocPreviewPage.tsx` | PDF/Markdown 预览 |
| 登录注册 | `LoginPage.tsx` / `RegisterPage.tsx` | 用户认证 |
| 个人中心 | `ProfilePage.tsx` | 用户信息管理 |
| 修改密码 | `ChangePasswordPage.tsx` | 密码修改 |

---

## 项目结构

```
vis4srd-V2.0/
├── backend/                      # FastAPI 后端
│   ├── src/
│   │   ├── app.py               # 主应用入口
│   │   ├── core/                # 核心配置
│   │   │   ├── config.py        # 环境配置
│   │   │   ├── database.py      # 数据库连接池
│   │   │   ├── security.py      # 安全工具
│   │   │   └── llm_client.py    # LLM 客户端
│   │   ├── routes/              # API 路由
│   │   │   ├── auth.py          # 认证接口
│   │   │   ├── user_routes.py   # 用户管理
│   │   │   ├── upload_archive.py # 档案管理
│   │   │   ├── dataset_routes.py # 数据集
│   │   │   ├── risk.py          # 风险检测
│   │   │   ├── scales.py        # 量表系统
│   │   │   ├── knowledge.py     # 知识库
│   │   │   ├── chat.py          # 智能问答
│   │   │   ├── map_routes.py    # 心理地图
│   │   │   ├── models.py        # 模型中心
│   │   │   ├── home.py          # 首页数据
│   │   │   └── ...
│   │   ├── services/            # 业务逻辑
│   │   │   ├── map_service.py   # 地图服务
│   │   │   ├── chat_service.py  # 问答服务
│   │   │   ├── fealearner_service.py # 模型推理
│   │   │   └── ...
│   │   └── models/              # 数据模型
│   ├── SuiAgent-main/           # AI Agent 模块
│   │   ├── agent.py            # Agent 主程序
│   │   ├── rag_skill_tool.py    # RAG 工具
│   │   └── ...
│   ├── uploads/                 # 上传文件存储
│   ├── requirements.txt         # Python 依赖
│   └── .env                     # 环境变量
│
├── frontend/                     # React 前端
│   ├── src/
│   │   ├── pages/              # 页面组件（16个页面）
│   │   ├── components/          # 通用组件
│   │   │   └── layout/         # 布局组件
│   │   ├── api/                # API 调用封装
│   │   ├── services/           # 业务服务
│   │   ├── stores/             # 状态管理
│   │   ├── types/              # TypeScript 类型
│   │   ├── scales/             # 量表定义
│   │   ├── App.tsx             # 路由配置
│   │   └── main.tsx            # 入口文件
│   ├── public/                  # 静态资源
│   ├── dist/                   # 构建输出
│   ├── package.json            # 前端依赖
│   ├── vite.config.ts          # Vite 配置
│   └── nginx.conf              # Nginx 配置
│
├── Fealeaner/                   # FeaLearner 模型
│   ├── FeaLearner/             # 模型核心
│   │   ├── bigdata/           # 大数据模型
│   │   ├── weibo/             # 微博模型
│   │   ├── reddit/            # Reddit 模型
│   │   └── sigir/             # SIGIR 模型
│   ├── feature_data/           # 特征数据
│   ├── predict_with_bestmodel.py # 预测脚本
│   └── README.md               # 模型说明
│
├── datasets/                     # 数据集目录
│   ├── archives/               # 心理档案数据
│   └── reddit/                # Reddit 数据集
│
├── deploy/                       # 部署配置
│   └── production/              # 生产环境
│
├── docs/                         # 文档目录
├── map_data/                     # 地图数据
├── scales/                       # 量表配置
└── README.md                     # 本文档
```

---

## 快速部署

### 环境要求

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Python | 3.10+ | 后端运行环境 |
| Node.js | 18+ | 前端构建（可选） |
| PostgreSQL | 15+ | 地图数据存储 |
| MySQL | 8.0+ | 主业务数据库 |
| Redis | 6+ | 缓存（可选） |

### 步骤 1：配置环境变量

复制后端配置文件：

```bash
cd backend
cp .env.example .env  # 如果有示例文件
# 编辑 .env 填写数据库配置
```

参考配置项：

```env
# 数据库配置
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=vis4srd

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=vis4srd_map

# JWT 配置
JWT_SECRET_KEY=your-secret-key
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# 高德地图 API（用于心理援助地图）
AMAP_KEY=your-amap-key
AMAP_SECURITY_CODE=your-security-code

# AI 模型配置（可选）
OPENAI_API_KEY=your-api-key
```

### 步骤 2：安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

### 步骤 3：初始化数据库

```bash
# 创建 MySQL 数据库
mysql -u root -p
CREATE DATABASE vis4srd CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 创建 PostgreSQL 数据库
psql -U postgres
CREATE DATABASE vis4srd_map;
```

### 步骤 4：启动后端服务

```bash
cd backend
uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
```

后端服务将运行在：http://localhost:8000

### 步骤 5：启动前端开发服务器

```bash
cd frontend
npm install
npm run dev
```

前端服务将运行在：http://localhost:5173

### 生产环境部署

使用 Nginx 反向代理前端静态资源：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/vis4srd-V2.0/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 环境变量配置

### 后端 `.env` 配置项

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `MYSQL_HOST` | 是 | MySQL 主机地址 | localhost |
| `MYSQL_PORT` | 是 | MySQL 端口 | 3306 |
| `MYSQL_USER` | 是 | MySQL 用户名 | root |
| `MYSQL_PASSWORD` | 是 | MySQL 密码 | password |
| `MYSQL_DATABASE` | 是 | MySQL 数据库名 | vis4srd |
| `POSTGRES_HOST` | 是 | PostgreSQL 主机 | localhost |
| `POSTGRES_PORT` | 是 | PostgreSQL 端口 | 5432 |
| `POSTGRES_USER` | 是 | PostgreSQL 用户 | postgres |
| `POSTGRES_PASSWORD` | 是 | PostgreSQL 密码 | password |
| `POSTGRES_DATABASE` | 是 | PostgreSQL 数据库 | vis4srd_map |
| `JWT_SECRET_KEY` | 是 | JWT 密钥 | your-secret |
| `JWT_ALGORITHM` | 否 | JWT 算法 | HS256 |
| `JWT_EXPIRE_MINUTES` | 否 | Token 过期时间(分钟) | 1440 |
| `VITE_API_BASE` | 前端 | API 基础地址 | /api |
| `VITE_AMAP_KEY` | 前端 | 高德地图 Key | your-key |
| `VITE_AMAP_SECURITY_CODE` | 前端 | 高德安全码 | your-code |

---

## API 接口文档

启动服务后访问 API 文档：

- Swagger UI：http://localhost:8000/docs
- ReDoc：http://localhost:8000/redoc

### 主要接口列表

| 模块 | 前缀 | 说明 |
|------|------|------|
| 认证 | `/api/auth` | 登录、注册、Token |
| 用户 | `/api/users` | 用户管理 |
| 档案 | `/api/archives` | 心理档案 CRUD |
| 数据集 | `/api/datasets` | 数据集管理 |
| 风险 | `/api/risk` | 风险评估推理 |
| 量表 | `/api/scales` | 量表相关接口 |
| 知识库 | `/api/knowledge` | 文档管理 |
| 问答 | `/api/chat` | AI 对话 |
| 地图 | `/api/institutions` | 机构查询 |
| 地图 | `/api/hotlines` | 热线查询 |
| 模型 | `/api/models` | 模型管理 |
| 首页 | `/api/home` | 统计数据 |

---

## 常见问题

### Q1：后端启动报错 `ModuleNotFoundError`

**原因**：Python 依赖未安装。

**解决**：

```bash
cd backend
pip install -r requirements.txt
```

### Q2：数据库连接失败

**原因**：数据库服务未启动或配置错误。

**解决**：
1. 确保 MySQL 和 PostgreSQL 服务已启动
2. 检查 `.env` 中的数据库配置
3. 确认数据库和用户已创建

```bash
# 检查 MySQL 服务状态
systemctl status mysql

# 检查 PostgreSQL 服务状态
systemctl status postgresql
```

### Q3：高德地图加载失败

**原因**：未配置高德地图 API Key 或 Key 无效。

**解决**：
1. 在高德开放平台申请 Web API Key
2. 在前端 `.env` 或 `index.html` 中配置：

```html
<script src="https://webapi.amap.com/maps?v=2.0&key=YOUR_KEY"></script>
```

### Q4：模型推理服务不可用

**原因**：FeaLearner 模型文件缺失或 PyTorch 未安装。

**解决**：

```bash
# 安装 PyTorch
pip install torch torchvision

# 检查模型文件
ls Fealeaner/FeaLearner/
```

### Q5：前端构建失败

**原因**：Node.js 版本过低或依赖冲突。

**解决**：

```bash
# 清理缓存重新安装
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### Q6：JWT Token 过期

**原因**：Token 默认 24 小时过期。

**解决**：
1. 重新登录获取新 Token
2. 修改 `JWT_EXPIRE_MINUTES` 调整过期时间

### Q7：RAG 知识库检索无结果

**原因**：知识库文档未上传或索引未建立。

**解决**：
1. 在知识库页面上传文档
2. 系统会自动建立索引
3. 等待索引完成后重试

---

## 停止服务

```bash
# 停止后端服务
pkill -f "uvicorn src.app"

# 停止前端服务
cd frontend && npm run build
```

---

## 致谢

本系统面向医生设计，用于辅助自杀风险评估。所有数据均经过脱敏处理，不包含任何真实患者敏感信息。

---

## 联系方式

如有问题，请通过 GitHub Issues 提交。
