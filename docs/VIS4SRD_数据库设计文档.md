# VIS4SRD 数据库设计文档

> **项目名称**: Visual Interactive System with Sentiment Analysis for Suicide Risk Detection
> **版本**: 3.0
> **创建日期**: 2026-03-27
> **最后更新**: 2026-03-28（全面优化：合并数据集表、删除map模块、完善各模块对应前端）
> **参考项目**: AgriKEVAS 农业知识抽取系统
> **设计原则**: 去除敏感信息，简化字段，与前端设计保持一致

---

## 一、数据库架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VIS4SRD 数据库架构                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                      MySQL 主数据库                             │     │
│  │                       (vis4srd)                               │     │
│  ├───────────────────────────────────────────────────────────────┤     │
│  │ • 首页统计模块 (homepage_summary_stats)                       │     │
│  │ • 数据集模块 (dataset_profile)                                 │     │
│  │ • 心理档案模块 (psychological_archives, user_posts)           │     │
│  │ • 心理量表模块 (scale_definitions, scale_tasks)              │     │
│  │ • 模型中心模块 (models, prompt_templates)                     │     │
│  │ • 风险检测模块 (risk_detection_tasks, risk_detection_sub_tasks)│     │
│  │ • 知识库模块 (knowledge_topics, knowledge_documents)           │     │
│  │ • 智能问答模块 (chat_sessions, chat_messages)                │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、模块对应关系

| 前端模块 | 对应数据库表 | 说明 |
|---------|-------------|------|
| 首页 (HomePage) | `homepage_summary_stats` | 首页统计数据汇总 |
| 数据集 (通用) | `dataset_profile` | 合并 UI/元信息 + 分类体系 + 粗粒度映射，单表替代原双表 |
| 心理档案 (ArchivePage) | `psychological_archives` + `user_posts` + `archive_import_batch` | 用户脱敏档案 + 贴文明细 + 导入批次 |
| 心理量表 (ScalePage) | `scale_tasks` + `scale_definitions` | 量表任务 + 量表定义 |
| 风险检测 (RiskPage) | `risk_detection_tasks` + `detection_task_types` | 风险检测任务记录 + 检测任务类型 |
| 模型中心 (ModelCenterPage) | `models` + `prompt_templates` | 模型配置 + 提示词模板 |
| 知识库 (KnowledgeBasePage) | `knowledge_documents` + `knowledge_topics` | 知识文档 + 主题分类 |
| 智能问答 (ChatPage) | `chat_sessions` + `chat_messages` + `chat_document_references` + `chat_recommended_questions` | 会话管理 + 消息记录 + 文档引用 + 推荐问题 |

---

### 2.1 首页统计汇总表 (homepage_summary_stats)

> **设计说明**: 存储首页 Dashboard 的统计数据，直接对应前端 HomePage 的统计卡片和风险分布图。
> - 数据由后端定时任务（每日凌晨）或相关模块数据变更时触发更新
> - 前端仅做展示，不做计算

```sql
CREATE TABLE IF NOT EXISTS homepage_summary_stats (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    stat_key VARCHAR(50) NOT NULL UNIQUE COMMENT '统计项标识',
    stat_label VARCHAR(100) NOT NULL COMMENT '统计项标签（前端展示用）',
    stat_value INT DEFAULT 0 COMMENT '统计数值',
    stat_unit VARCHAR(20) COMMENT '统计单位（如"个"、"份"）',
    stat_icon VARCHAR(50) COMMENT '图标名称',
    stat_color VARCHAR(20) DEFAULT '#C19A83' COMMENT '主题色',
    stat_type ENUM('count', 'percentage', 'currency', 'text') DEFAULT 'count' COMMENT '统计类型',
    stat_category VARCHAR(50) COMMENT '所属分类（如 risk_distribution/count）',
    stat_order INT DEFAULT 0 COMMENT '排序顺序',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_stat_key (stat_key),
    INDEX idx_stat_category (stat_category),
    INDEX idx_stat_order (stat_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首页统计汇总表';

-- 初始化首页统计项
INSERT INTO homepage_summary_stats (stat_key, stat_label, stat_value, stat_unit, stat_icon, stat_color, stat_type, stat_category, stat_order) VALUES
-- 核心统计卡片
('knowledge_base_docs', '知识库文档', 128, '个', 'BookOpen', '#C19A83', 'count', 'core_stats', 1),
('total_archives', '总档案数', 1256, '个', 'FileText', '#C19A83', 'count', 'core_stats', 2),
('total_scales', '总量表数', 4, '种', 'ClipboardList', '#C19A83', 'count', 'core_stats', 3),
('reports_generated', '报告生成数', 384, '份', 'FileBarChart', '#C19A83', 'count', 'core_stats', 4),
-- 风险等级分布（环形图数据）
('risk_low_count', '低风险用户数', 0, '个', NULL, '#52c41a', 'count', 'risk_distribution', 10),
('risk_low_percentage', '低风险占比', 45, '%', NULL, '#52c41a', 'percentage', 'risk_distribution', 11),
('risk_medium_count', '中风险用户数', 0, '个', NULL, '#faad14', 'count', 'risk_distribution', 12),
('risk_medium_percentage', '中风险占比', 30, '%', NULL, '#faad14', 'percentage', 'risk_distribution', 13),
('risk_high_count', '高风险用户数', 0, '个', NULL, '#ff4d4f', 'count', 'risk_distribution', 14),
('risk_high_percentage', '高风险占比', 25, '%', NULL, '#ff4d4f', 'percentage', 'risk_distribution', 15);
```

---

## 三、MySQL 主数据库设计

### 3.1 心理档案模块

#### 3.1.1 心理档案主表 (psychological_archives)

> **设计说明**: 存储**用户级别**的汇总信息，一个用户对应一条档案记录
> - `user_id`: 数据集提供的用户ID标识
> - `dataset_source`: 数据来源，决定了该档案使用哪种分类体系
> - **风险等级是用户级别的评估**
> - `label`: 数据集提供的人工标签数字（真实分类）
> - `micro_expressions` / `emjio_sequence`: 用户级别统计，数组长度 = post_count
> - `frequent_words`: 近N天内频繁词汇

```sql
CREATE TABLE IF NOT EXISTS psychological_archives (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    user_id VARCHAR(64) NOT NULL UNIQUE COMMENT '用户ID(来自数据集)',
    dataset_source VARCHAR(50) NOT NULL COMMENT '数据来源(weibo/bigdata/reddit/sigir)',
    post_count INT DEFAULT 0 COMMENT '贴文数量',
    -- 用户级别风险等级（用于统一展示）
    risk_level ENUM('low', 'medium', 'high') DEFAULT 'low' COMMENT '粗粒度风险等级(低/中/高)',
    -- 用户级别细粒度风险值（精确分类，参考各数据集定义）
    -- SIGIR/Weibo: 0=无风险, 1=有风险
    -- BigData: 0=无风险, 1=低风险, 2=中风险, 3=高风险
    -- Reddit: 0=无风险, 1=极低风险, 2=低风险, 3=中风险, 4=高风险
    risk_value INT DEFAULT 0 COMMENT '细粒度风险值(根据数据集定义)',
    -- 人工标签（数据集提供的真实分类标签）
    label INT COMMENT '人工标签数字(数据集原始标签)',
    -- 用户级别时间戳信息（bigdata数据集有，其他数据集无）
    has_timestamp BOOLEAN DEFAULT FALSE COMMENT '是否有时间戳(bigdata有，其他无)',
    post_timestamp_start DATETIME COMMENT '用户最早发布时间(仅bigdata有)',
    post_timestamp_end DATETIME COMMENT '用户最晚发布时间(仅bigdata有)',
    -- 用户级别是否有表情序列
    has_emojis BOOLEAN DEFAULT FALSE COMMENT '是否有表情序列',
    -- 导入批次关联
    import_batch_id BIGINT COMMENT '关联导入批次ID',
    -- 导入时间
    import_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '导入时间',
    -- 近N天内频繁词汇
    frequent_words JSON COMMENT '频繁词汇统计(JSON数组)',
    -- ============================================================
    -- 重要性聚合（由 user_posts 统计而来，ArchiveDetailPage 用）
    -- ============================================================
    high_importance_count INT DEFAULT 0 COMMENT '高重要性帖子数量(importance_score>=0.7)',
    medium_importance_count INT DEFAULT 0 COMMENT '中等重要性帖子数量(0.4<=importance_score<0.7)',
    low_importance_count INT DEFAULT 0 COMMENT '低重要性帖子数量(importance_score<0.4)',
    avg_importance_score DECIMAL(5, 4) COMMENT '平均重要性分数(0-1)',
    -- Top N 重要性帖子聚合（JSON数组，存储 post_index/score/content 前3-5条）
    top_posts_summary JSON COMMENT 'Top重要性帖子摘要(JSON数组，每条含post_index/importance_score/content摘要)',
    -- 档案处理状态
    status ENUM('importing', 'ready', 'analyzing') DEFAULT 'importing' COMMENT '状态(导入中/已就绪/分析中)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    FOREIGN KEY (import_batch_id) REFERENCES archive_import_batch(id) ON DELETE SET NULL,
    FOREIGN KEY (dataset_source) REFERENCES dataset_profile(dataset_key),
    INDEX idx_user_id (user_id),
    INDEX idx_dataset_source (dataset_source),
    INDEX idx_risk_level (risk_level),
    INDEX idx_risk_value (risk_value),
    INDEX idx_label (label),
    INDEX idx_importance_level (importance_level),
    INDEX idx_avg_importance_score (avg_importance_score),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='心理档案主表';

-- 补充 ALTER 语句（如果表已存在，新增字段和索引）
ALTER TABLE psychological_archives
    ADD COLUMN IF NOT EXISTS high_importance_count INT DEFAULT 0 COMMENT '高重要性帖子数量',
    ADD COLUMN IF NOT EXISTS medium_importance_count INT DEFAULT 0 COMMENT '中等重要性帖子数量',
    ADD COLUMN IF NOT EXISTS low_importance_count INT DEFAULT 0 COMMENT '低重要性帖子数量',
    ADD COLUMN IF NOT EXISTS avg_importance_score DECIMAL(5, 4) COMMENT '平均重要性分数',
    ADD COLUMN IF NOT EXISTS top_posts_summary JSON COMMENT 'Top重要性帖子摘要',
    ADD INDEX IF NOT EXISTS idx_importance_level (importance_level),
    ADD INDEX IF NOT EXISTS idx_avg_importance_score (avg_importance_score);
```

#### 3.1.2 用户贴文明细表 (user_posts)

> **设计说明**: 存储**贴文级别**的详细信息，每条帖子一条记录
> - `emoji_count`: 该帖子的表情个数
> - `emoji_sequence`: 该帖子的表情序列
> - `post_timestamp`: 发布时间（仅bigdata有，其他为NULL）
> - **`fine_risk_value`**: 细粒度风险值（来自导入文件的 `suicide_risk` 列，对应各数据集原始标签）
> - **`review_status`**: 检查状态（对应导入向导步骤2的接受/拒绝）

```sql
CREATE TABLE IF NOT EXISTS user_posts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    archive_id BIGINT NOT NULL COMMENT '关联档案ID',
    user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
    post_index INT DEFAULT 0 COMMENT '贴文序号(从1开始)',
    content TEXT NOT NULL COMMENT '贴文内容',
    sentiment_score DECIMAL(5, 4) COMMENT '情感分数(0-1)',
    -- ============================================================
    -- 重要性分数（ArchiveDetailPage 核心展示字段）
    -- attention_score：用于图表柱形图颜色映射（替代 sentiment_score）
    -- 0-0.4: 低重要性(low) | 0.4-0.7: 中重要性(medium) | >=0.7: 高重要性(high)
    -- ============================================================
    importance_score DECIMAL(5, 4) COMMENT '重要性分数(0-1，越高越重要，ArchiveDetailPage图表用)',
    -- 贴文级别风险等级（由 importance_score 计算而来，用于筛选）
    importance_level ENUM('low', 'medium', 'high') COMMENT '重要性等级(low<0.4/medium 0.4-0.7/high>=0.7)',
    -- ============================================================
    -- 微表情序列（用于 ArchiveDetailPage 详情展示）
    -- ============================================================
    micro_expressions JSON COMMENT '微表情序列(JSON数组，如 ["sad","angry","fear"])',
    -- 贴文级别时间戳（仅bigdata数据集有，其他为NULL）
    post_timestamp DATETIME COMMENT '发布时间(仅bigdata有，其他为NULL)',
    -- 贴文级别表情
    emoji_count INT DEFAULT 0 COMMENT '表情个数',
    emoji_sequence VARCHAR(500) COMMENT '表情序列',
    -- 导入文件原始字段
    fine_risk_value INT COMMENT '细粒度风险值(导入文件suicide_risk列，0/1/2/3/4)',
    -- 审核状态（对应导入向导步骤2）
    review_status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending' COMMENT '检查状态(待处理/已接受/已拒绝)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    FOREIGN KEY (archive_id) REFERENCES psychological_archives(id) ON DELETE CASCADE,
    INDEX idx_archive_id (archive_id),
    INDEX idx_user_id (user_id),
    INDEX idx_post_index (post_index),
    INDEX idx_importance_score (importance_score),
    INDEX idx_importance_level (importance_level),
    INDEX idx_fine_risk_value (fine_risk_value),
    INDEX idx_review_status (review_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户贴文明细表';

-- 补充 ALTER 语句（如果表已存在，新增字段）
ALTER TABLE user_posts
    ADD COLUMN IF NOT EXISTS importance_score DECIMAL(5, 4) COMMENT '重要性分数(0-1，越高越重要，ArchiveDetailPage图表用)' AFTER sentiment_score,
    ADD COLUMN IF NOT EXISTS importance_level ENUM('low', 'medium', 'high') COMMENT '重要性等级(low<0.4/medium 0.4-0.7/high>=0.7)' AFTER importance_score,
    ADD COLUMN IF NOT EXISTS micro_expressions JSON COMMENT '微表情序列(JSON数组)' AFTER importance_level,
    ADD INDEX IF NOT EXISTS idx_importance_score (importance_score),
    ADD INDEX IF NOT EXISTS idx_importance_level (importance_level);
```

---

### 3.2 数据集字典模块（替代原 dataset_series + dataset_config）

#### 3.2.1 数据集档案表 (dataset_profile)

> **设计说明**: 合并原 `dataset_series`（UI属性 + 元信息）与 `dataset_config`（分类体系 + 粗粒度映射）为一张表，消除 1:1 冗余；每个数据集只有一行，是**静态字典**，不是导入流水。
>
> **与 `archive_import_batch` 的关系**: 导入批次表通过 `dataset_key` 外键引用本表，数据集字典本身不存任何导入记录。

