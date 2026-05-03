# AGENTS.md

## 项目概览

VIS4SRD 是一个前后端分离的心理健康服务系统，核心模块包括：

- `backend/`：FastAPI 后端，负责认证、档案、风险检测、量表、知识库、聊天、地图等接口
- `frontend/`：React + Vite 前端，默认开发端口 `5173`
- `backend/SuiAgent-main/`：AI 对话与 RAG 相关代码
- `Fealeaner/`、`Emocc/`：模型与推理相关资源
- `datasets/`、`map_data/`、`scales/`：本地数据与配置资源

## 本地开发约束

- 后端端口固定为 `8000`
- 前端端口固定为 `5173`
- 不要随意改端口来“绕过问题”，先释放占用端口再启动
- Python 虚拟环境固定放在项目根目录：`.venv/`
- 安装依赖默认使用国内镜像源
- 前端包管理默认使用 `npmmirror`
- 开发模式默认使用：
  - 后端：`uvicorn ... --reload`
  - 前端：`vite dev`
  - LLM：开发态使用 `qwen-flash`

## 已验证的本地启动方式

### 1. Python 环境

项目根目录使用 `.venv`：

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel -i https://pypi.tuna.tsinghua.edu.cn/simple
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

说明：

- `backend/requirements.txt` 中 `langchain-core` 已收紧到兼容范围：`>=0.2.0,<0.3.0`
- 不要再改回 `>=0.3.0`，否则会和 `pydantic==2.6.1` 冲突

### 2. Node 环境

根目录已提供 `.npmrc`：

```ini
registry=https://registry.npmmirror.com/
```

安装前端依赖：

```powershell
npm install --prefix frontend --registry=https://registry.npmmirror.com
```

如果 `frontend/node_modules` 来自服务器压缩包，优先删除后重装，避免平台不兼容。

### 3. 数据库策略

本地开发当前采用：

- MySQL：本机 `127.0.0.1:3306`
- PostgreSQL：通过 SSH 隧道映射到本地 `127.0.0.1:5432`

原因：

- 本机 MySQL 已可用，并存在 `vis4srd` 数据库
- 本机 PostgreSQL 服务未直接启用，使用 SSH 隧道更稳

## SSH 隧道

本地开发若需要 PostgreSQL，请先建立隧道：

```powershell
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=60 -N -L 5432:127.0.0.1:5432 vis4srd-server
```

要求：

- 隧道本地端口固定 `5432`
- 不要临时改成 `5433/5434`，避免 `.env` 和代码来回切换

## 后端环境变量

后端实际读取的是这些变量名：

- `HOST`
- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `PG_HOST`
- `PG_PORT`
- `PG_USER`
- `PG_PASSWORD`
- `PG_NAME`

注意：

- 代码不读 `MYSQL_HOST` / `POSTGRES_HOST`
- 如果复制别的 `.env` 模板，先确认变量名是否和 `backend/src/core/config.py` 一致

## 当前本地开发配置

`backend/.env` 当前按本地开发写法整理过，核心约束是：

- `PORT=8000`
- `DB_HOST=127.0.0.1`
- `DB_PORT=3306`
- `PG_HOST=127.0.0.1`
- `PG_PORT=5432`
- `LLM_MODEL=qwen-flash`

## 启动命令

### 后端

在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
```

工作目录应切到 `backend/`。

### 前端

在项目根目录执行：

```powershell
npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173 --strictPort
```

## 启动后验证

至少验证这三项：

1. 后端健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

2. 前端首页：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/
```

3. 前端代理到后端：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/api/health
```

## 本地日志位置

建议把开发启动日志统一落到项目根目录：

- `.dev-logs/backend.stdout.log`
- `.dev-logs/backend.stderr.log`
- `.dev-logs/frontend.stdout.log`
- `.dev-logs/frontend.stderr.log`

排查启动失败时优先看这些日志。

## 关键实现结构

### 后端

- 应用入口：`backend/src/app.py`
- 路由注册：`backend/src/routes/__init__.py`
- 数据库配置：`backend/src/core/config.py`
- 连接池：`backend/src/core/database.py`
- LLM 客户端：`backend/src/core/llm_client.py`
- 聊天路由：`backend/src/routes/chat.py`
- 风险分析路由：`backend/src/routes/risk.py`
- 知识库路由：`backend/src/routes/knowledge.py`

### 前端

- 入口：`frontend/src/main.tsx`
- 路由：`frontend/src/App.tsx`
- 开发代理：`frontend/vite.config.ts`
- 页面主要集中在：`frontend/src/pages/`

## 已知注意点

- `backend/` 下存在一些形如 `=0.10.0`、`=0.3.0` 的文件，这是历史安装残留，不是正常源码入口
- `frontend/tsconfig.json` 里有重复的 `noUnusedLocals` / `noUnusedParameters`，当前只会告警，不阻塞开发服务器启动
- `8000` 可能被本机其他软件占用，已遇到过 `wpscloudsvr.exe` 抢占的情况；处理方式是释放占用，不改端口
- 若地图相关接口异常，先检查 PostgreSQL 隧道是否还活着

## 开发建议

- 修 bug 时优先在本地复现，再改代码，再走真实页面或真实接口验证
- 不要先改部署脚本，优先改 `backend/src/` 和 `frontend/src/` 的源代码
- 需要提交 Git 时，在项目根目录执行，不要在 `backend/` 或 `frontend/` 单独初始化仓库
