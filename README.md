# VIS4SRD

VIS4SRD 是一个面向心理健康服务与自杀风险识别场景的 Web 系统原型，围绕档案管理、风险检测、量表评估、知识支持、对话辅助和援助地图构建了一条完整的业务链路。项目采用前后端分离架构，前端负责交互与可视化，后端负责业务接口、数据处理、模型调用与知识检索。

本仓库对应 demo paper 的系统实现部分，重点展示系统结构、核心功能组织方式与可运行原型，而不是作为课程作业或单纯的页面开发练习仓库。

---

## 1. 系统概览

系统主要包含以下模块：

- 用户认证与个人信息管理
- 心理档案导入、查看与维护
- 自杀风险检测与结果展示
- 心理量表填写与结果查看
- 心理健康知识库与文档预览
- 基于大模型的问答对话
- 心理援助机构与热线地图查询

整体流程可概括为：

`用户数据接入 -> 档案管理 -> 风险识别/量表评估 -> 知识支持与对话辅助 -> 援助资源查询`

---

## 2. 仓库结构

```text
vis4srd/
├─ backend/                      # FastAPI 后端
│  ├─ src/                       # 路由、服务、配置、数据库、鉴权、模型调用
│  ├─ scripts/                   # 内置数据同步、校验、导入脚本
│  ├─ deploy/                    # 数据导出与修复脚本
│  ├─ SuiAgent-main/             # Agent、RAG 与知识库相关代码
│  ├─ uploads/                   # 上传目录占位
│  ├─ requirements.txt
│  └─ .env.example
├─ frontend/                     # React + Vite 前端
│  ├─ src/                       # 页面、组件、接口封装、状态管理
│  ├─ public/
│  ├─ package.json
│  └─ vite.config.ts
├─ datasets/                     # 内置数据集与导入模板
├─ map_data/                     # 心理机构与热线地图数据
├─ scales/                       # 心理量表定义
├─ Emocc/                        # Emocc 相关代码与配套资源
├─ Fealeaner/                    # FeaLearner 相关代码与特征资源
├─ docs/                         # 设计与部署说明
└─ deploy/                       # 部署脚本
```

---

## 3. 核心功能

### 3.1 后端功能

- 用户注册、登录、密码修改、个人信息管理
- 心理档案导入、列表查询、详情查看、删除
- 内置数据集浏览、同步、对比与关键词分析
- 风险检测任务创建、Emocc / FeaLearner 结果展示、报告导出
- 心理量表任务创建、答题流程与结果查看
- 知识库主题、文档管理、预览、下载、同步
- AI 对话、推荐问题、流式返回、RAG 知识增强
- 心理援助机构、热线、城市与周边信息查询

### 3.2 前端页面

- `/login`：登录
- `/home`：首页仪表盘
- `/archive`：心理档案
- `/risk`：风险检测
- `/scale`：量表任务与答题流程
- `/knowledge`：知识库
- `/chat`：AI 对话
- `/map`：心理援助地图
- `/model`：模型中心
- `/profile`：个人中心

---

## 4. 技术栈

### 后端

- Python 3.10+
- FastAPI
- Uvicorn
- aiomysql
- asyncpg
- pandas / numpy
- torch / transformers / scikit-learn
- OpenAI SDK
- langchain-core `>=0.2.0,<0.3.0`

### 前端

- React 18
- TypeScript
- Vite 5
- Ant Design 5
- Zustand
- ECharts

---

## 5. 本次公开版本说明

当前仓库保留了系统原型运行所需的主要源码、配置示例、前端页面、后端接口、内置数据、量表文件、地图数据以及知识库目录结构。

出于仓库体积与分发方式的考虑，部分大体积嵌入文件、模型权重和预训练向量没有直接随 Git 上传。这些资源不影响代码结构阅读与大部分页面、接口、知识库、量表、地图等模块的展示，但会影响完整的风险检测能力。

---

## 6. 未随仓库上传的补充资源

若要完整运行 Emocc / FeaLearner 相关风险检测能力，需要按原目录结构补齐以下文件：

