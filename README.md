# VIS4SRD

VIS4SRD 是一个面向心理健康服务与自杀风险识别场景的前后端分离系统，围绕“心理档案 -> 风险检测 -> 量表评估 -> 知识支持 -> 对话辅助 -> 地图资源”这条链路组织功能。

当前仓库已经包含：

- FastAPI 后端
- React + Vite 前端
- FeaLearner / Emocc 本地风险检测资源
- SuiAgent RAG 对话与知识库目录
- 内置心理量表定义
- 内置数据集同步与校验脚本

这份 README 只描述当前仓库里真实存在、能对应到代码与脚本的内容。

说明：

- `Emocc/` 为本地推理资源目录，包含大量 `.pth`、`.pkl`、`.bin` 文件，默认不纳入 GitHub 仓库。
- 如需在新环境运行 Emocc 推理，请按现有目录结构单独同步该目录。

---

## 1. 项目结构

```text
vis4srd/
├─ backend/                      # FastAPI 后端
│  ├─ src/
│  │  ├─ app.py                  # 应用入口
│  │  ├─ core/                   # 配置、数据库、鉴权、LLM 客户端
│  │  ├─ routes/                 # API 路由
│  │  ├─ services/               # 业务服务
│  │  └─ models/                 # Pydantic Schema
│  ├─ scripts/                   # 数据同步/校验脚本
│  ├─ deploy/                    # 数据库导出与修复脚本
│  ├─ SuiAgent-main/             # Agent 与 RAG 相关代码/知识目录
│  └─ requirements.txt
├─ frontend/                     # React + Vite 前端
│  ├─ src/
│  │  ├─ pages/                  # 页面
│  │  ├─ components/             # 组件
│  │  ├─ api/                    # 接口封装
│  │  ├─ hooks/                  # 前端钩子
│  │  ├─ store/                  # Zustand 状态
│  │  └─ scales/                 # 量表辅助定义
│  ├─ package.json
│  └─ vite.config.ts
├─ datasets/                     # 内置数据集 CSV
├─ scales/                       # 量表 JSON 定义
├─ map_data/                     # 地图机构数据资源
├─ Fealeaner/                    # FeaLearner 模型与推理脚本
├─ Emocc/                        # Emocc 本地模型资源（默认不纳入 Git）
├─ docs/                         # 设计/数据库/部署文档
└─ deploy/production/            # 生产部署脚本
```

---

## 2. 系统能力概览

### 后端模块

- `auth.py`：登录、注册、登出、个人信息、修改密码
- `upload_archive.py`：档案模板、CSV 上传、确认导入、上传文件管理
- `dataset_routes.py`：内置数据集列表、档案分页、帖子分页、关键词、对比视图
- `user_routes.py`：统一档案列表、档案详情、删除
- `risk.py`：风险检测任务、Emocc 检测、模型对比、风险报告
- `scales.py`：量表任务创建、答题、结果查询、删除
- `knowledge.py`：知识主题、文档管理、预览、下载、同步
- `chat.py`：聊天会话、消息、推荐问题、流式问答
- `map_routes.py`：心理机构、热线、城市、周边检索
- `models.py`：模型中心、提示词模板、API / 本地模型能力
- `home.py`：首页统计与趋势
- `health.py`：健康检查

### 前端页面

- `/home`：首页仪表盘
- `/archive`：心理档案列表
- `/archive/detail/:archiveId`：档案详情
- `/risk`：风险检测任务与结果
- `/scale`、`/scale/answer/:taskId`、`/scale/result/:taskId`：量表流程
- `/knowledge`、`/knowledge/detail`：知识库
- `/chat`：AI 对话
- `/map`：心理援助地图
- `/model`：模型中心
- `/profile`、`/change-password`：账号信息

前端路由默认要求登录；未登录会跳转到 `/login`。

---

## 3. 技术栈

### 后端

- Python 3.10+
- FastAPI
- Uvicorn
- aiomysql
- asyncpg
- orjson
- pandas / numpy
- torch / transformers / scikit-learn
- OpenAI SDK
- langchain-core `>=0.2.0,<0.3.0`