```sql
CREATE TABLE IF NOT EXISTS dataset_profile (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    dataset_key VARCHAR(50) NOT NULL UNIQUE COMMENT '数据集唯一标识(weibo/bigdata/reddit/sigir)',
    display_name VARCHAR(100) NOT NULL COMMENT '显示名称(微博系列/BigData系列/Reddit系列/SIGIR系列)',
    description TEXT COMMENT '系列描述',
    -- UI属性（前端直接使用 Tailwind 类名）
    icon VARCHAR(50) DEFAULT 'database' COMMENT 'Lucide 图标名称',
    color VARCHAR(20) DEFAULT '#C19A83' COMMENT '主色(Tailwind类)',
    bg_color VARCHAR(20) DEFAULT 'bg-orange-100' COMMENT '背景色(Tailwind类)',
    text_color VARCHAR(20) DEFAULT 'text-orange-700' COMMENT '文字色(Tailwind类)',
    -- 数据语言与分类体系
    language VARCHAR(20) NOT NULL COMMENT '数据语言(中文/英文)',
    class_system ENUM('binary', 'multi-class') DEFAULT 'binary' COMMENT '分类体系(二分类/多分类)',
    class_count INT DEFAULT 2 COMMENT '分类数量(2=二分类/4=四分类/5=五分类)',
    -- 细粒度标签（用于前端动态渲染风险等级，根据各数据集 class_system/class_count 定义）
    -- binary (class_count=2): {"0": "无风险", "1": "有风险"}
    -- multi-class (class_count=4): {"0": "无风险", "1": "低风险", "2": "中风险", "3": "高风险"}
    -- multi-class (class_count=5): {"0": "无风险", "1": "极低风险", "2": "低风险", "3": "中风险", "4": "高风险"}
    fine_labels JSON COMMENT '细粒度标签定义(JSON对象，key为数字字符串，value为中文标签名)',
    -- 粗粒度映射规则（细粒度值 → low/medium/high）
    -- binary: {"0": "low", "1": "high"}
    -- multi-class-4: {"0": "low", "1": "low", "2": "medium", "3": "high"}
    -- multi-class-5: {"0": "low", "1": "low", "2": "medium", "3": "high", "4": "high"}
    coarse_risk_mapping JSON COMMENT '粗粒度映射(JSON对象，key为数字字符串，value为low/medium/high)',
    -- 累计统计（导入后由触发器或后端更新）
    total_users INT DEFAULT 0 COMMENT '累计用户数',
    total_posts INT DEFAULT 0 COMMENT '累计帖子数',
    total_archives INT DEFAULT 0 COMMENT '累计已导入档案数',
    -- 元数据
    is_builtin BOOLEAN DEFAULT TRUE COMMENT '是否内置数据集',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    sort_order INT DEFAULT 0 COMMENT '排序顺序(值越小越靠前)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_dataset_key (dataset_key),
    INDEX idx_language (language),
    INDEX idx_class_system (class_system),
    INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据集档案表（合并 UI+分类+映射）';

-- 初始化内置数据集
INSERT INTO dataset_profile (dataset_key, display_name, description, icon, color, bg_color, text_color, language, class_system, class_count, fine_labels, coarse_risk_mapping, sort_order) VALUES
('sigir', 'SIGIR系列', 'SIGIR学术数据集，英文来源，二分类：无风险(0)/有风险(1)', 'book-open', 'bg-green-500', 'bg-green-100', 'text-green-700', '英文', 'binary', 2, '{"0": "无风险", "1": "有风险"}', '{"0": "low", "1": "high"}', 1),
('bigdata', 'BigData系列', '大数据实验数据集，中文来源，四分类：无风险(0)/低风险(1)/中风险(2)/高风险(3)', 'database', 'bg-purple-500', 'bg-purple-100', 'text-purple-700', '中文', 'multi-class', 4, '{"0": "无风险", "1": "低风险", "2": "中风险", "3": "高风险"}', '{"0": "low", "1": "low", "2": "medium", "3": "high"}', 2),
('reddit', 'Reddit系列', 'Reddit社区数据集，英文来源，五分类：无风险(0)/极低风险(1)/低风险(2)/中风险(3)/高风险(4)', 'message-circle', 'bg-orange-500', 'bg-orange-100', 'text-orange-700', '英文', 'multi-class', 5, '{"0": "无风险", "1": "极低风险", "2": "低风险", "3": "中风险", "4": "高风险"}', '{"0": "low", "1": "low", "2": "medium", "3": "high", "4": "high"}', 3),
('weibo', '微博系列', '微博平台数据集，中文来源，二分类：无风险(0)/有风险(1)', 'message-square', 'bg-blue-500', 'bg-blue-100', 'text-blue-700', '中文', 'binary', 2, '{"0": "无风险", "1": "有风险"}', '{"0": "low", "1": "high"}', 4);
```

> **各数据集分类体系说明**:
> - **SIGIR/Weibo**: 2分类 (0=无风险, 1=有风险)
> - **BigData**: 4分类 (0=无风险, 1=低风险, 2=中风险, 3=高风险)
> - **Reddit**: 5分类 (0=无风险, 1=极低风险, 2=低风险, 3=中风险, 4=高风险)
>
> **粗粒度映射规则** (coarse_risk_mapping): 用于将细粒度 risk_value 映射为粗粒度 risk_level
> - low: 低风险（不需要紧急干预）
> - medium: 中风险（需要关注、定期跟进）
> - high: 高风险（需要立即关注/干预）

---

### 3.3 心理档案导入批次表

> **设计说明**: 记录每次完整导入任务的全部信息，用于审计和追溯。包含文件信息、统计快照、字段映射、审核结果等。
>
> **状态流转**: `uploading` → `reviewing` → `committed`（提交后不可逆）/ `failed`

```sql
CREATE TABLE IF NOT EXISTS archive_import_batch (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    batch_code VARCHAR(100) UNIQUE COMMENT '批次编号（如 IMP-20260327-001）',
    dataset_key VARCHAR(50) NOT NULL COMMENT '数据集标识(weibo/bigdata/reddit/sigir)',
    -- 文件信息
    original_filename VARCHAR(255) COMMENT '原始文件名',
    file_format VARCHAR(20) COMMENT '文件格式(csv/xlsx/txt)',
    file_size BIGINT DEFAULT 0 COMMENT '文件大小（字节）',
    -- 步骤1：数据集统计信息
    total_rows INT DEFAULT 0 COMMENT '文件总行数（不含表头）',
    unique_users INT DEFAULT 0 COMMENT '唯一用户数（自动统计）',
    unique_posts INT DEFAULT 0 COMMENT '唯一帖子数（自动统计）',
    -- 步骤1：细粒度风险分布（自动统计每个细粒度类别的数量）
    -- 例如二分类: {"0": 300, "1": 200}
    -- 例如四分类: {"0": 100, "1": 150, "2": 150, "3": 100}
    fine_risk_distribution JSON COMMENT '细粒度风险分布({"0": 数量, "1": 数量, ...})',
    -- 细粒度分类信息（引用 dataset_profile 的分类体系）
    fine_class_count INT COMMENT '细粒度分类数量(2/4/5)',
    fine_labels JSON COMMENT '细粒度标签定义(JSON对象，key为数字字符串，value为中文标签名)',
    -- 粗粒度映射规则（细粒度值 → low/medium/high）
    coarse_risk_mapping JSON COMMENT '粗粒度映射(JSON对象，key为数字字符串，value为low/medium/high)',
    -- 粗粒度风险分布（自动计算）
    coarse_risk_distribution JSON COMMENT '粗粒度风险分布({"low": 数量, "medium": 数量, "high": 数量})',
    -- 步骤2：人工填写项
    post_count INT DEFAULT 1 COMMENT '帖子数量（人工填写，最小1）',
    is_manual_annotation BOOLEAN DEFAULT FALSE COMMENT '是否手工标注',
    -- 步骤2：字段筛选
    has_timestamp BOOLEAN DEFAULT FALSE COMMENT '是否有时间戳字段',
    has_emojis BOOLEAN DEFAULT FALSE COMMENT '是否有表情序列字段',
    selected_fields JSON COMMENT '导入的字段列表(JSON数组)',
    -- 步骤3：审核结果
    accepted_rows INT DEFAULT 0 COMMENT '接受的数据条数',
    rejected_rows INT DEFAULT 0 COMMENT '拒绝的数据条数',
    -- 状态
    status ENUM('uploading', 'reviewing', 'committed', 'failed') DEFAULT 'uploading' COMMENT '状态(上传中/审核中/已提交/失败)',
    error_message TEXT COMMENT '错误信息（失败时填写）',
    -- 时间
    committed_at DATETIME COMMENT '提交时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    FOREIGN KEY (dataset_key) REFERENCES dataset_profile(dataset_key),
    INDEX idx_batch_code (batch_code),
    INDEX idx_dataset_key (dataset_key),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='心理档案导入批次表';
```

> **字段说明**:
>
> | 字段类别 | 字段 | 来源 | 说明 |
> |---------|------|------|------|
> | **文件信息** | `file_format` | 自动 | CSV/XLSX/TXT |
> | **统计信息** | `total_rows` | 自动 | 文件总行数 |
> | | `unique_users` | 自动 | 唯一用户数 |
> | | `unique_posts` | 自动 | 唯一帖子数 |
> | | `fine_risk_distribution` | 自动 | 细粒度风险分布({"0": 数量, "1": 数量}) |
> | | `fine_class_count` | 自动 | 细粒度分类数量(2/4/5) |
> | | `fine_labels` | 自动 | 细粒度标签定义 |
> | | `coarse_risk_mapping` | 自动 | 粗粒度映射规则 |
> | | `coarse_risk_distribution` | 自动 | 粗粒度风险分布({"low": 数量}) |
> | **人工填写** | `post_count` | 人工 | 帖子数量（最小1） |
> | | `is_manual_annotation` | 人工 | 是否手工标注 |
> | **字段筛选** | `has_timestamp` | 自动检测 | 是否有时间戳 |
> | | `has_emojis` | 自动检测 | 是否有表情序列 |
> | | `selected_fields` | 人工 | 导入的字段列表 |
> | **审核结果** | `accepted_rows` | 自动 | 接受的数据条数 |
> | | `rejected_rows` | 自动 | 拒绝的数据条数 |

### 3.4 心理量表模块

#### 3.4.1 量表定义表 (scale_definitions)

> **设计说明**: 定义心理量表的基本信息，参考 AgriKEVAS 任务类型表设计

```sql
CREATE TABLE IF NOT EXISTS scale_definitions (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    scale_code VARCHAR(50) NOT NULL UNIQUE COMMENT '量表代码(PHQ9/CSSRS/GAD7/DASS21)',
    scale_name VARCHAR(100) NOT NULL COMMENT '量表名称简称',
    full_name VARCHAR(200) NOT NULL COMMENT '量表完整名称',
    description TEXT COMMENT '量表描述',
    category VARCHAR(50) COMMENT '量表类别(depression/anxiety/crisis/stress)',
    question_count INT NOT NULL COMMENT '题目数量',
    max_score INT NOT NULL COMMENT '满分',
    threshold INT COMMENT '阈值(超过此分数视为有问题)',
    questions JSON COMMENT '题目列表(JSON数组)',
    instructions TEXT COMMENT '量表指导语',
    interpretation TEXT COMMENT '结果解释说明',
    estimated_time VARCHAR(20) DEFAULT '约10分钟' COMMENT '预计完成时间',
    color VARCHAR(20) DEFAULT '#C19A83' COMMENT '主题色',
    bg_color VARCHAR(20) DEFAULT '#C19A83' COMMENT '背景色',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_scale_code (scale_code),
    INDEX idx_category (category),
    INDEX idx_is_active (is_active),
    INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='量表定义表';

-- 初始化内置量表
INSERT INTO scale_definitions (scale_code, scale_name, full_name, description, category, question_count, max_score, threshold, color, bg_color) VALUES
('PHQ9', 'PHQ-9', '患者健康问卷-9', '抑郁症筛查量表', 'depression', 9, 27, 10, 'bg-purple-500', 'bg-purple-100'),
('CSSRS', 'C-SSRS', '哥伦比亚自杀严重程度评定量表', '自杀风险评估量表', 'crisis', 6, 18, 3, 'bg-red-500', 'bg-red-100'),
('GAD7', 'GAD-7', '广泛性焦虑障碍量表', '焦虑障碍筛查量表', 'anxiety', 7, 21, 10, 'bg-blue-500', 'bg-blue-100'),
('DASS21', 'DASS-21', '抑郁焦虑压力量表', '抑郁焦虑压力三维度评估', 'stress', 21, 63, 20, 'bg-pink-500', 'bg-pink-100');
```

#### 3.4.2 量表评估任务表 (scale_tasks)

> **设计说明**: 存储量表评估任务记录，包含前端展示所需的基本信息

