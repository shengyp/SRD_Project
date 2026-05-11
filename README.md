# VIS4SRD

VIS4SRD 是一个面向心理健康服务与自杀风险识别场景的前后端分离系统，围绕“心理档案管理 -> 风险检测 -> 量表评估 -> 知识支持 -> AI 对话 -> 援助地图”构建完整业务链路。

本仓库适合作为课程项目、毕设 Demo、系统联调与功能演示基础版本使用。当前提交以“可运行、可复现、可继续开发”为目标整理，保留系统运行必需代码、配置示例、前端页面、后端接口、数据资源；体积较大的嵌入文件和模型权重不纳入 Git，由使用者按 README 指引自行补充。

---

## 1. 仓库包含内容

```text
vis4srd/
├─ backend/                      # FastAPI 后端
│  ├─ src/                       # 路由、服务、配置、数据库、鉴权、LLM 调用
│  ├─ scripts/                   # 内置数据同步、校验、导入脚本
│  ├─ deploy/                    # 数据导出/修复脚本
│  ├─ SuiAgent-main/             # Agent / RAG / 知识库相关代码
│  ├─ uploads/                   # 上传目录（仓库仅保留必要占位）
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
├─ Emocc/                        # Emocc 代码与配套 CSV（大权重/大嵌入文件需自行补充）
├─ Fealeaner/                    # FeaLearner 代码与特征 CSV（大权重/大嵌入文件需自行补充）
├─ docs/                         # 设计与部署说明
└─ deploy/                       # 部署脚本
```

---

## 2. 主要功能

### 后端能力

- 用户登录、注册、个人信息、密码修改
- 心理档案导入、列表、详情、删除
- 内置数据集浏览、同步、对比与关键词分析
- 风险检测任务创建、FeaLearner / Emocc 结果展示、报告导出
- 心理量表任务创建、答题、结果查看
- 知识库主题、文档管理、预览、下载、同步
- AI 对话、推荐问题、流式返回、RAG 知识增强
- 心理援助机构、热线、城市、周边信息查询
- 模型中心与健康检查

### 前端页面

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

## 3. 技术栈

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
- Three.js

---

## 4. 本次仓库整理说明

本次提交遵循以下原则：

- 保留系统运行与功能联调所必需的源码、配置示例、前端页面、后端接口、内置数据与轻量模型文件
- 不上传本地开发辅助文件，例如 `AGENTS.md`、`.dev-logs/`、`.venv/`、`node_modules/`、构建产物、缓存和临时输出
- 不上传超大嵌入文件和较大的模型权重，避免仓库体积失控

### 已明确排除但需要自行补充的文件

以下资源没有随仓库上传，若要完整运行对应风险检测能力，需要按原目录结构手动补齐：

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

- 其中 `.pkl` 属于预编码嵌入资源，`.pth` 属于模型权重，`.bin` 属于 Emocc 预训练 emoji 向量
- 这些文件原本就放在上面列出的路径中，补文件时请保持目录不变
- 代码、CSV、量表、地图数据、知识目录结构均已保留
- 若上述文件缺失，系统中依赖 Emocc / FeaLearner 的风险检测能力将无法完整运行

---

## 5. 本地运行前提

### 固定约束

- 后端端口：`8000`
- 前端端口：`5173`
- Python 虚拟环境：项目根目录 `.venv/`
- 前端包管理镜像：`npmmirror`
- 后端开发模式：`uvicorn --reload`

### 数据库依赖

本项目默认依赖两类数据库：

- MySQL：业务数据，默认 `127.0.0.1:3306`
- PostgreSQL：地图相关数据，默认 `127.0.0.1:5432`

如果本地 PostgreSQL 并不直接开放，可通过 SSH 隧道映射：

```powershell
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=60 -N -L 5432:127.0.0.1:5432 vis4srd-server
```

---

## 6. 环境安装

### 6.1 Python 依赖

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel -i https://pypi.tuna.tsinghua.edu.cn/simple
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

注意：`backend/requirements.txt` 中 `langchain-core` 已限制为 `>=0.2.0,<0.3.0`，不要改回 `>=0.3.0`。

### 6.2 前端依赖

```powershell
npm install --prefix frontend --registry=https://registry.npmmirror.com
```

