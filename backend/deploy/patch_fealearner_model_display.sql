-- 将模型中心中 FeaLearner 旧展示名与路径说明更新为多数据集 + Emocc 嵌入（可选执行）
-- mysql -u root -p vis4srd < backend/deploy/patch_fealearner_model_display.sql

USE vis4srd;

UPDATE models
SET
  model_name = 'FeaLearner',
  supported_datasets = '["reddit","weibo","bigdata","sigir"]',
  model_file_path = 'Fealeaner/bestmodel：reddit→my_reddit_model.pth；weibo→my_weibo_model.pth；bigdata→my_bigdata_model.pth；sigir→my_sigir_model.pth（由任务 data_source 选用）',
  embedding_file_path = 'Emocc/reddit/data/bert_embeddings.pkl；Emocc/bigdata/data/bigdata_bert_embeddings.pkl；Emocc/sigir/data/sigir_bert_embeddings.pkl；Weibo→Fealeaner/data/user_post_embeddings_bert_wwm.pkl',
  description = '基于 BERT 文本嵌入与统计特征的本地深度分类模型。风险任务按所选数据源（reddit、weibo、bigdata、sigir）推理；Reddit/SIGIR/BigData 的嵌入 pkl 与 Emocc 部署目录一致（Emocc/<源>/data/），Weibo 嵌入使用 Fealeaner/data/user_post_embeddings_bert_wwm.pkl（与 Emocc Weibo 不同）。特征与权重仍来自 Fealeaner/feature_data、Fealeaner/bestmodel。任务分类数：Reddit 五类，Weibo/SIGIR 二类，BigData 四类。',
  updated_at = NOW()
WHERE model_type = 'fealearner'
   OR model_code = 'fealearner-reddit';