```sql
CREATE TABLE IF NOT EXISTS scale_tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    task_name VARCHAR(255) NOT NULL COMMENT '任务名称',
    
    -- ============================================================
    -- 用户基本信息（前端展示用）
    -- ============================================================
    user_id BIGINT COMMENT '用户ID',
    user_hash VARCHAR(64) NOT NULL COMMENT '脱敏用户标识',
    user_gender VARCHAR(10) COMMENT '用户性别',
    user_age INT COMMENT '用户年龄',
    user_alias VARCHAR(100) DEFAULT '匿名用户' COMMENT '用户昵称/别名（前端展示用）',
    
    -- ============================================================
    -- 档案与数据来源
    -- ============================================================
    archive_id BIGINT COMMENT '关联档案ID',
    data_source VARCHAR(50) COMMENT '数据来源(SIGIR/BigData/Weibo/Reddit)',
    data_source_label VARCHAR(100) COMMENT '数据来源显示名称(如微博系列/BigData系列/Reddit系列/SIGIR系列)',
    
    -- ============================================================
    -- 量表基本信息（冗余存储便于前端快速查询，可通过 scale_id 关联获取完整信息）
    -- ============================================================
    scale_id INT NOT NULL COMMENT '量表ID',
    scale_code VARCHAR(50) NOT NULL COMMENT '量表代码(PHQ9/CSSRS/GAD7/DASS21)',
    scale_name VARCHAR(100) COMMENT '量表名称简称',
    scale_full_name VARCHAR(200) COMMENT '量表完整名称',
    scale_category VARCHAR(50) COMMENT '量表类别(depression/anxiety/crisis/stress)',
    scale_color VARCHAR(20) DEFAULT '#C19A83' COMMENT '主题色',
    scale_bg_color VARCHAR(20) DEFAULT '#C19A83' COMMENT '背景色',
    
    -- ============================================================
    -- 评估进度与状态
    -- ============================================================
    status ENUM('pending', 'in_progress', 'completed', 'expired') DEFAULT 'pending' COMMENT '任务状态',
    progress INT DEFAULT 0 COMMENT '进度(0-100)',
    total_questions INT DEFAULT 0 COMMENT '总题数',
    answered_questions INT DEFAULT 0 COMMENT '已答题数',
    
    -- ============================================================
    -- 答案与评分
    -- answers 存储每题的得分：[{"q_id": 1, "score": 2}, {"q_id": 2, "score": 1}, ...]
    -- 注意：心理量表没有"标准答案"，每题选项对应不同分值
    -- ============================================================
    answers JSON COMMENT '答案列表 [{"q_id": INT, "score": INT}]',
    total_score INT COMMENT '总分(根据选项分值自动计算)',
    risk_level VARCHAR(20) COMMENT '风险等级(low/medium/high，基于总分与量表阈值计算)',
    
    -- ============================================================
    -- 评估结果（JSON格式，存储量表解读详情）
    -- ============================================================
    assessment_result TEXT COMMENT '评估结果详情(JSON格式)',
    -- assessment_result JSON 结构示例：
    -- {
    --   "riskInfo": { "level": "high", "label": "高风险", "description": "总分23分，处于高风险水平..." },
    --   "comfortMessage": {
    --     "title": "请不要独自面对",
    --     "content": "...",
    --     "suggestions": ["寻求专业帮助", "联系家人", "拨打热线"],
    --     "action": "进入风险检测"   // 高风险时触发
    --   },
    --   "questionAnalysis": [  // 每题详细分析（可选）
    --     { "q_id": 1, "answer": 2, "score": 2, "interpretation": "..." }
    --   ]
    -- }

    started_at DATETIME COMMENT '开始时间',
    completed_at DATETIME COMMENT '完成时间',
    expired_at DATETIME COMMENT '过期时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    FOREIGN KEY (scale_id) REFERENCES scale_definitions(id) ON DELETE CASCADE,
    INDEX idx_task_name (task_name),
    INDEX idx_user_id (user_id),
    INDEX idx_user_hash (user_hash),
    INDEX idx_archive_id (archive_id),
    INDEX idx_data_source (data_source),
    INDEX idx_scale_id (scale_id),
    INDEX idx_scale_code (scale_code),
    INDEX idx_scale_category (scale_category),
    INDEX idx_status (status),
    INDEX idx_risk_level (risk_level),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='量表评估任务表';

-- 补充 ALTER 语句（如果表已存在，新增字段）
ALTER TABLE scale_tasks
    ADD COLUMN IF NOT EXISTS data_source_label VARCHAR(100) COMMENT '数据来源显示名称(如微博系列/BigData系列)';

-- 查询示例：获取任务及其量表完整信息
-- SELECT t.*, d.threshold, d.max_score, d.questions, d.interpretation
-- FROM scale_tasks t 
-- JOIN scale_definitions d ON t.scale_id = d.id
-- WHERE t.id = ?;
```

---

### 3.5 模型中心模块

#### 3.6.1 模型配置表 (models)

> **设计说明**: 管理 AI 模型配置，支持三大类模型：
> - **API模型**：云端大语言模型（腾讯云混元/阿里通义/OpenAI 等）
> - **本地LLM**：本地部署的大语言模型（Ollama / Transformers）
> - **检测模型**：内置自杀风险检测模型（FeaLearner / Emocc）

```sql
CREATE TABLE IF NOT EXISTS models (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    model_name VARCHAR(255) NOT NULL COMMENT '模型名称（如：混元-turbo、Llama3、FeaLearner-SIGIR）',
    model_code VARCHAR(100) NOT NULL UNIQUE COMMENT '模型代码（如：hunyuan-turbo、llama3、fealearner-sigir）',
    
    -- ============================================================
    -- 模型类型分类
    -- ============================================================
    model_category ENUM('api', 'local_llm', 'detection') NOT NULL COMMENT '模型大类：api(API模型)/local_llm(本地LLM)/detection(检测模型)',
    model_type ENUM(
        'api',           -- API模型：云端大语言模型
        'ollama',        -- 本地LLM：Ollama部署
        'transformers',  -- 本地LLM：Transformers/HuggingFace部署
        'fealearner',    -- 检测模型：FeaLearner文本情绪识别
        'emoji'          -- 检测模型：Emocc情绪表情模型
    ) NOT NULL COMMENT '模型类型：api(API)/ollama(Ollama)/transformers(Transformers)/fealearner(FeaLearner)/emoji(Emocc)',
    
    -- ============================================================
    -- API模型专用字段（model_category = api）
    -- ============================================================
    provider VARCHAR(100) COMMENT '提供商(腾讯云混元/阿里通义/OpenAI/DeepSeek/智谱AI/月之暗面等)',
    api_key VARCHAR(500) COMMENT 'API密钥(加密存储)',
    api_base_url VARCHAR(500) COMMENT 'API基础URL',
    config_template VARCHAR(50) COMMENT '配置模板(openai/zhipu/deepseek/dashscope/moonshot/hunyuan)',
    
    -- ============================================================
    -- 本地LLM专用字段（model_category = local_llm）
    -- ============================================================
    -- Ollama 部署方式
    ollama_model_name VARCHAR(255) COMMENT 'Ollama模型名（如：llama3、qwen2.5、mistral）',
    ollama_base_url VARCHAR(500) DEFAULT 'http://localhost:11434' COMMENT 'Ollama服务地址',
    
    -- Transformers 部署方式
    model_path VARCHAR(500) COMMENT 'Transformers模型路径/HuggingFace仓库ID',
    lora_path VARCHAR(500) COMMENT 'LoRA权重路径（可选）',
    
    -- ============================================================
    -- 检测模型专用字段（model_category = detection）
    -- ============================================================
    -- FeaLearner / Emocc 内置检测模型
    detection_type ENUM('fealearner', 'emoji') COMMENT '检测类型：fealearner(文本情绪)/emoji(表情情绪)',
    model_file_path VARCHAR(500) COMMENT '模型文件路径（如：data/models/fealearner/sigir.pkl）',
    embedding_file_path VARCHAR(500) COMMENT '嵌入文件路径（如：data/embeddings/sigir_emojis.csv）',
    supported_datasets JSON COMMENT '支持的数据集(JSON数组，如：["SIGIR","Weibo","Reddit","BigData"])',
    
    -- ============================================================
    -- 通用字段
    -- ============================================================
    description TEXT COMMENT '模型描述',
    version VARCHAR(50) COMMENT '模型版本',
    is_available BOOLEAN DEFAULT TRUE COMMENT '是否可用',
    is_default BOOLEAN DEFAULT FALSE COMMENT '是否默认模型',
    is_builtin BOOLEAN DEFAULT FALSE COMMENT '是否内置模型（系统预置不可删除）',
    performance_metrics JSON COMMENT '性能指标(JSON)：{"accuracy":0.92,"precision":0.89,"recall":0.85,"f1":0.87}',
    status ENUM('active', 'inactive', 'error') DEFAULT 'active' COMMENT '状态:active(正常)/inactive(禁用)/error(异常)',
    error_message TEXT COMMENT '错误信息',
    last_used_at DATETIME COMMENT '最后使用时间',
    usage_count INT DEFAULT 0 COMMENT '使用次数',
    avg_processing_time_ms INT COMMENT '平均处理时间(毫秒)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    INDEX idx_model_category (model_category),
    INDEX idx_model_type (model_type),
    INDEX idx_provider (provider),
    INDEX idx_detection_type (detection_type),
    INDEX idx_is_available (is_available),
    INDEX idx_is_default (is_default),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模型配置表';
```

#### 3.6.1.1 模型类型说明表

| model_category | model_type | 说明 | 必填字段 |
|---------------|------------|------|---------|
| **api** | api | 云端API大语言模型 | `provider`, `api_key`, `api_base_url`, `config_template` |
| **local_llm** | ollama | Ollama本地部署 | `ollama_model_name`, `ollama_base_url` |
| **local_llm** | transformers | Transformers本地部署 | `model_path`, `lora_path`(可选) |
| **detection** | fealearner | FeaLearner文本情绪检测 | `model_file_path`, `supported_datasets` |
| **detection** | emoji | Emocc表情情绪检测 | `model_file_path`, `embedding_file_path`, `supported_datasets` |

#### 3.6.1.2 内置检测模型配置示例

```sql
-- FeaLearner (SIGIR数据集训练)
INSERT INTO models (model_name, model_code, model_category, model_type, detection_type, model_file_path, supported_datasets, is_builtin, performance_metrics) VALUES
('FeaLearner-SIGIR', 'fealearner-sigir', 'detection', 'fealearner', 'fealearner', '/app/data/models/fealearner/sigir.pkl', '["SIGIR"]', TRUE, '{"accuracy":0.91,"precision":0.88,"recall":0.85,"f1":0.86}');

-- FeaLearner (Weibo数据集训练)
INSERT INTO models (model_name, model_code, model_category, model_type, detection_type, model_file_path, supported_datasets, is_builtin, performance_metrics) VALUES
('FeaLearner-Weibo', 'fealearner-weibo', 'detection', 'fealearner', 'fealearner', '/app/data/models/fealearner/weibo.pkl', '["Weibo"]', TRUE, '{"accuracy":0.89,"precision":0.86,"recall":0.83,"f1":0.84}');

-- Emocc 表情情绪模型 (SIGIR)
INSERT INTO models (model_name, model_code, model_category, model_type, detection_type, model_file_path, embedding_file_path, supported_datasets, is_builtin, performance_metrics) VALUES
('Emocc-SIGIR', 'emocc-sigir', 'detection', 'emoji', 'emoji', '/app/data/models/emoji_model/sigir.pkl', '/app/data/embeddings/sigir_emojis.csv', '["SIGIR"]', TRUE, '{"accuracy":0.87,"precision":0.84,"recall":0.81,"f1":0.82}');
```

#### 3.5.2 提示词模板表 (prompt_templates)

> **设计说明**: 管理提示词模板，参考 AgriKEVAS 指令模板表设计

```sql
CREATE TABLE IF NOT EXISTS prompt_templates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    name VARCHAR(255) NOT NULL COMMENT '模板名称',
    task_type VARCHAR(100) NOT NULL COMMENT '任务类型(自杀风险检测/抑郁筛查/焦虑检测等)',
    description TEXT COMMENT '模板描述',
    prompt_content TEXT NOT NULL COMMENT '提示词模板内容',
    variables JSON COMMENT '变量定义',
    model_id INT COMMENT '适用模型ID',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    usage_count INT DEFAULT 0 COMMENT '使用次数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE SET NULL,
    INDEX idx_name (name),
    INDEX idx_task_type (task_type),
    INDEX idx_model_id (model_id),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提示词模板表';
```

---

### 3.6 自杀风险检测模块

> **设计说明**: 自杀风险检测模块支持**单模型检测**和**多模型联合检测**两种模式，参考 RiskPage.tsx 前端实现。
>
> **单模型检测**：选择一个模型（API/本地LLM/检测模型）对用户进行风险检测
>
> **多模型联合检测**：先由多个检测模型（FeaLearner + Emocc）对用户文本进行风险检测，再由 API/本地LLM 对检测结果进行汇总对比、优势互补，增强异质性与评估全面性
>
> **检测模式**：
> - `single`: 单模型检测
> - `multi`: 多模型联合检测

#### 3.6.0 检测任务类型表 (detection_task_types)

> **设计说明**: 定义系统支持的检测任务类型（自杀风险、抑郁、焦虑、压力等）
>
> **核心用途**：
> - 统一管理系统支持的检测类型
> - 支持按类型查询和筛选任务
> - 关联对应的提示词模板

```sql
CREATE TABLE IF NOT EXISTS detection_task_types (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    type_code VARCHAR(50) NOT NULL UNIQUE COMMENT '类型代码（如：suicide/depression/anxiety/stress/comprehensive）',
    type_name VARCHAR(100) NOT NULL COMMENT '类型名称（如：自杀风险检测/抑郁筛查/焦虑检测/压力评估/综合评估）',
    description TEXT COMMENT '类型描述',
    icon VARCHAR(50) COMMENT '图标',
    color VARCHAR(20) DEFAULT '#1890ff' COMMENT '主题色',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_type_code (type_code),
    INDEX idx_sort_order (sort_order),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='检测任务类型表';

-- 初始化检测任务类型
INSERT INTO detection_task_types (type_code, type_name, description, sort_order) VALUES
('suicide', '自杀风险检测', '对用户进行自杀风险评估和检测', 1),
('depression', '抑郁筛查', '评估用户抑郁倾向和抑郁程度', 2),
('anxiety', '焦虑检测', '评估用户焦虑水平和焦虑症状', 3),
('stress', '压力评估', '评估用户压力水平和压力来源', 4),
('comprehensive', '综合评估', '综合心理健康评估', 5);
```

#### 3.6.1 风险检测任务主表 (risk_detection_tasks)

> **设计说明**: 存储风险检测任务的核心信息，用于管理单模型和多模型联合检测任务
>
> **核心用途**：
> - 记录风险检测任务从创建到完成的完整生命周期
> - 支持多种检测类型（自杀风险、抑郁、焦虑、压力等）
> - 支持单模型检测和多模型联合检测
>
> **任务模式**：
> - `single`: 单模型检测 - 选择一个模型（API/本地LLM/检测模型）对用户进行风险检测
> - `multi`: 多模型联合检测 - 先由多个检测模型（FeaLearner + Emocc）对用户文本进行风险检测，再由 API/本地LLM 对检测结果进行汇总对比、增强异质性
>
> **任务状态 (`status`)**：
> - `pending` → `running` → `completed` / `failed` / `cancelled`

