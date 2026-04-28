# VIS4SRD 前端系统 (React 18 + TypeScript)

自杀风险可视化检测系统 - 前端项目

## 技术栈

| 技术 | 版本 | 作用 |
|------|------|------|
| React | 18.x | 核心框架 |
| TypeScript | 5.x | 类型检查 |
| Vite | 5.x | 构建工具 |
| Ant Design | 5.x | UI 组件库 |
| React Router | 6.x | 路由管理 |
| Zustand | 4.x | 状态管理 |
| Tailwind CSS | 3.x | 样式框架 |
| ECharts | 5.x | 图表可视化 |
| Three.js | 0.160+ | 3D 可视化 |

## 项目结构

```
src/
├── components/
│   └── layout/
│       ├── Layout.tsx      # 主布局容器
│       ├── Sidebar.tsx     # 侧边栏导航
│       └── TopBar.tsx      # 顶部栏
├── pages/
│   ├── HomePage.tsx        # 首页
│   ├── ModelCenterPage.tsx # 模型中心
│   ├── KnowledgeBasePage.tsx # 知识库
│   ├── ChatPage.tsx        # 智能问答
│   ├── ArchivePage.tsx     # 心理档案
│   ├── ScalePage.tsx       # 心理量表
│   ├── RiskPage.tsx        # 风险检测
│   └── MapPage.tsx         # 心理援助地图
├── types/
│   └── index.ts            # TypeScript 类型定义
├── App.tsx                 # 根组件
├── main.tsx                # 入口文件
└── index.css               # 全局样式
```

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 功能模块

1. **首页** - 系统介绍、功能入口、数据概览可视化
2. **模型中心** - DL 模型配置、LLM 设置
3. **知识库** - 知识库管理、RAG 配置
4. **智能问答** - 基于知识库的对话
5. **心理档案** - 用户数据管理
6. **心理量表** - PHQ-9 / SAS / SDS / MINI 量表
7. **风险检测** - 自杀风险分析任务
8. **心理援助地图** - 机构推荐、地理位置

## 设计规范

- 暖心温馨风格，避免冰冷与空旷
- 侧边栏可收缩，主内容区同色浅色
- ECharts + Three.js 可视化
- 响应式设计，支持移动端