### 前端

- React 18
- TypeScript 5
- Vite 5
- Ant Design 5
- Zustand
- ECharts
- Three.js
- Lucide React

---

## 4. 当前运行依赖

本项目本地开发默认依赖两类数据库：

- MySQL：业务数据，默认 `127.0.0.1:3306`
- PostgreSQL：地图/地理数据，默认通过 SSH 隧道映射到 `127.0.0.1:5432`

固定约束：

- 后端端口固定 `8000`
- 前端端口固定 `5173`
- Python 虚拟环境固定在项目根目录 `.venv/`
- 不要靠改端口绕过问题，优先释放占用

---

## 5. 快速启动

### 5.1 安装 Python 依赖

项目默认使用根目录 `.venv`：

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel -i https://pypi.tuna.tsinghua.edu.cn/simple
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

注意：

- `backend/requirements.txt` 中 `langchain-core` 的兼容范围已经收紧到 `>=0.2.0,<0.3.0`
- 不要改回 `>=0.3.0`，否则会和当前依赖组合冲突

### 5.2 安装前端依赖

```powershell
npm install --prefix frontend --registry=https://registry.npmmirror.com
```

如果 `frontend/node_modules` 来自别的机器的压缩包，优先删掉重装。

### 5.3 建立 PostgreSQL SSH 隧道

地图相关接口依赖 PostgreSQL 时，先建立本地映射：

```powershell
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=60 -N -L 5432:127.0.0.1:5432 vis4srd-server
```

本地端口固定为 `5432`。

### 5.4 配置后端环境变量

从 `backend/.env.example` 复制一份到 `backend/.env`，再按本地环境修改。

后端实际读取的是这些变量名：

```env
HOST=0.0.0.0
PORT=8000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=vis4srd

PG_HOST=127.0.0.1
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=your_pg_password
PG_NAME=mental_health

AMAP_WEB_SERVICE_KEY=your_amap_key

LLM_API_KEY=your_api_key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=qwen-flash

JWT_SECRET_KEY=replace_me
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

注意：

1. 代码读取的是 `DB_HOST / PG_HOST`，不读取 `MYSQL_HOST / POSTGRES_HOST`
2. `backend/.env.example` 里示例 `PORT=3000` 不是当前项目的本地开发端口，实际应改成 `8000`
3. 当前开发态推荐 `LLM_MODEL=qwen-flash`

### 5.5 启动后端

在项目根目录进入 `backend/` 后执行：

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
```

### 5.6 启动前端

在项目根目录执行：

```powershell
npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173 --strictPort
```

前端开发代理位于 `frontend/vite.config.ts`：

- `/api` -> `http://localhost:8000`
- `/uploads` -> `http://localhost:8000/knowledge`

---

## 6. 启动后验证

至少验证三项：

### 6.1 后端健康检查

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

### 6.2 前端首页

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/
```

### 6.3 前端代理到后端

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/api/health
```

如果前两步通、第三步不通，优先检查：

- 后端是否真的跑在 `8000`
- 前端是否真的跑在 `5173`
- `frontend/vite.config.ts` 的代理是否被改动

---

## 7. 数据与脚本

### 7.1 内置数据集

当前后端围绕 `datasets/` 下的 CSV 构建内置数据集，核心数据源包括：

- `reddit`
- `bigdata`
- `sigir`
- `weibo`

相关脚本：

- `backend/scripts/sync_builtin_datasets.py`
- `backend/scripts/verify_builtin_archives.py`
- `backend/scripts/import_dataset_api.py`

同步命令：

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\sync_builtin_datasets.py
```

校验命令：

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\verify_builtin_archives.py
```

### 7.2 量表定义

量表定义放在根目录 `scales/`，当前包含：

- `BHS`
- `C-SSRS`
- `DASS-21`
- `GAD-7`
- `ISI`
- `PHQ-9`
- `SDS`

后端读取入口位于 `backend/src/services/scale_catalog.py`。

### 7.3 模型与知识资源