---

## 7. 环境变量配置

从 `backend/.env.example` 复制为 `backend/.env`，再按实际环境填写。

后端实际读取这些变量名：

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

注意：

- 代码读取的是 `DB_HOST / PG_HOST`，不是 `MYSQL_HOST / POSTGRES_HOST`
- 开发态推荐 `LLM_MODEL=qwen-flash`

---

## 8. 启动方式

### 8.1 启动后端

在项目根目录执行：

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
```

### 8.2 启动前端

在项目根目录执行：

```powershell
npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173 --strictPort
```

前端开发代理位于 `frontend/vite.config.ts`，默认将 `/api` 代理到 `http://localhost:8000`。

---

## 9. 启动后验证

至少验证以下三项：

### 9.1 后端健康检查

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health
```

### 9.2 前端首页

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/
```

### 9.3 前端代理到后端

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/api/health
```

---

## 10. 关键目录说明

### `datasets/`

包含系统依赖的内置数据集与导入模板，后端会直接从这里读取 CSV 进行同步或构造视图。该目录已经纳入仓库。

### `map_data/`

包含心理机构与热线地图数据，地图模块依赖该目录。该目录已经纳入仓库。

### `Emocc/`

当前仓库已保留：

- Emocc 模型代码
- 配套 emoji CSV

当前仓库未保留、需自行补充：

- `Emocc/reddit/data/reddit_500_bert_embeddings.pkl`
- `Emocc/bigdata/data/bigdata_bert.pkl`
- `Emocc/sigir/data/sigir_bert.pkl`
- `Emocc/weibo/data/user_post_embeddings_filtered.pkl`
- `Emocc/reddit/Emocc_model/checkpoints/emocc_model.pth`
- `Emocc/bigdata/Emocc_model/checkpoints/emocc_model.pth`
- `Emocc/sigir/Emocc_model/checkpoints/emocc_model.pth`
- `Emocc/weibo/Emocc_model/checkpoints/emocc_model.pth`
- `Emocc/reddit/pre-trained/emoji2vec.bin`
- `Emocc/bigdata/pre-trained/emoji2vec.bin`
- `Emocc/sigir/pre-trained/emoji2vec.bin`
- `Emocc/weibo/pre-trained/emoji2vec.bin`

### `Fealeaner/`

当前仓库已保留：

- FeaLearner 推理脚本
- `feature_data/` 下特征 CSV

当前仓库未保留、需自行补充：

- `Fealeaner/data/bert_embeddings.pkl`
- `Fealeaner/data/user_post_embeddings_bert_wwm.pkl`
- `Fealeaner/bestmodel/my_reddit_model.pth`
- `Fealeaner/bestmodel/my_bigdata_model.pth`
- `Fealeaner/bestmodel/my_sigir_model.pth`
- `Fealeaner/bestmodel/my_weibo_model.pth`

---

## 11. 常用脚本

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

## 12. 接口文档

后端启动后可访问：

- Swagger UI: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- ReDoc: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

---

## 13. 已知说明

- 项目包含心理健康、自杀风险、危机干预等敏感场景，本仓库更适合教学、课程、毕设、实验与演示用途
- 模型输出不能直接作为临床诊断结论
- 若地图接口异常，优先检查 PostgreSQL 是否可用
- 若风险检测接口异常，优先检查上文列出的 `pkl`、`.pth`、`.bin` 文件是否已补齐

---

## 14. 推荐接手顺序

1. 先看 `backend/src/app.py`，理解后端启动和路由注册
2. 再看 `frontend/src/App.tsx`，理解页面路由与登录保护
3. 跑通 `/api/health`、前端首页与前端代理
4. 检查 `datasets/`、`map_data/`、`scales/` 是否已按预期加载
5. 如需完整风险检测，再补齐 README 中列出的 `pkl` 资源

---

## 15. 说明

本次提交已主动排除以下非项目交付内容：

- 根目录 `AGENTS.md` 等 Codex / 开发协作说明
- 本地虚拟环境、前端依赖目录、构建结果、日志与缓存
- 本地调试输出与上传残留

如果需要进一步部署到服务器，建议结合 `docs/` 与 `deploy/` 目录继续整理生产环境配置。
