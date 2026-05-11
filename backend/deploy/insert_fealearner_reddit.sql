-- ============================================================
-- FeaLearner 模型注册 SQL
-- 用于在 MySQL 数据库中注册 FeaLearner 检测模型（多数据集）
-- 执行方式：mysql -u root -p vis4srd < insert_fealearner_reddit.sql
-- 说明：展示名与路径文案与后端 fealearner_service 一致；
--       Reddit/SIGIR/BigData 嵌入优先 Emocc/<源>/data/，Weibo 用 Fealeaner/data。
-- ============================================================

USE vis4srd;

INSERT INTO models (
  model_name, model_code, model_category, model_type, provider,
  detection_type, model_file_path, embedding_file_path, supported_datasets, description,
  version, is_available, is_default, is_builtin, performance_metrics, status
) VALUES (
  'FeaLearner',
  'fealearner-reddit',
  'detection',
  'fealearner',
  'VIS4SRD',
  'fealearner',
  'Fealeaner/bestmodel：reddit→my_reddit_model.pth；weibo→my_weibo_model.pth；bigdata→my_bigdata_model.pth；sigir→my_sigir_model.pth（由任务 data_source 选用）',
  'Emocc/reddit/data/bert_embeddings.pkl；Emocc/bigdata/data/bigdata_bert_embeddings.pkl；Emocc/sigir/data/sigir_bert_embeddings.pkl；Weibo→Fealeaner/data/user_post_embeddings_bert_wwm.pkl',
  '["reddit","weibo","bigdata","sigir"]',
  '基于 BERT 文本嵌入与统计特征的本地深度分类模型。风险任务按所选数据源（reddit、weibo、bigdata、sigir）推理；Reddit/SIGIR/BigData 的嵌入 pkl 与 Emocc 部署目录一致（Emocc/<源>/data/），Weibo 嵌入使用 Fealeaner/data/user_post_embeddings_bert_wwm.pkl（与 Emocc Weibo 不同）。特征与权重仍来自 Fealeaner/feature_data、Fealeaner/bestmodel。任务分类数：Reddit 五类，Weibo/SIGIR 二类，BigData 四类。',
  'v1.0',
  1,
  0,
  1,
  '{"accuracy":0.85,"precision":0.83,"recall":0.82,"f1":0.825}',
  'active'
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

SELECT
  id,
  model_name,
  model_code,
  model_category,
  model_type,
  detection_type,
  model_file_path,
  embedding_file_path,
  supported_datasets,
  is_available,
  is_builtin,
  status
FROM models
WHERE model_code = 'fealearner-reddit';
