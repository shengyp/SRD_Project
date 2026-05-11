-- FeaLearner 按数据集 4 条预置（与 Emocc 一致）；启动时由 ModelService.init_builtin_data 幂等写入。
-- Weibo：FeaLearner 嵌入与 datasets/weibo/weibo_data.csv 行序对齐；Emocc Weibo 使用 weibo_1000 子集，二者不同源。
-- 若仅手工补库，可执行本文件。model_code 唯一，重复则更新。
-- mysql -u root -p vis4srd < backend/deploy/insert_fealearner_by_dataset.sql

USE vis4srd;

INSERT INTO models (
  model_name, model_code, model_category, model_type, provider,
  detection_type, model_file_path, embedding_file_path, supported_datasets, description,
  version, is_available, is_default, is_builtin, performance_metrics, status
) VALUES
(
  'FeaLearner-Reddit', 'fealearner-reddit', 'detection', 'fealearner', 'VIS4SRD',
  'fealearner',
  'Fealeaner/bestmodel/my_reddit_model.pth',
  'Emocc/reddit/data/bert_embeddings.pkl',
  '["reddit"]',
  'FeaLearner Reddit 五分类。嵌入优先 Emocc/reddit/data/bert_embeddings.pkl。',
  'v1.0', 1, 1, 1, '{"accuracy":0.85,"precision":0.83,"recall":0.82,"f1":0.825}', 'active'
),
(
  'FeaLearner-Weibo', 'fealearner-weibo', 'detection', 'fealearner', 'VIS4SRD',
  'fealearner',
  'Fealeaner/bestmodel/my_weibo_model.pth',
  'Fealeaner/data/user_post_embeddings_bert_wwm.pkl',
  '["weibo"]',
  'FeaLearner Weibo 二分类。嵌入使用 Fealeaner/data（与 Emocc Weibo 不同）。',
  'v1.0', 1, 0, 1, '{}', 'active'
),
(
  'FeaLearner-BigData', 'fealearner-bigdata', 'detection', 'fealearner', 'VIS4SRD',
  'fealearner',
  'Fealeaner/bestmodel/my_bigdata_model.pth',
  'Emocc/bigdata/data/bigdata_bert_embeddings.pkl',
  '["bigdata"]',
  'FeaLearner BigData 四分类。嵌入优先 Emocc/bigdata/data/bigdata_bert_embeddings.pkl。',
  'v1.0', 1, 0, 1, '{}', 'active'
),
(
  'FeaLearner-SIGIR', 'fealearner-sigir', 'detection', 'fealearner', 'VIS4SRD',
  'fealearner',
  'Fealeaner/bestmodel/my_sigir_model.pth',
  'Emocc/sigir/data/sigir_bert_embeddings.pkl',
  '["sigir"]',
  'FeaLearner SIGIR 二分类。嵌入优先 Emocc/sigir/data/sigir_bert_embeddings.pkl。',
  'v1.0', 1, 0, 1, '{}', 'active'
)
ON DUPLICATE KEY UPDATE
  model_name=VALUES(model_name),
  model_type=VALUES(model_type),
  detection_type=VALUES(detection_type),
  model_file_path=VALUES(model_file_path),
  embedding_file_path=VALUES(embedding_file_path),
  supported_datasets=VALUES(supported_datasets),
  description=VALUES(description),
  status='active',
  updated_at=NOW();