- `Fealeaner/`：FeaLearner 模型文件、特征数据与预测脚本
- `Emocc/`：Emocc 模型资源
- `backend/SuiAgent-main/`：对话 Agent、RAG 技能、知识目录、记忆文件

---

## 8. 关键代码入口

### 后端

- `backend/src/app.py`：服务入口与生命周期管理
- `backend/src/routes/__init__.py`：所有路由导出
- `backend/src/core/config.py`：配置读取
- `backend/src/core/database.py`：MySQL / PostgreSQL 连接池
- `backend/src/core/llm_client.py`：LLM 客户端
- `backend/src/routes/upload_archive.py`：档案上传与导入
- `backend/src/routes/risk.py`：风险检测
- `backend/src/routes/knowledge.py`：知识库
- `backend/src/routes/chat.py`：聊天与流式对话

### 前端

- `frontend/src/main.tsx`：前端入口
- `frontend/src/App.tsx`：路由与鉴权守卫
- `frontend/src/api/index.ts`：接口封装
- `frontend/src/components/layout/Layout.tsx`：整体布局
- `frontend/vite.config.ts`：开发代理

---

## 9. 接口文档

服务启动后可访问：

- Swagger UI: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- ReDoc: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

常用接口前缀：

- `/api/health`
- `/api/auth/*`
- `/api/home/*`
- `/api/datasets/*`
- `/api/users/*`
- `/api/upload/archive/*`
- `/api/risk/*`
- `/api/scales/*`
- `/api/knowledge/*`
- `/api/chat/*`
- `/api/models/*`
- `/api/institutions/*`
- `/api/hotlines/*`

---

## 10. 本地日志与排错

建议把本地开发日志统一放到根目录 `.dev-logs/`：

- `.dev-logs/backend.stdout.log`
- `.dev-logs/backend.stderr.log`
- `.dev-logs/frontend.stdout.log`
- `.dev-logs/frontend.stderr.log`

常见排查方向：

### 10.1 `8000` 端口被占用

本项目要求后端固定跑在 `8000`。不要先改端口，先查占用并释放。

### 10.2 地图接口异常

优先检查 PostgreSQL SSH 隧道是否还活着，以及 `PG_HOST/PG_PORT` 是否仍然是 `127.0.0.1:5432`。

### 10.3 前端接口请求失败

先确认：

1. 后端是否已成功启动
2. 前端是否已成功启动
3. Vite 代理是否仍指向 `http://localhost:8000`

### 10.4 档案或量表数据不一致

优先执行：

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\verify_builtin_archives.py
```

---

## 11. 已知注意点

- `backend/` 下存在一些形如 `=0.10.0`、`=0.3.0` 的历史残留文件，不是正常源码入口
- `frontend/tsconfig.json` 里有重复的 `noUnusedLocals / noUnusedParameters`，当前会告警，但不阻塞开发服务器启动
- `frontend/.env.dev` 含有开发环境配置，生产部署不要直接照搬
- 后端启动时会自动尝试把本地知识目录元信息同步到数据库
- 后端启动时还会异步预热一次 Agent 池

---

## 12. 推荐阅读顺序

如果你第一次接这个项目，建议按下面的顺序理解：

1. 看 `backend/src/app.py`，先理解服务启动流程
2. 看 `frontend/src/App.tsx`，先理解页面与路由
3. 跑通 `/api/health` 和前端首页
4. 看 `datasets/`、`scales/`、`backend/scripts/`
5. 再进入具体业务模块，例如档案导入、风险检测、知识库或聊天

---

## 13. 相关文档

- `AGENTS.md`：当前仓库协作约束与本地开发要求
- `docs/VIS4SRD_数据库设计文档.md`：数据库结构与字段设计
- `docs/部署经验文档.md`：部署与运行经验
- `docs/Chat页面_Agent返回结构交付文档.md`：聊天页面相关结构说明

---

## 14. 适用范围说明

这个系统涉及心理健康、自杀风险、危机干预等敏感场景。当前仓库更适合用于：

- 课程 / 毕设 / demo 演示
- 算法与系统联调
- 可视化展示与原型迭代
- 数据管线、量表与问答模块整合

不应将模型输出直接作为临床诊断结论使用。