```sql
CREATE TABLE IF NOT EXISTS risk_detection_tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    task_code VARCHAR(100) UNIQUE COMMENT '任务编号（唯一标识）',
    task_name VARCHAR(255) NOT NULL COMMENT '任务名称',
    task_description TEXT COMMENT '任务描述/备注',

    -- 任务模式与类型
    task_mode ENUM('single', 'multi') NOT NULL COMMENT '任务模式(single单模型/multi多模型)',
    task_type_id INT NOT NULL COMMENT '检测任务类型ID（关联 detection_task_types.id）',

    -- 数据源关联
    archive_id BIGINT COMMENT '关联档案ID（psychological_archives.id）',
    user_hash VARCHAR(64) NOT NULL COMMENT '脱敏用户标识',
    data_source VARCHAR(50) NOT NULL COMMENT '数据来源(weibo/bigdata/reddit/sigir)',
    post_count INT DEFAULT 0 COMMENT '检测的贴文数量',

    -- ==================== 单模型配置 ====================
    -- 当 task_mode='single' 时使用
    -- 关联到 models 表获取完整模型信息
    single_model_id BIGINT COMMENT '单模型ID（关联 models.id）',
    single_prompt_template_id BIGINT COMMENT '单模型提示词模板ID',
    -- 单模型执行参数（覆盖模型默认值）
    single_model_params JSON COMMENT '单模型执行参数（如 API模型的 temperature/maxTokens 或 检测模型的 confidenceThreshold/batchSize）',

    -- ==================== 多模型配置 ====================
    -- 当 task_mode='multi' 时使用
    -- 第一步：检测模型配置（至少2个）
    -- 关联到 models 表获取检测模型信息
    detection_model_configs JSON COMMENT '检测模型配置列表 JSON数组（每个元素包含 model_id 和 params，如 [{"modelId": 1, "params": {"confidenceThreshold": 0.5, "batchSize": 32}}]）',

    -- 第二步：融合模型配置（API或本地LLM）
    -- 关联到 models 表获取融合模型信息
    fusion_model_id BIGINT COMMENT '融合模型ID（关联 models.id）',
    fusion_prompt_template_id BIGINT COMMENT '融合模型提示词模板ID',
    -- 融合模型执行参数
    fusion_model_params JSON COMMENT '融合模型执行参数（如 {"temperature": 0.7, "maxTokens": 2048, "topP": 0.9}）',

    -- ==================== 执行状态与进度 ====================
    progress INT DEFAULT 0 COMMENT '整体进度(0-100)',
    status ENUM('pending', 'running', 'completed', 'failed', 'cancelled') DEFAULT 'pending' COMMENT '任务状态',

    -- 执行时间跟踪
    started_at DATETIME COMMENT '实际开始时间',
    completed_at DATETIME COMMENT '完成时间',
    processing_time_ms INT COMMENT '处理耗时(毫秒)',

    -- ==================== 检测模型子任务状态 ====================
    -- 用于多模型任务的阶段性进度跟踪
    detection_progress INT DEFAULT 0 COMMENT '检测模型阶段进度(0-100)',
    fusion_progress INT DEFAULT 0 COMMENT '融合模型阶段进度(0-100)',
    detection_status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending' COMMENT '检测模型阶段状态',
    fusion_status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending' COMMENT '融合模型阶段状态',

    -- ==================== 错误处理 ====================
    error_message TEXT COMMENT '错误信息',

    -- ==================== 结果摘要 ====================
    -- 单用户检测的最终结果
    result_summary JSON COMMENT '结果摘要 JSON（包含 riskLevel/riskScore/confidence/summary/features）',
    -- result_summary JSON 结构示例：
    -- {
    --   "riskLevel": "high",          // 低/中/高风险
    --   "riskScore": 0.87,            // 风险分数 0-1
    --   "confidence": 92,              // 置信度 0-100
    --   "summary": "用户表现出明显的...", // 综合评估摘要
    --   "features": [                  // 检测到的特征列表（中文标签）
    --     "负面情绪表达",
    --     "自残倾向暗示",
    --     "社交退缩行为",
    --     "生活无望感"
    --   ],
    --   "featureScores": {             // 各特征置信度（可选）
    --     "负面情绪表达": 0.95,
    --     "自残倾向暗示": 0.82
    --   }
    -- }

    -- 时间戳
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 外键
    FOREIGN KEY (task_type_id) REFERENCES detection_task_types(id) ON DELETE RESTRICT COMMENT '关联检测任务类型',
    FOREIGN KEY (archive_id) REFERENCES psychological_archives(id) ON DELETE SET NULL,
    FOREIGN KEY (single_model_id) REFERENCES models(id) ON DELETE SET NULL COMMENT '关联 models 表获取单模型信息',
    FOREIGN KEY (single_prompt_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL,
    FOREIGN KEY (fusion_model_id) REFERENCES models(id) ON DELETE SET NULL COMMENT '关联 models 表获取融合模型信息',
    FOREIGN KEY (fusion_prompt_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL,

    -- 索引
    INDEX idx_task_code (task_code),
    INDEX idx_task_mode (task_mode),
    INDEX idx_task_type_id (task_type_id),
    INDEX idx_archive_id (archive_id),
    INDEX idx_user_hash (user_hash),
    INDEX idx_data_source (data_source),
    INDEX idx_single_model_id (single_model_id),
    INDEX idx_fusion_model_id (fusion_model_id),
    INDEX idx_status (status),
    INDEX idx_fusion_status (fusion_status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风险检测任务主表';
```

#### 3.6.2 检测子任务表 (risk_detection_sub_tasks)

> **设计说明**: 存储多模型联合检测中每个检测模型的独立检测结果
> - 一个多模型任务对应多个子任务（每个检测模型一个）
> - 用于展示各检测模型的独立分析结果
> - `model_id` 关联到 `models` 表获取完整的模型信息

```sql
CREATE TABLE IF NOT EXISTS risk_detection_sub_tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    task_id BIGINT NOT NULL COMMENT '关联任务ID',
    model_id BIGINT NOT NULL COMMENT '模型ID（关联 models.id）',

    -- 执行状态
    status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending' COMMENT '子任务状态',
    progress INT DEFAULT 0 COMMENT '子任务进度(0-100)',
    error_message TEXT COMMENT '错误信息',
    started_at DATETIME COMMENT '开始时间',
    completed_at DATETIME COMMENT '完成时间',

    -- 检测结果
    result JSON COMMENT '检测结果 JSON（如 {"riskLevel": "high", "riskScore": 0.87, "confidence": 92, "features": ["负面情绪", "自残倾向"]}）',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    FOREIGN KEY (task_id) REFERENCES risk_detection_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE COMMENT '关联 models 表获取模型信息',
    INDEX idx_task_id (task_id),
    INDEX idx_model_id (model_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='检测子任务表（存储多模型中每个检测模型的独立结果）';
```

#### 3.6.3 融合评估记录表 (risk_detection_fusion_records)

> **设计说明**: 存储融合模型对多个检测模型结果的综合评估
> - 多模型联合检测中，融合模型对各检测模型结果进行汇总
> - 记录融合模型的输入（各检测模型结果）和输出（综合评估）
> - `fusion_model_id` 关联到 `models` 表获取完整的融合模型信息

```sql
CREATE TABLE IF NOT EXISTS risk_detection_fusion_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    task_id BIGINT NOT NULL COMMENT '关联任务ID',
    fusion_model_id BIGINT NOT NULL COMMENT '融合模型ID（关联 models.id）',

    -- 融合输入：各检测模型的子任务ID
    sub_task_ids JSON COMMENT '参与融合的子任务ID列表',

    -- 融合配置
    prompt_template_id BIGINT COMMENT '使用的提示词模板ID',
    prompt_content TEXT COMMENT '实际使用的提示词内容',
    fusion_params JSON COMMENT '融合模型参数（如 temperature/maxTokens/topP）',

    -- 融合状态
    status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending' COMMENT '融合状态',
    started_at DATETIME COMMENT '开始时间',
    completed_at DATETIME COMMENT '完成时间',
    processing_time_ms INT COMMENT '处理耗时(毫秒)',

    -- 融合输入摘要
    input_summary JSON COMMENT '融合输入摘要（各检测模型的简要结果）',

    -- 融合输出结果
    output_result JSON COMMENT '融合输出结果 JSON',
    output_text TEXT COMMENT '融合模型的原始文本输出',

    -- 最终综合结果（从融合输出中提取）
    fused_risk_level ENUM('low', 'medium', 'high') COMMENT '综合风险等级',
    fused_risk_score DECIMAL(5, 4) COMMENT '综合风险分数(0-1)',
    confidence INT COMMENT '置信度(0-100)',
    summary TEXT COMMENT '综合评估摘要',
    model_highlights JSON COMMENT '模型亮点 JSON数组（如 ["FeaLearner检测到...", "Emocc情绪分析显示..."]）',

    -- 错误处理
    error_message TEXT COMMENT '错误信息',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    FOREIGN KEY (task_id) REFERENCES risk_detection_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (fusion_model_id) REFERENCES models(id) ON DELETE CASCADE COMMENT '关联 models 表获取融合模型信息',
    FOREIGN KEY (prompt_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL,
    INDEX idx_task_id (task_id),
    INDEX idx_fusion_model_id (fusion_model_id),
    INDEX idx_status (status),
    INDEX idx_fused_risk_level (fused_risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='融合评估记录表（存储LLM对多模型结果的综合评估）';
```

#### 3.6.4 风险检测历史表 (risk_detection_history)

> **设计说明**: 存储每次检测的详细历史记录，用于：
> - 同一用户的多次检测历史追踪
> - 模型性能对比分析
> - 风险变化趋势分析

```sql
CREATE TABLE IF NOT EXISTS risk_detection_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    task_id BIGINT NOT NULL COMMENT '关联任务ID',
    archive_id BIGINT COMMENT '关联档案ID',
    user_hash VARCHAR(64) NOT NULL COMMENT '脱敏用户标识',

    -- 检测模式
    task_mode ENUM('single', 'multi') NOT NULL COMMENT '检测模式',

    -- 使用的模型信息
    model_ids JSON COMMENT '使用的模型ID列表',
    model_names JSON COMMENT '使用的模型名称列表（用于历史展示）',

    -- 结果信息
    risk_level ENUM('low', 'medium', 'high') COMMENT '风险等级',
    risk_score DECIMAL(5, 4) COMMENT '风险分数(0-1)',
    confidence INT COMMENT '置信度(0-100)',
    features JSON COMMENT '检测到的特征列表',

    -- 时间信息
    detection_time DATETIME NOT NULL COMMENT '检测时间',
    data_source VARCHAR(50) COMMENT '数据来源',

    -- 用于趋势分析
    previous_risk_level ENUM('low', 'medium', 'high') COMMENT '上次检测风险等级',
    risk_change ENUM('increased', 'decreased', 'stable') COMMENT '风险变化趋势',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    FOREIGN KEY (task_id) REFERENCES risk_detection_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (archive_id) REFERENCES psychological_archives(id) ON DELETE SET NULL,
    INDEX idx_user_hash (user_hash),
    INDEX idx_archive_id (archive_id),
    INDEX idx_detection_time (detection_time),
    INDEX idx_risk_level (risk_level),
    INDEX idx_risk_change (risk_change)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风险检测历史表（用于趋势分析和历史追踪）';
```

#### 3.6.5 表结构 ER 图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    自杀风险检测模块 ER 关系图                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │          detection_task_types (检测任务类型表)                        │   │
│  │  • type_code: suicide/depression/anxiety/stress/comprehensive       │   │
│  │  • type_name: 自杀风险检测/抑郁筛查/焦虑检测/压力评估/综合评估        │   │
│  └─────────────────────────────┬────────────────────────────────────┘   │
│                                │                                        │
│                                ▼                                        │
│                         ┌───────────────────────┐                      │
│                         │   models (模型配置表)   │                      │
│                         │  • model_name         │                      │
│                         │  • model_category     │                      │
│                         │  • model_type        │                      │
│                         └───────────┬───────────┘                      │
│                                     │                                  │
│         ┌───────────────────────────┼───────────────────────────┐       │
│         │                           │                           │       │
│         ▼                           ▼                           ▼       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              risk_detection_tasks (任务主表)                      │   │
│  │  • task_mode: single/multi                                      │   │
│  │  • task_type_id → 检测类型（自杀风险/抑郁/焦虑/压力等）          │   │
│  │  • 进度跟踪: progress/detection_progress/fusion_progress         │   │
│  │  • 结果摘要: result_summary                                      │   │
│  │                                                                  │   │
│  │  外键关联:                                                       │   │
│  │  • task_type_id ─────────────────▶ detection_task_types.id       │   │
│  │  • single_model_id ───────────────▶ models.id (单模型)           │   │
│  │  • fusion_model_id ───────────────▶ models.id (融合模型)         │   │
│  │  • single_prompt_template_id ─────▶ prompt_templates.id         │   │
│  │  • fusion_prompt_template_id ─────▶ prompt_templates.id         │   │
│  └────────┬─────────────────────────┬────────────────────────┬────────┘   │
│           │                         │                        │            │
│           ▼                         ▼                        │            │
│  ┌───────────────────────────────┐   ┌──────────────────────┐            │
│  │ risk_detection_sub_tasks     │   │ risk_detection_      │            │
│  │ (检测子任务表)               │   │ fusion_records       │            │
│  │                             │   │ (融合评估记录表)     │            │
│  │ • 每个检测模型的独立结果     │   │                      │            │
│  │ • FeaLearner 结果          │   │ • 融合模型综合评估   │            │
│  │ • Emocc 结果               │   │ • LLM 输入输出       │            │
│  │                             │   │ • 综合风险等级/分数   │            │
│  │ 外键:                        │   │                      │            │
│  │ • model_id ────────────────▶│   │ 外键:                │            │
│  │   models.id (检测模型)       │   │ • fusion_model_id ──▶│            │
│  └─────────────────────────────┘   │   models.id           │            │
│                                    │ • prompt_template_id─▶│            │
│                                    │   prompt_templates   │            │
│                                    └──────────────────────┘            │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              risk_detection_history (历史表)                        │   │
│  │  • 用户检测历史记录                                               │   │
│  │  • 风险变化趋势追踪                                               │   │
│  │  • 模型性能对比分析                                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                 prompt_templates (提示词模板表)                     │   │
│  │  • name: 模板名称                                                │   │
│  │  • prompt_content: 提示词内容                                    │   │
│  │  • model_id ──────────────▶ models.id (适用模型)                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**外键关系汇总**：

| 表 | 外键字段 | 关联到 | 说明 |
|---|---------|-------|------|
| risk_detection_tasks | task_type_id | detection_task_types.id | 检测任务类型 |
| risk_detection_tasks | single_model_id | models.id | 单模型 |
| risk_detection_tasks | fusion_model_id | models.id | 融合模型 |
| risk_detection_tasks | single_prompt_template_id | prompt_templates.id | 单模型提示词 |
| risk_detection_tasks | fusion_prompt_template_id | prompt_templates.id | 融合模型提示词 |
| risk_detection_sub_tasks | model_id | models.id | 检测模型 |
| risk_detection_fusion_records | fusion_model_id | models.id | 融合模型 |
| risk_detection_fusion_records | prompt_template_id | prompt_templates.id | 提示词模板 |
| prompt_templates | model_id | models.id | 适用模型 |