1. `Emocc/reddit/data/reddit_500_bert_embeddings.pkl`
2. `Emocc/bigdata/data/bigdata_bert.pkl`
3. `Emocc/sigir/data/sigir_bert.pkl`
4. `Emocc/weibo/data/user_post_embeddings_filtered.pkl`
5. `Emocc/reddit/Emocc_model/checkpoints/emocc_model.pth`
6. `Emocc/bigdata/Emocc_model/checkpoints/emocc_model.pth`
7. `Emocc/sigir/Emocc_model/checkpoints/emocc_model.pth`
8. `Emocc/weibo/Emocc_model/checkpoints/emocc_model.pth`
9. `Emocc/reddit/pre-trained/emoji2vec.bin`
10. `Emocc/bigdata/pre-trained/emoji2vec.bin`
11. `Emocc/sigir/pre-trained/emoji2vec.bin`
12. `Emocc/weibo/pre-trained/emoji2vec.bin`
13. `Fealeaner/data/bert_embeddings.pkl`
14. `Fealeaner/data/user_post_embeddings_bert_wwm.pkl`
15. `Fealeaner/bestmodel/my_reddit_model.pth`
16. `Fealeaner/bestmodel/my_bigdata_model.pth`
17. `Fealeaner/bestmodel/my_sigir_model.pth`
18. `Fealeaner/bestmodel/my_weibo_model.pth`

说明：

- `.pkl` 文件主要为预编码嵌入资源
- `.pth` 文件主要为模型权重
- `.bin` 文件主要为 Emocc 使用的预训练 emoji 向量
- 若这些文件缺失，系统中依赖 Emocc / FeaLearner 的风险检测能力将无法完整运行

---

## 7. 本地运行环境

### 固定约束

- 后端端口：`8000`
- 前端端口：`5173`
- Python 虚拟环境：项目根目录 `.venv/`
- 前端安装镜像：`npmmirror`

### 数据库依赖

项目默认依赖两类数据库：

- MySQL：业务数据，默认 `127.0.0.1:3306`
- PostgreSQL：地图相关数据，默认 `127.0.0.1:5432`

如果本地 PostgreSQL 不直接开放，可通过 SSH 隧道映射：

```powershell
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=60 -N -L 5432:127.0.0.1:5432 vis4srd-server
```

---

## 8. 依赖安装

### 8.1 Python 依赖

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel -i https://pypi.tuna.tsinghua.edu.cn/simple
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

注意：`backend/requirements.txt` 中 `langchain-core` 已限制为 `>=0.2.0,<0.3.0`，不要改回 `>=0.3.0`。

### 8.2 前端依赖

```powershell
npm install --prefix frontend --registry=https://registry.npmmirror.com
```

---

## 9. 环境变量配置

从 `backend/.env.example` 复制为 `backend/.env`，再按实际环境填写。

后端实际读取以下变量：

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
PG_NAME=mental_health
PG_USER=postgres
PG_PASSWORD=your_pg_password

AMAP_WEB_SERVICE_KEY=your_amap_key_here

LLM_API_KEY=your_llm_api_key_here
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=qwen-flash

SUIIAGENT_KNOWLEDGE_PATH=./SuiAgent-main/rag-skill/knowledge

JWT_SECRET_KEY=replace_me_in_local_env
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440

FORCE_INIT=false
```

说明：

- 代码读取的是 `DB_HOST / PG_HOST`，不是 `MYSQL_HOST / POSTGRES_HOST`
- 开发环境推荐使用 `LLM_MODEL=qwen-flash`

---

## 10. 启动方式

### 10.1 启动后端

在项目根目录执行：

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
```

### 10.2 启动前端

在项目根目录执行：

```powershell
npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173 --strictPort
```

前端开发代理位于 `frontend/vite.config.ts`，默认将 `/api` 代理到 `http://localhost:8000`。

---

## 11. 基本验证

启动后建议至少验证以下三项：

### 11.1 后端健康检查

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

### 11.2 前端首页

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/
```

### 11.3 前端代理到后端

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/api/health
```

---

## 12. 常用脚本

### 同步内置数据集

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\sync_builtin_datasets.py
```

### 校验内置档案

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\verify_builtin_archives.py
```

### 通过 API 导入档案 CSV

```powershell
cd backend
..\.venv\Scripts\python.exe scripts\import_dataset_api.py ..\datasets\archives\导入模板_Excel.csv --base-url http://127.0.0.1:8000
```

---

## 13. 接口文档

后端启动后可访问：

- Swagger UI: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- ReDoc: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

---

## 14. 使用说明

- 本项目包含心理健康、自杀风险识别与危机干预等敏感场景，系统输出仅作为技术研究与原型演示结果，不应直接替代临床诊断或人工干预判断
- 若地图相关接口异常，优先检查 PostgreSQL 是否可用
- 若风险检测接口异常，优先检查第 6 节列出的补充资源是否已按路径补齐

---

## 15. 建议阅读顺序

1. 先查看 `backend/src/app.py`，了解后端启动方式与路由组织
2. 再查看 `frontend/src/App.tsx`，了解前端路由与页面入口
3. 跑通 `/api/health`、前端首页与前端代理
4. 查看 `datasets/`、`map_data/`、`scales/` 目录，理解系统依赖的数据与量表资源
5. 如需完整风险检测能力，再补齐第 6 节列出的模型与嵌入资源
