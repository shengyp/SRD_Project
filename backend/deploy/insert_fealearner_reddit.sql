-- ============================================================
-- FeaLearner 模型注册 SQL
-- 用于在 MySQL 数据库中注册 FeaLearner-Reddit 检测模型
-- 执行方式：mysql -u root -p vis4srd < insert_fealearner_reddit.sql
-- ============================================================

USE vis4srd;

-- 插入 FeaLearner-Reddit 检测模型
INSERT INTO models (
  model_name, model_code, model_category, model_type, provider,
  detection_type, model_file_path, supported_datasets, description,
  version, is_available, is_default, is_builtin, performance_metrics, status
) VALUES (
  'FeaLearner-Reddit',        -- model_name: 模型显示名称
  'fealearner-reddit',        -- model_code: 模型唯一标识
  'detection',                -- model_category: 模型类别（detection=检测模型）
  'fealearner',               -- model_type: 模型类型（fealearner=FeaLearner）
  'VIS4SRD',                  -- provider: 提供商
  'fealearner',               -- detection_type: 检测类型
  'Fealeaner/bestmodel/my_reddit_model.pth',  -- model_file_path: 模型文件路径（相对于项目根目录）
  '["reddit"]',               -- supported_datasets: 支持的数据集
  'FeaLearner 本地模型（Reddit），基于文本特征与嵌入进行自杀风险预测。',  -- description: 模型描述
  'v1.0',                     -- version: 版本号
  1,                          -- is_available: 是否可用（1=可用）
  0,                          -- is_default: 是否默认模型（0=非默认）
  1,                          -- is_builtin: 是否预置模型（1=预置）
  '{"accuracy":0.85,"precision":0.83,"recall":0.82,"f1":0.825}',  -- performance_metrics: 性能指标
  'active'                    -- status: 状态（active=激活）
)
ON DUPLICATE KEY UPDATE
  model_name=VALUES(model_name),
  model_type=VALUES(model_type),
  detection_type=VALUES(detection_type),
  model_file_path=VALUES(model_file_path),
  supported_datasets=VALUES(supported_datasets),
  description=VALUES(description),
  status='active',
  updated_at=NOW();

-- 验证插入结果
SELECT 
  id,
  model_name,
  model_code,
  model_category,
  model_type,
  detection_type,
  model_file_path,
  supported_datasets,
  is_available,
  is_builtin,
  status
FROM models
WHERE model_code = 'fealearner-reddit';