#### 3.6.6 风险检测前端字段与数据库字段对照表

> **说明**：以下表格完整对应前端 RiskPage.tsx 的前端类型与数据库字段映射。

**前端筛选条件与数据库字段对照**：

| 前端常量 | 前端筛选项值 | 数据库字段 | 表名 | 说明 |
|---------|-------------|-----------|------|------|
| TASK_TYPES | `suicide` | type_code = 'suicide' | detection_task_types | 自杀风险检测 |
| TASK_TYPES | `depression` | type_code = 'depression' | detection_task_types | 抑郁筛查 |
| TASK_TYPES | `anxiety` | type_code = 'anxiety' | detection_task_types | 焦虑检测 |
| TASK_TYPES | `stress` | type_code = 'stress' | detection_task_types | 压力评估 |
| TASK_TYPES | `comprehensive` | type_code = 'comprehensive' | detection_task_types | 综合评估 |
| TASK_STATUS | `pending` | status = 'pending' | risk_detection_tasks | 待执行 |
| TASK_STATUS | `running` | status = 'running' | risk_detection_tasks | 进行中 |
| TASK_STATUS | `completed` | status = 'completed' | risk_detection_tasks | 已完成 |
| TASK_STATUS | `failed` | status = 'failed' | risk_detection_tasks | 失败 |
| TASK_STATUS | `cancelled` | status = 'cancelled' | risk_detection_tasks | 已取消 |
| RISK_COLORS | `low` | risk_level = 'low' | risk_detection_history | 低风险 |
| RISK_COLORS | `medium` | risk_level = 'medium' | risk_detection_history | 中风险 |
| RISK_COLORS | `high` | risk_level = 'high' | risk_detection_history | 高风险 |
| DATA_SOURCE_LABELS | `weibo` → 微博系列 | data_source = 'weibo' | risk_detection_tasks | 数据来源 |
| DATA_SOURCE_LABELS | `bigdata` → BigData系列 | data_source = 'bigdata' | risk_detection_tasks | 数据来源 |
| DATA_SOURCE_LABELS | `reddit` → Reddit系列 | data_source = 'reddit' | risk_detection_tasks | 数据来源 |
| DATA_SOURCE_LABELS | `sigir` → SIGIR系列 | data_source = 'sigir' | risk_detection_tasks | 数据来源 |
| ALL_MODELS | `api` → API模型 | model_type = 'api' | models | API模型 |
| ALL_MODELS | `ollama` → 本地LLM(Ollama) | model_type = 'ollama' | models | 本地Ollama |
| ALL_MODELS | `weight_llm` → 本地LLM(加载权重) | model_type = 'weight_llm' | models | 权重加载 |
| ALL_MODELS | `FeaLearner` → 检测模型 | model_name LIKE '%FeaLearner%' | models | FeaLearner检测模型 |
| ALL_MODELS | `Emocc` → 情绪表情模型 | model_name LIKE '%Emocc%' | models | Emocc情绪模型 |

**DetectionTask (单模型任务) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | risk_detection_tasks | 任务ID |
| name | task_name | risk_detection_tasks | 任务名称 |
| taskType | type_code | risk_detection_tasks LEFT JOIN detection_task_types ON task_type_id = detection_task_types.id | 检测类型代码 |
| taskTypeName | type_name | 同上 | 检测类型名称 |
| dataSource | data_source | risk_detection_tasks | 数据来源 |
| model | model_name | risk_detection_tasks LEFT JOIN models ON single_model_id = models.id | 模型名称（外键关联） |
| modelType | model_type | 同上 | 模型类型 (api/ollama/weight) |
| modelParams | single_model_params | risk_detection_tasks | 单模型执行参数 JSON |
| status | status | risk_detection_tasks | 状态 |
| progress | progress | risk_detection_tasks | 进度 (0-100) |
| result | result_summary | risk_detection_tasks | 结果 JSON |
| result.riskLevel | result_summary -> '$.riskLevel' | risk_detection_tasks | 风险等级 |
| result.riskScore | result_summary -> '$.riskScore' | risk_detection_tasks | 风险分数 |
| result.confidence | result_summary -> '$.confidence' | risk_detection_tasks | 置信度 |
| result.features | result_summary -> '$.features' | risk_detection_tasks | 特征数组 |
| createTime | created_at | risk_detection_tasks | 创建时间 |
| completedTime | completed_at | risk_detection_tasks | 完成时间 |
| userId | user_hash | risk_detection_tasks | 用户标识 |
| postCount | post_count | risk_detection_tasks | 贴文数量 |
| description | task_description | risk_detection_tasks | 任务描述 |

**MultiModelTask (多模型任务) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | risk_detection_tasks | 任务ID |
| name | task_name | risk_detection_tasks | 任务名称 |
| taskType | type_code | risk_detection_tasks LEFT JOIN detection_task_types | 检测类型代码 |
| taskTypeName | type_name | 同上 | 检测类型名称 |
| description | task_description | risk_detection_tasks | 任务描述 |
| userId | user_hash | risk_detection_tasks | 用户标识 |
| dataSource | data_source | risk_detection_tasks | 数据来源 |
| detectionModels | JSON_EXTRACT(detection_model_configs, '$[*].modelName') | risk_detection_tasks | 检测模型名称列表 |
| detectionModels | JSON_EXTRACT(detection_model_configs, '$[*].modelId') | risk_detection_tasks | 检测模型ID列表 |
| detectionModelCategory | - | 前端固定 'detection' | - |
| apiModel | model_name | risk_detection_tasks LEFT JOIN models ON fusion_model_id = models.id | 融合模型名称 |
| apiModelCategory | model_category | 同上 | 模型分类 (api/llm) |
| promptTemplateId | fusion_prompt_template_id | risk_detection_tasks | 提示词模板ID |
| promptTemplateName | name | risk_detection_tasks LEFT JOIN prompt_templates ON fusion_prompt_template_id = prompt_templates.id | 提示词名称 |
| modelParams | fusion_model_params | risk_detection_tasks | 融合模型执行参数 |
| modelParams.temperature | JSON_EXTRACT(fusion_model_params, '$.temperature') | - | 温度参数 |
| modelParams.maxTokens | JSON_EXTRACT(fusion_model_params, '$.maxTokens') | - | 最大Token数 |
| modelParams.topP | JSON_EXTRACT(fusion_model_params, '$.topP') | - | Top-P参数 |
| modelParams.confidenceThreshold | JSON_EXTRACT(fusion_model_params, '$.confidenceThreshold') | - | 置信度阈值 |
| modelParams.batchSize | JSON_EXTRACT(fusion_model_params, '$.batchSize') | - | 批处理大小 |
| status | status | risk_detection_tasks | 任务状态 |
| result | result_summary | risk_detection_tasks | 结果 JSON |
| result.fusedRiskLevel | result_summary -> '$.riskLevel' | risk_detection_tasks | 综合风险等级 |
| result.fusedRiskScore | result_summary -> '$.riskScore' | risk_detection_tasks | 综合风险分数 |
| result.confidence | result_summary -> '$.confidence' | risk_detection_tasks | 置信度 |
| result.summary | result_summary -> '$.summary' | risk_detection_tasks | 综合摘要 |
| result.modelHighlights | result_summary -> '$.features' | risk_detection_tasks | 模型亮点 |
| createTime | created_at | risk_detection_tasks | 创建时间 |
| completedTime | completed_at | risk_detection_tasks | 完成时间 |

**多模型子任务结果 (MultiModelTask.result.modelResults) 前端类型**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| modelId | model_id | risk_detection_sub_tasks | 模型ID（外键关联） |
| modelName | model_name | risk_detection_sub_tasks LEFT JOIN models ON model_id = models.id | 模型名称 |
| modelType | model_type | 同上 | 模型类型 |
| status | status | risk_detection_sub_tasks | 子任务状态 |
| progress | progress | risk_detection_sub_tasks | 子任务进度 |
| result | result | risk_detection_sub_tasks | 独立检测结果 JSON |
| result.riskLevel | JSON_EXTRACT(result, '$.riskLevel') | risk_detection_sub_tasks | 风险等级 |
| result.riskScore | JSON_EXTRACT(result, '$.riskScore') | risk_detection_sub_tasks | 风险分数 |
| result.confidence | JSON_EXTRACT(result, '$.confidence') | risk_detection_sub_tasks | 置信度 |
| result.features | JSON_EXTRACT(result, '$.features') | risk_detection_sub_tasks | 特征列表 |

**detection_model_configs JSON 字段格式示例**：

```json
// detection_model_configs 存储格式
[
  {
    "modelId": 1,
    "modelName": "FeaLearner-SIGIR",
    "params": {
      "confidenceThreshold": 0.5,
      "batchSize": 32
    }
  },
  {
    "modelId": 2,
    "modelName": "Emocc-SIGIR",
    "params": {
      "confidenceThreshold": 0.5,
      "batchSize": 32
    }
  }
]
```

**fusion_model_params JSON 字段格式示例**：

```json
// fusion_model_params 存储格式
{
  "temperature": 0.7,
  "maxTokens": 2048,
  "topP": 0.9,
  "confidenceThreshold": 0.5,
  "batchSize": 32
}
```

---

### 3.7 知识库模块

#### 3.7.1 知识主题表 (knowledge_topics)

> **设计说明**: 知识库主题分类，参考 AgriKEVAS 主题表设计

```sql
CREATE TABLE IF NOT EXISTS knowledge_topics (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    topic_name VARCHAR(255) NOT NULL COMMENT '主题名称',
    topic_code VARCHAR(50) NOT NULL UNIQUE COMMENT '主题代码',
    description TEXT COMMENT '主题描述',
    icon VARCHAR(50) COMMENT '图标',
    color VARCHAR(20) DEFAULT '#C19A83' COMMENT '主题色',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_topic_code (topic_code),
    INDEX idx_sort_order (sort_order),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识主题表';

-- 初始化知识主题
INSERT INTO knowledge_topics (topic_name, topic_code, description, sort_order) VALUES
('自杀与自伤', 'suicide_self_harm', '自杀预防、自伤行为相关内容', 1),
('抑郁', 'depression', '抑郁症相关知识', 2),
('焦虑', 'anxiety', '焦虑障碍相关内容', 3),
('危机干预', 'crisis_intervention', '危机干预热线与现场处理', 4),
('情绪', 'emotion', '情绪识别与调节', 5),
('睡眠与生理', 'sleep_physiology', '睡眠与生理健康', 6),
('量表与筛查', 'scale_screening', '心理量表使用指南', 7);
```

#### 3.7.2 知识子主题表 (knowledge_sub_topics)

> **设计说明**: 知识库子主题分类

```sql
CREATE TABLE IF NOT EXISTS knowledge_sub_topics (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    topic_id INT NOT NULL COMMENT '关联主题ID',
    sub_topic_name VARCHAR(255) NOT NULL COMMENT '子主题名称',
    sub_topic_code VARCHAR(50) NOT NULL COMMENT '子主题代码',
    description TEXT COMMENT '子主题描述',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    FOREIGN KEY (topic_id) REFERENCES knowledge_topics(id) ON DELETE CASCADE,
    INDEX idx_topic_id (topic_id),
    INDEX idx_sub_topic_code (sub_topic_code),
    INDEX idx_sort_order (sort_order),
    UNIQUE KEY uk_topic_sub (topic_id, sub_topic_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识子主题表';

-- 初始化子主题
INSERT INTO knowledge_sub_topics (topic_id, sub_topic_name, sub_topic_code, description, sort_order) VALUES
-- 自杀与自伤
(1, '自杀预防与教育', 'prevention_education', '自杀预防基础知识', 1),
(1, '自伤与自残', 'self_injury', '自伤行为识别与处理', 2),
(1, '危机表达与手段', 'crisis_expression', '危机表达方式识别', 3),
(1, '求助与转介', 'help_referral', '求助途径与转介流程', 4),
-- 抑郁
(2, '抑郁症状与评估', 'symptoms_assessment', '抑郁症状识别与评估', 1),
(2, '抑郁与自杀风险', 'depression_risk', '抑郁与自杀风险关系', 2),
(2, '治疗与药物', 'treatment_medication', '治疗方法与药物', 3),
(2, '量表说明', 'scale_guide', '抑郁量表使用说明', 4),
-- 焦虑
(3, '广泛性焦虑与识别', 'gad_recognition', '广泛性焦虑障碍识别', 1),
(3, '焦虑与睡眠', 'anxiety_sleep', '焦虑与睡眠问题', 2),
(3, '应对策略', 'coping_strategies', '焦虑应对策略', 3),
-- 危机干预
(4, '热线与即时求助', 'hotlines', '心理援助热线', 1),
(4, '现场干预要点', '现场干预', '现场危机干预要点', 2),
(4, '事后干预与随访', 'aftercare', '事后干预与随访', 3),
-- 情绪
(5, '情绪识别与表达', 'emotion_recognition', '情绪识别与表达', 1),
(5, '负面情绪与风险', 'negative_emotion_risk', '负面情绪与风险', 2),
(5, '情绪调节', 'emotion_regulation', '情绪调节方法', 3),
-- 睡眠与生理
(6, '失眠与心理', 'insomnia', '失眠与心理健康', 1),
(6, '安眠药与副作用', 'sleep_medication', '安眠药使用与副作用', 2),
(6, '生理指标与睡眠', 'physiology_sleep', '生理指标与睡眠', 3),
-- 量表与筛查
(7, 'PHQ-9说明与解读', 'phq9_guide', 'PHQ-9量表使用指南', 1),
(7, 'SAS_SDS_MINI等', 'other_scales', '其他抑郁焦虑量表', 2),
(7, 'C-SSRS等危机量表', 'crisis_scales', '危机评估量表', 3),
-- 干预与求助资源
(8, '心理机构与医院', 'institutions', '心理机构与医院', 1),
(8, '心理援助热线', 'hotlines_resources', '心理援助热线汇总', 2),
(8, '公益与社区资源', 'community_resources', '公益与社区资源', 3);
```

#### 3.7.3 知识文档表 (knowledge_documents)

> **设计说明**: 知识库文档管理，参考 AgriKEVAS 农业文档表设计

```sql
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    title VARCHAR(255) NOT NULL COMMENT '文档标题',
    topic_id INT COMMENT '关联主题ID',
    sub_topic_id INT COMMENT '关联子主题ID',
    keywords JSON COMMENT '关键词(JSON数组)',
    format ENUM('pdf', 'docx', 'txt', 'md') NOT NULL COMMENT '文档格式',
    file_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
    file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
    file_size BIGINT DEFAULT 0 COMMENT '文件大小(字节)',
    size_display VARCHAR(20) COMMENT '显示大小(如 2.3 MB)',
    description TEXT COMMENT '文档描述',
    rag_path VARCHAR(500) COMMENT 'RAG知识库路径',
    upload_status ENUM('uploading', 'uploaded', 'failed') DEFAULT 'uploading' COMMENT '上传状态',
    progress INT DEFAULT 0 COMMENT '处理进度(0-100)',
    is_indexed BOOLEAN DEFAULT FALSE COMMENT '是否已索引',
    usage_count INT DEFAULT 0 COMMENT '查阅次数',
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    FOREIGN KEY (topic_id) REFERENCES knowledge_topics(id) ON DELETE SET NULL,
    FOREIGN KEY (sub_topic_id) REFERENCES knowledge_sub_topics(id) ON DELETE SET NULL,
    INDEX idx_topic_id (topic_id),
    INDEX idx_sub_topic_id (sub_topic_id),
    INDEX idx_format (format),
    INDEX idx_upload_status (upload_status),
    INDEX idx_is_indexed (is_indexed),
    INDEX idx_uploaded_at (uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识文档表';
```

#### 3.7.4 知识文档关键词表 (knowledge_document_keywords)

> **设计说明**: 单独存储文档关键词，支持全文搜索和标签聚合

```sql
CREATE TABLE IF NOT EXISTS knowledge_document_keywords (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    document_id BIGINT NOT NULL COMMENT '关联文档ID',
    keyword VARCHAR(100) NOT NULL COMMENT '关键词',
    weight DECIMAL(3, 2) DEFAULT 1.00 COMMENT '权重(0-1)',
    is_auto_extracted BOOLEAN DEFAULT FALSE COMMENT '是否自动提取',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    INDEX idx_document_id (document_id),
    INDEX idx_keyword (keyword),
    UNIQUE KEY uk_doc_keyword (document_id, keyword)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识文档关键词表';
```

#### 3.7.5 知识文档版本表 (knowledge_document_versions)

> **设计说明**: 支持文档版本管理，记录文档的历史版本

```sql
CREATE TABLE IF NOT EXISTS knowledge_document_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    document_id BIGINT NOT NULL COMMENT '关联文档ID',
    version_number INT NOT NULL COMMENT '版本号',
    file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
    file_size BIGINT DEFAULT 0 COMMENT '文件大小(字节)',
    change_summary TEXT COMMENT '变更说明',
    uploaded_by VARCHAR(100) COMMENT '上传者',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    INDEX idx_document_id (document_id),
    INDEX idx_version_number (version_number),
    UNIQUE KEY uk_doc_version (document_id, version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识文档版本表';
```

---

### 3.8 智能问答模块（ChatPage）

> **设计说明**: 支持 AI 智能问答功能，包含对话会话管理、消息记录、文档引用、RAG 上下文等。对应前端 `ChatPage.tsx`。

#### 3.8.1 对话会话表 (chat_sessions)

> **设计说明**: 记录每个对话会话的基本信息，支持多种 AI 模式

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    session_code VARCHAR(100) UNIQUE COMMENT '会话编号（如 SESSION-20260327-001）',
    -- 用户信息（可选，可用于关联档案）
    user_id BIGINT COMMENT '关联用户ID（可选）',
    user_hash VARCHAR(64) COMMENT '脱敏用户标识（可选）',
    archive_id BIGINT COMMENT '关联档案ID（可选，用于上下文带入）',
    data_source VARCHAR(50) COMMENT '数据来源（weibo/bigdata/reddit/sigir）',
    -- 会话配置
    ai_mode ENUM('deep_think', 'risk_assessment', 'intervention', 'scale_interpret') DEFAULT 'deep_think' COMMENT 'AI模式：deep_think(深度思考)/risk_assessment(风险评估)/intervention(干预建议)/scale_interpret(量表解读)',
    context_type ENUM('general', 'knowledge_base', 'archive', 'scale') DEFAULT 'general' COMMENT '上下文类型：general(通用)/knowledge_base(知识库)/archive(档案)/scale(量表)',
    -- 知识库配置
    knowledge_sources JSON COMMENT '知识库来源(JSON数组，如：["量表知识库","心理健康指南"])',
    rag_keywords JSON COMMENT 'RAG检索关键词(JSON数组)',
    -- 会话统计
    message_count INT DEFAULT 0 COMMENT '消息数量',
    total_tokens INT DEFAULT 0 COMMENT '总Token数',
    -- 会话状态
    status ENUM('active', 'archived', 'deleted') DEFAULT 'active' COMMENT '状态：active(活跃)/archived(归档)/deleted(已删除)',
    is_pinned BOOLEAN DEFAULT FALSE COMMENT '是否置顶',
    -- 时间
    last_message_at DATETIME COMMENT '最后消息时间',
    last_ai_response_at DATETIME COMMENT '最后AI回复时间',
    archived_at DATETIME COMMENT '归档时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_session_code (session_code),
    INDEX idx_user_id (user_id),
    INDEX idx_user_hash (user_hash),
    INDEX idx_archive_id (archive_id),
    INDEX idx_data_source (data_source),
    INDEX idx_ai_mode (ai_mode),
    INDEX idx_context_type (context_type),
    INDEX idx_status (status),
    INDEX idx_is_pinned (is_pinned),
    INDEX idx_last_message_at (last_message_at),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话表';
```

> **AI 模式说明**:
>
> | ai_mode | 前端显示 | 说明 |
> |---------|---------|------|
> | `deep_think` | 深度思考 | 深度分析问题，提供全面解答 |
> | `risk_assessment` | 风险评估 | 结合档案进行自杀风险评估 |
> | `intervention` | 干预建议 | 提供危机干预建议和资源 |
> | `scale_interpret` | 量表解读 | 解读量表结果，提供建议 |

#### 3.8.2 对话消息表 (chat_messages)

> **设计说明**: 记录每条对话消息，支持用户消息、AI回复、附件等

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    session_id BIGINT NOT NULL COMMENT '关联会话ID',
    -- 消息内容
    role ENUM('user', 'ai', 'system') NOT NULL COMMENT '角色：user(用户)/ai(AI)/system(系统)',
    content TEXT NOT NULL COMMENT '消息内容',
    content_type ENUM('text', 'html', 'markdown') DEFAULT 'text' COMMENT '内容类型',
    -- 多模态支持
    attachments JSON COMMENT '附件列表(JSON数组：[{"type":"image/file","name":"","url":""}]',
    has_image BOOLEAN DEFAULT FALSE COMMENT '是否包含图片',
    has_file BOOLEAN DEFAULT FALSE COMMENT '是否包含文件',
    -- AI 响应信息
    ai_model VARCHAR(100) COMMENT '使用的AI模型',
    ai_mode ENUM('deep_think', 'risk_assessment', 'intervention', 'scale_interpret') COMMENT 'AI模式',
    tokens_used INT COMMENT '本次使用Token数',
    processing_time_ms INT COMMENT '处理时间(毫秒)',
    -- RAG 上下文
    rag_context JSON COMMENT 'RAG检索上下文(JSON对象：{"sources":[""],"relevance_scores":[]})',
    retrieval_sources JSON COMMENT '检索来源文档列表',
    -- 消息状态
    is_generating BOOLEAN DEFAULT FALSE COMMENT '是否正在生成中',
    is_streaming BOOLEAN DEFAULT FALSE COMMENT '是否正在流式输出',
    is_error BOOLEAN DEFAULT FALSE COMMENT '是否错误',
    error_message TEXT COMMENT '错误信息',
    -- 引用与追溯
    references_json JSON COMMENT '文档引用(JSON数组：[{"id":"","title":"","page":1}]）',
    -- 会话关联
    parent_message_id BIGINT COMMENT '父消息ID（用于对话树）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    INDEX idx_session_id (session_id),
    INDEX idx_role (role),
    INDEX idx_parent_message_id (parent_message_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';
```

#### 3.8.3 文档引用表 (chat_document_references)

> **设计说明**: 记录对话中引用的知识库文档，支持追溯和关联

```sql
CREATE TABLE IF NOT EXISTS chat_document_references (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    session_id BIGINT NOT NULL COMMENT '关联会话ID',
    message_id BIGINT COMMENT '关联消息ID（可选）',
    -- 文档引用信息
    doc_id VARCHAR(100) COMMENT '文档ID（关联 knowledge_documents.id）',
    doc_title VARCHAR(255) NOT NULL COMMENT '文档标题',
    doc_type ENUM('pdf', 'docx', 'txt', 'md') COMMENT '文档类型',
    topic VARCHAR(100) COMMENT '主题分类',
    sub_topic VARCHAR(100) COMMENT '子主题分类',
    -- 引用位置
    reference_page INT COMMENT '引用页码',
    reference_snippet TEXT COMMENT '引用片段内容',
    reference_context TEXT COMMENT '引用上下文',
    -- RAG 评分
    relevance_score DECIMAL(5, 4) COMMENT '相关性评分(0-1)',
    -- 统计
    click_count INT DEFAULT 0 COMMENT '点击次数',
    preview_count INT DEFAULT 0 COMMENT '预览次数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
    INDEX idx_session_id (session_id),
    INDEX idx_message_id (message_id),
    INDEX idx_doc_id (doc_id),
    INDEX idx_relevance_score (relevance_score),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档引用表';
```

#### 3.8.4 知识清单表 (chat_knowledge_items)

> **设计说明**: 存储对话过程中展示的知识清单、概念图、证据引用等

```sql
CREATE TABLE IF NOT EXISTS chat_knowledge_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    session_id BIGINT NOT NULL COMMENT '关联会话ID',
    message_id BIGINT COMMENT '关联消息ID（可选）',
    -- 知识项类型
    item_type ENUM('concept_map', 'knowledge_table', 'evidence_quote', 'background_knowledge') NOT NULL COMMENT '知识项类型',
    -- 概念图相关
    concept_nodes JSON COMMENT '概念图节点(JSON数组)',
    concept_edges JSON COMMENT '概念图边(JSON数组)',
    -- 知识表格相关
    table_data JSON COMMENT '表格数据(JSON对象：{headers:[], rows:[]})',
    -- 证据引用相关
    quote_content TEXT COMMENT '引用内容',
    quote_source VARCHAR(255) COMMENT '引用来源',
    -- 前置知识相关
    knowledge_term VARCHAR(100) COMMENT '术语名称',
    knowledge_definition TEXT COMMENT '术语定义',
    -- 统计
    expand_count INT DEFAULT 0 COMMENT '展开次数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
    INDEX idx_session_id (session_id),
    INDEX idx_message_id (message_id),
    INDEX idx_item_type (item_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识清单表';
```

> **前端 ChatPage 与数据库表对应关系**:
>
> | 前端组件/数据结构 | 数据库表 | 字段 |
> |------------------|---------|------|
> | `ChatPage` 会话 | `chat_sessions` | `id`, `ai_mode`, `status` |
> | `INITIAL_MESSAGES` | `chat_messages` | `role`, `content`, `references` |
> | `Message.references` | `chat_messages` / `chat_document_references` | `references_json` / `doc_id`, `doc_title`, `reference_page` |
> | `AI_MODES` | `chat_sessions.ai_mode` | `deep_think`/`risk_assessment`/`intervention`/`scale_interpret` |
> | `DOC_SOURCES` | `chat_document_references` / `knowledge_documents` | `doc_id`, `doc_title`, `topic`, `sub_topic` |
> | `KNOWLEDGE_TABLE` | `chat_knowledge_items` | `item_type='knowledge_table'`, `table_data` |
> | `ConceptMap` | `chat_knowledge_items` | `item_type='concept_map'`, `concept_nodes`, `concept_edges` |
> | `ConceptMap` | `chat_knowledge_items` | `item_type='evidence_quote'`, `quote_content`, `quote_source` |
> | 证据引用片段 | `chat_knowledge_items` | `item_type='evidence_quote'` |
> | 前置知识折叠 | `chat_knowledge_items` | `item_type='background_knowledge'`, `knowledge_term`, `knowledge_definition` |
> | 上下文/数据来源 | `chat_sessions` | `knowledge_sources`, `rag_keywords` |
> | 推荐问题 | `chat_recommended_questions` | `question`, `ai_mode`, `sort_order` |

#### 3.8.5 推荐问题表 (chat_recommended_questions)

> **设计说明**: 存储智能问答模块的推荐问题，支持按 AI 模式分类

```sql
CREATE TABLE IF NOT EXISTS chat_recommended_questions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    question VARCHAR(500) NOT NULL COMMENT '问题内容',
    ai_mode ENUM('deep_think', 'risk_assessment', 'intervention', 'scale_interpret', 'all') DEFAULT 'all' COMMENT '适用AI模式(all表示通用)',
    category VARCHAR(100) COMMENT '问题分类',
    keywords JSON COMMENT '关键词(JSON数组，用于匹配)',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    usage_count INT DEFAULT 0 COMMENT '使用次数',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_ai_mode (ai_mode),
    INDEX idx_category (category),
    INDEX idx_sort_order (sort_order),
    INDEX idx_usage_count (usage_count),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='推荐问题表';

-- 初始化推荐问题
INSERT INTO chat_recommended_questions (question, ai_mode, category, sort_order) VALUES
-- 通用问题
('抑郁症有哪些典型症状？', 'all', '抑郁症状', 1),
('如何区分抑郁与焦虑？', 'all', '情绪识别', 2),
-- 风险评估相关
('高风险时该如何干预？', 'risk_assessment', '危机干预', 3),
('如何识别自杀风险信号？', 'risk_assessment', '风险识别', 4),
-- 干预建议相关
('有什么心理援助资源可以推荐？', 'intervention', '资源推荐', 5),
('如何帮助有自杀倾向的人？', 'intervention', '危机干预', 6),
-- 量表解读相关
('PHQ-9 量表如何解读？', 'scale_interpret', '量表说明', 7),
('量表得分高代表什么？', 'scale_interpret', '量表解读', 8);
```

#### 3.8.6 智能问答前端字段与数据库字段对照表

> **说明**：以下表格完整对应前端 ChatPage.tsx 的前端类型与数据库字段映射。

**前端常量与数据库字段对照**：

| 前端常量 | 前端值 | 数据库字段 | 表名 | 说明 |
|---------|-------|-----------|------|------|
| AI_MODES | `'深度思考'` | ai_mode = 'deep_think' | chat_sessions | 深度思考模式 |
| AI_MODES | `'风险评估'` | ai_mode = 'risk_assessment' | chat_sessions | 风险评估模式 |
| AI_MODES | `'干预建议'` | ai_mode = 'intervention' | chat_sessions | 干预建议模式 |
| AI_MODES | `'量表解读'` | ai_mode = 'scale_interpret' | chat_sessions | 量表解读模式 |
| RECOMMENDED_QUESTIONS | - | question | chat_recommended_questions | 推荐问题内容 |
| DOC_SOURCES | - | id / title / type / topic / subTopic | chat_document_references JOIN knowledge_documents | 文档来源 |
| KNOWLEDGE_TABLE | - | item_type = 'knowledge_table' | chat_knowledge_items | 知识清单 |
| ConceptMap | - | item_type = 'concept_map' | chat_knowledge_items | 概念图 |
| 证据引用片段 | - | item_type = 'evidence_quote' | chat_knowledge_items | 证据引用 |
| 前置知识折叠 | - | item_type = 'background_knowledge' | chat_knowledge_items | 前置知识 |

**Message (消息) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | chat_messages | 消息ID |
| role | role | chat_messages | 角色 (user/ai/system) |
| content | content | chat_messages | 消息内容 |
| references | references_json | chat_messages | 文档引用 JSON |
| references[].id | JSON_EXTRACT(references_json, '$[*].id') | chat_messages | 引用文档ID |
| references[].title | JSON_EXTRACT(references_json, '$[*].title') | chat_messages | 引用文档标题 |
| references[].page | JSON_EXTRACT(references_json, '$[*].page') | chat_messages | 引用页码 |
| attachments | attachments | chat_messages | 附件列表 JSON |
| attachments[].id | JSON_EXTRACT(attachments, '$[*].id') | chat_messages | 附件ID |
| attachments[].type | JSON_EXTRACT(attachments, '$[*].type') | chat_messages | 附件类型 (image/file) |
| attachments[].name | JSON_EXTRACT(attachments, '$[*].name') | chat_messages | 附件名称 |
| attachments[].url | JSON_EXTRACT(attachments, '$[*].url') | chat_messages | 附件URL |

**DocSource (文档来源) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | doc_id / id | chat_document_references / knowledge_documents | 文档ID |
| title | doc_title / title | chat_document_references / knowledge_documents | 文档标题 |
| type | doc_type / format | chat_document_references / knowledge_documents | 文档类型 (pdf/word/md/txt) |
| topic | topic_name | chat_document_references LEFT JOIN knowledge_topics | 主题名称 |
| subTopic | sub_topic_name | chat_document_references LEFT JOIN knowledge_sub_topics | 子主题名称 |

**KnowledgeItem (知识项) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| theme | theme / knowledge_term | chat_knowledge_items | 主题/术语 |
| knowledge | knowledge_term | chat_knowledge_items | 知识名称 |
| desc | knowledge_definition / table_data | chat_knowledge_items | 描述/表格数据 |

**ChatSession (会话) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | chat_sessions | 会话ID |
| aiMode | ai_mode | chat_sessions | AI模式 |
| status | status | chat_sessions | 状态 (active/archived/deleted) |
| isPinned | is_pinned | chat_sessions | 是否置顶 |
| messageCount | message_count | chat_sessions | 消息数量 |
| totalTokens | total_tokens | chat_sessions | 总Token数 |
| knowledgeSources | knowledge_sources | chat_sessions | 知识库来源 JSON |
| ragKeywords | rag_keywords | chat_sessions | RAG检索关键词 JSON |
| userId | user_hash | chat_sessions | 用户标识 |
| archiveId | archive_id | chat_sessions | 关联档案ID |
| dataSource | data_source | chat_sessions | 数据来源 |
| createdAt | created_at | chat_sessions | 创建时间 |
| lastMessageAt | last_message_at | chat_sessions | 最后消息时间 |

**上下文/数据来源展示与数据库字段对照**：

| 前端展示内容 | 数据库字段 | 表名 | 说明 |
|------------|-----------|------|------|
| 知识库 | knowledge_sources | chat_sessions | 知识库来源数组 |
| RAG 检索范围 | rag_keywords | chat_sessions | RAG关键词数组 |

**attachments JSON 存储格式**：

```json
// attachments 字段存储格式
[
  {
    "id": "img-1711234567890",
    "type": "image",
    "name": "screenshot.png",
    "url": "blob:http://localhost:5173/..."
  },
  {
    "id": "file-1711234567891",
    "type": "file",
    "name": "report.pdf",
    "url": "blob:http://localhost:5173/..."
  }
]
```

**references_json 存储格式**：

```json
// references_json 字段存储格式
[
  {
    "id": "doc1",
    "title": "心理健康指南.pdf",
    "page": 5
  },
  {
    "id": "doc3",
    "title": "干预方法.md",
    "page": 2
  }
]
```

---

## 四、索引设计

| 表名 | 索引类型 | 索引字段 | 用途 |
|-----|---------|---------|------|
| psychological_archives | idx_user_id | user_id | 用户查询 |
| psychological_archives | idx_dataset_source | dataset_source | 数据源筛选 |
| psychological_archives | idx_risk_level | risk_level | 风险筛选 |
| psychological_archives | idx_risk_value | risk_value | 细粒度风险筛选 |
| user_posts | idx_archive_id | archive_id | 档案关联查询 |
| user_posts | idx_fine_risk_value | fine_risk_value | 细粒度风险筛选 |
| user_posts | idx_review_status | review_status | 审核状态筛选 |
| dataset_profile | idx_dataset_key | dataset_key | 数据集查询 |
| dataset_profile | idx_language | language | 语言筛选 |
| dataset_profile | idx_class_system | class_system | 分类体系筛选 |
| dataset_profile | idx_sort_order | sort_order | 排序 |
| archive_import_batch | idx_batch_code | batch_code | 批次查询 |
| archive_import_batch | idx_dataset_key | dataset_key | 数据集关联 |
| archive_import_batch | idx_status | status | 状态筛选 |
| archive_import_batch | idx_created_at | created_at | 时间排序 |
| scale_tasks | idx_archive_id | archive_id | 档案关联 |
| scale_tasks | idx_status | status | 状态筛选 |
| models | idx_model_type | model_type | 类型筛选 |
| models | idx_is_available | is_available | 可用性筛选 |
| knowledge_documents | idx_topic_id | topic_id | 主题筛选 |
| knowledge_documents | idx_sub_topic_id | sub_topic_id | 子主题筛选 |
| knowledge_documents | idx_format | format | 格式筛选 |
| knowledge_documents | idx_upload_status | upload_status | 状态筛选 |
| knowledge_documents | idx_uploaded_at | uploaded_at | 时间排序 |

---

## 五、与前端页面的字段对应

> **说明**：以下各小节完整对应前端各页面类型与数据库字段映射。

---

### 5.1 HomePage 首页数据结构

> **说明**：首页 Dashboard 统计卡片数据，直接从 `homepage_summary_stats` 表查询，无需前端聚合计算。

**HomePage 统计卡片与数据库字段对照**：

| 前端展示 | 前端数据 key | 数据库字段 | 表名 | 说明 |
|---------|-----------|-----------|------|------|
| 知识库文档 | FUNCTION_CARDS[0].label | stat_value | homepage_summary_stats | stat_key='knowledge_base_docs' |
| 总档案数 | FUNCTION_CARDS[1].label | stat_value | homepage_summary_stats | stat_key='total_archives' |
| 总量表数 | FUNCTION_CARDS[2].label | stat_value | homepage_summary_stats | stat_key='total_scales' |
| 报告生成数 | FUNCTION_CARDS[3].label | stat_value | homepage_summary_stats | stat_key='reports_generated' |
| 风险分布-低风险45% | SVG环形图数据 | stat_value / stat_unit | homepage_summary_stats | stat_key='risk_low_percentage' / 'risk_low_count' |
| 风险分布-中风险30% | SVG环形图数据 | stat_value / stat_unit | homepage_summary_stats | stat_key='risk_medium_percentage' / 'risk_medium_count' |
| 风险分布-高风险25% | SVG环形图数据 | stat_value / stat_unit | homepage_summary_stats | stat_key='risk_high_percentage' / 'risk_high_count' |

**统计项类型说明**：

| stat_category | 说明 |
|--------------|------|
| `core_stats` | 核心统计卡片（知识库/档案/量表/报告数量） |
| `risk_distribution` | 风险等级分布（数量+百分比） |

---

### 5.2 ArchivePage 心理档案列表页数据结构

**ArchiveRecord 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | psychological_archives | 档案ID |
| userId | user_id | psychological_archives | 脱敏用户标识（如 user_hash_01） |
| dataSource | dataset_source | psychological_archives | 数据来源（weibo/bigdata/reddit/sigir） |
| postCount | post_count | psychological_archives | 贴文数量 |
| riskOverview | risk_level | psychological_archives | 粗粒度风险等级（low→低风险/medium→中风险/high→高风险） |
| importTime | import_timestamp | psychological_archives | 导入时间（格式 YYYY-MM-DD HH:mm） |
| lastActive | post_timestamp_end | psychological_archives | 最后活跃时间（仅 bigdata 有值） |
| status | status | psychological_archives | 状态（importing/ready/analyzing） |
| userStats | - | 前端计算 | 由 user_posts 聚合统计 male/female/unknown |
| fineRiskCount | - | 前端计算 | 细粒度风险等级种类数（去重 fine_risk_value） |
| customPostCount | post_count | archive_import_batch | 人工填写帖子数（步骤2字段） |
| isManualAnnotation | is_manual_annotation | archive_import_batch | 是否手工标注 |
| selectedFields | selected_fields | archive_import_batch | 勾选的字段列表 |
| statsSnapshot | - | archive_import_batch | 统计快照（uniqueUsers/riskDistribution） |

**PostRecord (导入向导贴文) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | user_posts | 贴文ID |
| userId | user_id | user_posts | 用户标识 |
| postIndex | post_index | user_posts | 贴文序号（从1开始） |
| content | content | user_posts | 贴文内容 |
| sentimentScore | sentiment_score | user_posts | 情感分数（0-1） |
| riskLevel | - | 前端计算 | 由 fine_risk_value 查 coarse_risk_mapping |
| riskScore | sentiment_score | user_posts | 前端近似使用 |
| suicideRisk | fine_risk_value | user_posts | 细粒度风险值（0/1/2/3/4） |
| timestamp | post_timestamp | user_posts | 发布时间（仅 bigdata 有） |
| hasTimestamp | - | 前端判断 | post_timestamp IS NOT NULL |
| emjioSequence | emoji_sequence | user_posts | 表情序列 |
| status | review_status | user_posts | 审核状态（pending/accepted/rejected） |
| isMissing | - | 前端判断 | timestamp 为 NULL 时为 true |
| isAnomaly | - | 前端判断 | 数据异常时标记 |

---

### 5.3 ArchiveDetailPage 心理档案详情页数据结构

> **说明**：这是 ArchivePage 的详情页，增加图表可视化和筛选功能。核心展示字段为 `importance_score`。

**ArchiveDetailPage 筛选条件与数据库字段对照**：

| 前端筛选 | 前端筛选值 | 数据库字段 | 表名 | 说明 |
|---------|----------|-----------|------|------|
| topN | 3/5/10 | LIMIT N ORDER BY importance_score DESC | user_posts | Top N 重要性帖子 |
| importanceFilter | 'all' | - | - | 不过滤 |
| importanceFilter | 'low' | importance_level = 'low' | user_posts | 低重要性 (<0.4) |
| importanceFilter | 'medium' | importance_level = 'medium' | user_posts | 中重要性 (0.4-0.7) |
| importanceFilter | 'high' | importance_level = 'high' | user_posts | 高重要性 (>=0.7) |
| postIndexFilter | 精确序号 | post_index = N | user_posts | 帖子序号精确匹配 |
| timeRange | start/end 日期 | post_timestamp BETWEEN start AND end | user_posts | 仅 bigdata 有 |

**PostRecord (档案详情贴文) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | user_posts | 贴文ID |
| userId | user_id | user_posts | 用户标识 |
| postIndex | post_index | user_posts | 贴文序号（从1开始） |
| content | content | user_posts | 贴文内容 |
| importanceScore | importance_score | user_posts | 重要性分数（0-1，图表柱形高度） |
| importanceLevel | importance_level | user_posts | 重要性等级（low/medium/high，图表颜色映射） |
| riskLevel | - | 前端计算 | 由 fine_risk_value 映射 |
| riskScore | sentiment_score | user_posts | 情感风险分数（0-1） |
| suicideRisk | fine_risk_value | user_posts | 细粒度风险值（0/1/2/3/4） |
| timestamp | post_timestamp | user_posts | 发布时间 |
| hasTimestamp | - | 前端判断 | post_timestamp IS NOT NULL |
| microExpressions | micro_expressions | user_posts | 微表情序列（JSON数组） |
| status | review_status | user_posts | 审核状态 |
| emojiSequence | emoji_sequence | user_posts | 表情序列 |

**ECharts 图表数据格式**：

```javascript
// 柱形图 xAxis: 时间标签
xAxis.data = chartPosts.map(p => p.timestamp?.split(' ')[0] || `#${p.postIndex}`)

// 柱形图 series.data: 重要性分数（颜色由 importanceLevel 决定）
series.data = chartPosts.map(post => ({
  value: post.importanceScore,
  itemStyle: {
    color: post.importanceLevel === 'high' ? '#ff4d4f'
         : post.importanceLevel === 'medium' ? '#faad14'
         : '#52c41a'
  }
}))
```

---

### 5.4 ScalePage + ScaleAnswerPage + ScaleResultPage 量表系列页面数据结构

**ScaleTask 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | scale_tasks | 任务ID |
| taskName | task_name | scale_tasks | 任务名称 |
| dataSource | data_source | scale_tasks | 数据来源代码（weibo/bigdata/reddit/sigir） |
| dataSourceLabel | data_source_label | scale_tasks | 数据来源显示名（如微博系列） |
| userName | user_alias | scale_tasks | 用户别名（默认匿名用户） |
| scaleId | scale_id | scale_tasks | 量表ID（外键） |
| scaleName | scale_name | scale_tasks | 量表简称（如 PHQ-9） |
| status | status | scale_tasks | 状态（pending/in_progress/completed） |
| progress | progress | scale_tasks | 进度（0-100） |
| totalScore | total_score | scale_tasks | 总分 |
| threshold | - | scale_definitions | 从量表定义表关联获取 |
| riskLevel | risk_level | scale_tasks | 风险等级（low/medium/high） |
| createdAt | created_at | scale_tasks | 创建时间 |
| startedAt | started_at | scale_tasks | 开始时间 |
| completedAt | completed_at | scale_tasks | 完成时间 |
| answers | answers | scale_tasks | 答案列表（JSON数组） |

**CreateTaskInput 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| taskName | task_name | scale_tasks | 任务名称（必填） |
| dataSource | data_source | scale_tasks | 数据来源代码 |
| dataSourceLabel | data_source_label | scale_tasks | 数据来源显示名称（前端展示用） |
| userId | user_hash | scale_tasks | 脱敏用户标识 |
| userName | user_alias | scale_tasks | 用户别名 |
| scaleId | scale_id | scale_tasks | 量表ID |
| scaleName | scale_name | scale_tasks | 量表名称 |
| totalQuestions | total_questions | scale_tasks | 总题数 |

**风险等级判定规则（前端硬编码，后端应同步存储）**：

| 量表 | 高风险阈值 | 中风险阈值 | 低风险 |
|------|---------|---------|-------|
| PHQ-9 | >=20 | >=10 | <10 |
| C-SSRS | >=15 | >=8 | <8 |
| GAD-7 | >=15 | >=10 | <10 |
| DASS-21 | >=40 | >=20 | <20 |

---

### 5.5 DocPreviewPage 文档预览页数据结构

> **说明**：DocPreviewPage 依赖前端 ChatPage 的 `DOC_SOURCES` 常量，该数据来源关联 `knowledge_documents` 表。

**DocSource 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | knowledge_documents | 文档ID |
| title | title | knowledge_documents | 文档标题 |
| type | format | knowledge_documents | 文档格式（pdf/docx/txt/md） |
| topic | topic_name | knowledge_documents LEFT JOIN knowledge_topics ON topic_id = knowledge_topics.id | 主题名称 |
| subTopic | sub_topic_name | knowledge_documents LEFT JOIN knowledge_sub_topics ON sub_topic_id = knowledge_sub_topics.id | 子主题名称 |

---

### 5.6 ScaleResultPage 缓解话语与数据库字段对照

> **说明**：ScaleResultPage 的 `comfortMessage`（缓解话语）由前端硬编码生成，也可存储到数据库。

**ComfortMessage 建议存储字段**：

| 前端展示 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| 缓解话语标题 | comfort_title | scale_tasks.assessment_result JSON | 鼓励标题 |
| 缓解话语内容 | comfort_content | scale_tasks.assessment_result JSON | 鼓励正文 |
| 建议列表 | suggestions | scale_tasks.assessment_result JSON | 建议数组 |
| 行动按钮 | action | scale_tasks.assessment_result JSON | 高风险时为'进入风险检测' |

**assessment_result JSON 存储格式**：

```json
{
  "riskInfo": {
    "level": "high",
    "label": "高风险",
    "description": "您的量表得分为 23 分，属于高风险水平..."
  },
  "comfortMessage": {
    "title": "请不要独自面对",
    "content": "您现在的感受是可以理解的，但请记住...",
    "suggestions": [
      "寻求专业心理帮助",
      "与信任的家人朋友倾诉",
      "拨打心理援助热线"
    ],
    "action": "进入风险检测"
  }
}
```

---

### 5.7 知识库前端字段与数据库字段对照（完善版）

**KnowledgeDoc (知识文档) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | knowledge_documents | 文档ID |
| title | title | knowledge_documents | 文档标题 |
| topic | topic_name | knowledge_documents LEFT JOIN knowledge_topics ON topic_id = knowledge_topics.id | 主题名称 |
| subTopic | sub_topic_name | knowledge_documents LEFT JOIN knowledge_sub_topics ON sub_topic_id = knowledge_sub_topics.id | 子主题名称 |
| keywords | keywords | knowledge_documents | 关键词（JSON数组） |
| format | format | knowledge_documents | 文档格式（pdf/docx/txt/md） |
| size | size_display | knowledge_documents | 显示大小（如 2.3 MB） |
| status | upload_status | knowledge_documents | 上传状态（uploading/uploaded/failed） |
| progress | progress | knowledge_documents | 处理进度（0-100） |
| uploadTime | uploaded_at | knowledge_documents | 上传时间 |
| description | description | knowledge_documents | 文档描述 |
| fileName | file_name | knowledge_documents | 原始文件名 |
| fileType | file_type | knowledge_documents | MIME类型 |
| ragPath | rag_path | knowledge_documents | RAG 路径 |
| usageCount | usage_count | knowledge_documents | 查阅次数 |
| uploadedBy | uploaded_by | knowledge_documents | 上传者 |

**UploadModal 表单字段对照**：

| 前端表单字段 | 数据库字段 | 表名 | 说明 |
|-------------|-----------|------|------|
| title | title | knowledge_documents | 文档标题（必填） |
| topic | topic_id → topic_name | knowledge_topics | 主题（必填，外键关联） |
| subTopic | sub_topic_id → sub_topic_name | knowledge_sub_topics | 子主题（必填，依赖主题） |
| keywords | keywords | knowledge_documents | 关键词（JSON数组存储） |
| description | description | knowledge_documents | 文档描述 |
| fileType | format | knowledge_documents | 文档格式（pdf/docx/txt/md） |
| file | file_path, file_name, file_size | knowledge_documents | 文件存储路径/原始文件名/大小 |

---

### 5.8 风险检测前端字段与数据库字段对照（完善版）

**DetectionTask (单模型任务) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | risk_detection_tasks | 任务ID |
| name | task_name | risk_detection_tasks | 任务名称 |
| taskType | type_code | risk_detection_tasks LEFT JOIN detection_task_types ON task_type_id = detection_task_types.id | 检测类型代码 |
| taskTypeName | type_name | 同上 | 检测类型名称 |
| dataSource | data_source | risk_detection_tasks | 数据来源 |
| model | model_name | risk_detection_tasks LEFT JOIN models ON single_model_id = models.id | 模型名称 |
| modelType | model_type | 同上 | 模型类型 (api/ollama/transformers/fealearner/emoji) |
| modelParams | single_model_params | risk_detection_tasks | 单模型执行参数（JSON） |
| status | status | risk_detection_tasks | 状态 |
| progress | progress | risk_detection_tasks | 进度（0-100） |
| result | result_summary | risk_detection_tasks | 结果 JSON |
| result.riskLevel | JSON_EXTRACT(result_summary, '$.riskLevel') | risk_detection_tasks | 风险等级 |
| result.riskScore | JSON_EXTRACT(result_summary, '$.riskScore') | risk_detection_tasks | 风险分数（0-1） |
| result.confidence | JSON_EXTRACT(result_summary, '$.confidence') | risk_detection_tasks | 置信度（0-100） |
| result.features | JSON_EXTRACT(result_summary, '$.features') | risk_detection_tasks | 特征列表（中文标签数组） |
| createTime | created_at | risk_detection_tasks | 创建时间 |
| completedTime | completed_at | risk_detection_tasks | 完成时间 |
| userId | user_hash | risk_detection_tasks | 用户标识 |
| postCount | post_count | risk_detection_tasks | 贴文数量 |
| description | task_description | risk_detection_tasks | 任务描述 |

**MultiModelTask (多模型任务) 前端类型完整对照**：

| 前端字段 | 数据库字段 | 表名 | 说明 |
|---------|-----------|------|------|
| id | id | risk_detection_tasks | 任务ID |
| name | task_name | risk_detection_tasks | 任务名称 |
| description | task_description | risk_detection_tasks | 任务描述 |
| userId | user_hash | risk_detection_tasks | 用户标识 |
| dataSource | data_source | risk_detection_tasks | 数据来源 |
| detectionModels | JSON_EXTRACT(detection_model_configs, '$[*].modelId') | risk_detection_tasks | 检测模型ID列表 |
| detectionModels | JSON_EXTRACT(detection_model_configs, '$[*].modelName') | risk_detection_tasks | 检测模型名称列表 |
| apiModel | model_name | risk_detection_tasks LEFT JOIN models ON fusion_model_id = models.id | 融合模型名称 |
| apiModelCategory | model_category | 同上 | 模型分类 (api/llm) |
| promptTemplateId | fusion_prompt_template_id | risk_detection_tasks | 提示词模板ID |
| promptTemplateName | name | risk_detection_tasks LEFT JOIN prompt_templates ON fusion_prompt_template_id = prompt_templates.id | 提示词名称 |
| modelParams | fusion_model_params | risk_detection_tasks | 融合模型参数（JSON） |
| modelParams.temperature | JSON_EXTRACT(fusion_model_params, '$.temperature') | - | 温度参数 |
| modelParams.maxTokens | JSON_EXTRACT(fusion_model_params, '$.maxTokens') | - | 最大 Token 数 |
| modelParams.topP | JSON_EXTRACT(fusion_model_params, '$.topP') | - | Top-P 参数 |
| modelParams.confidenceThreshold | JSON_EXTRACT(fusion_model_params, '$.confidenceThreshold') | - | 置信度阈值 |
| modelParams.batchSize | JSON_EXTRACT(fusion_model_params, '$.batchSize') | - | 批处理大小 |
| status | status | risk_detection_tasks | 任务状态 |
| result | result_summary | risk_detection_tasks | 结果 JSON |
| result.fusedRiskLevel | JSON_EXTRACT(result_summary, '$.riskLevel') | risk_detection_tasks | 综合风险等级 |
| result.fusedRiskScore | JSON_EXTRACT(result_summary, '$.riskScore') | risk_detection_tasks | 综合风险分数 |
| result.confidence | JSON_EXTRACT(result_summary, '$.confidence') | risk_detection_tasks | 置信度 |
| result.summary | JSON_EXTRACT(result_summary, '$.summary') | risk_detection_tasks | 综合摘要 |
| result.modelHighlights | JSON_EXTRACT(result_summary, '$.features') | risk_detection_tasks | 模型亮点（中文标签） |
| createTime | created_at | risk_detection_tasks | 创建时间 |
| completedTime | completed_at | risk_detection_tasks | 完成时间 |

**detection_model_configs JSON 字段格式**：

```json
// 数据库存储格式
[
  {
    "modelId": 1,
    "modelName": "FeaLearner-SIGIR",
    "params": { "confidenceThreshold": 0.5, "batchSize": 32 }
  },
  {
    "modelId": 2,
    "modelName": "Emocc-SIGIR",
    "params": { "confidenceThreshold": 0.5, "batchSize": 32 }
  }
]
```

**fusion_model_params JSON 字段格式**：

```json
// 数据库存储格式
{
  "temperature": 0.7,
  "maxTokens": 2048,
  "topP": 0.9,
  "confidenceThreshold": 0.5,
  "batchSize": 32
}
```

---

## 六、初始化脚本

### 6.1 创建数据库

```sql
CREATE DATABASE IF NOT EXISTS vis4srd CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vis4srd;
```

### 6.2 执行建表脚本

按照本文档顺序执行建表语句即可。

### 6.3 验证初始化

```sql
-- 验证首页统计
SELECT COUNT(*) FROM homepage_summary_stats;
-- 预期: 10

-- 验证数据集档案（合并后）
SELECT COUNT(*) FROM dataset_profile;
-- 预期: 4

-- 验证量表定义
SELECT COUNT(*) FROM scale_definitions;
-- 预期: 4

-- 验证检测任务类型
SELECT COUNT(*) FROM detection_task_types;
-- 预期: 5

-- 验证知识主题
SELECT COUNT(*) FROM knowledge_topics;
-- 预期: 7

-- 验证知识子主题
SELECT COUNT(*) FROM knowledge_sub_topics;
-- 预期: 24

-- 验证智能问答推荐问题
SELECT COUNT(*) FROM chat_recommended_questions;
-- 预期: 8

-- 验证知识文档
SELECT COUNT(*) FROM knowledge_documents;
-- 预期: >0
```

---

## 七、设计总结

### 7.1 移除的内容

| 移除项 | 移除原因 |
|-------|---------|
| `dataset_series` + `dataset_config` 表 | 合并为 `dataset_profile` 单表 |
| `mental_institutions` 表 | Map页面已独立实现，数据库不需要 |
| `crisis_hotlines` 表 | Map页面已独立实现，数据库不需要 |
| `user_profiles` 表 | 功能已被 `psychological_archives` 替代 |
| `chat_knowledge_items` 表部分字段 | 简化为 `knowledge_term` + `knowledge_definition` |

### 7.2 敏感字段移除

| 原字段 | 移除原因 |
|-------|---------|
| gender | 性别信息属于敏感个人信息 |
| age_group | 年龄段信息属于敏感个人信息 |
| nationality | 国籍信息属于敏感个人信息 |

### 7.3 语言字段简化

- 保留 `language` 字段
- 取值简化为 `中文` / `英文` 两种

### 7.4 命名规范

- 表名：使用 `snake_case`，参考 LLMAgriKEVAS
- 主键：统一使用 `id BIGINT AUTO_INCREMENT`
- 外键：`table_name_id` 格式
- 索引：`idx_字段名` 格式
- 时间字段：`created_at`, `updated_at` 使用 `DATETIME DEFAULT CURRENT_TIMESTAMP`

---

**文档版本**: 3.0
**最后更新**: 2026-03-28
**设计依据**: 前端页面设计 + LLMAgriKEVAS 数据库风格
**重大变更**:
- **v3.0 (2026-03-28)**:
  - 删除 `mental_institutions` + `crisis_hotlines` 表（Map页面独立实现）
  - 合并 `dataset_series` + `dataset_config` → `dataset_profile`（已完成）
  - 新增 `homepage_summary_stats` 表（首页统计）
  - 新增 `archive_import_batch` 表（导入批次管理）
  - 完善 `psychological_archives` 表（增加重要性聚合字段）
  - 完善 `user_posts` 表（增加 `importance_score` / `importance_level` / `micro_expressions`）
  - 完善 `scale_tasks` 表（增加 `data_source_label` 等字段）
  - 完善 `models` 表（支持 API模型/本地LLM/检测模型 三大类）
  - 完善 `risk_detection_tasks` 表（支持单模型/多模型联合检测）
  - 新增 `detection_task_types` 表（检测任务类型）
  - 新增 `risk_detection_sub_tasks` 表（多模型子任务）
  - 新增 `risk_detection_fusion_records` 表（融合评估记录）
  - 新增 `risk_detection_history` 表（检测历史）
  - 完善智能问答模块（`chat_sessions` / `chat_messages` / `chat_document_references` / `chat_knowledge_items` / `chat_recommended_questions`）
  - 完善知识库模块（`knowledge_documents` / `knowledge_topics` / `knowledge_sub_topics` / `knowledge_document_keywords` / `knowledge_document_versions`）
- **v2.5**: 章节编号修正，新增前端字段对照表
- **v2.4**: 完善三大模块表设计
- **v2.3**: 新增智能问答模块
- **v2.2**: 合并数据集表，新增导入批次表
