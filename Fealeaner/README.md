# Fealeaner 模型文件

此目录包含 FeaLearner 模型推理所需的完整文件。

## 目录结构

```
Fealeaner/
├── predict_with_bestmodel.py           # 预测脚本入口
├── package_prediction_bundle.py       # 打包脚本
│
├── FeaLearner/                        # 训练代码
│   ├── reddit/auto_select/
│   │   ├── reddit.py                  # Reddit 训练脚本
│   │   ├── twomoe.py                  # 模型架构
│   │   └── tools/utils.py             # 工具函数
│   ├── weibo/auto_select/             # Weibo 模型代码
│   ├── bigdata/auto_select/           # BigData 模型代码
│   └── sigir/auto_select/            # SIGIR 模型代码
│
├── bestmodel/                         # 模型权重
│   ├── my_reddit_model.pth           # Reddit 模型
│   ├── my_weibo_model.pth            # Weibo 模型
│   ├── my_bigdata_model.pth          # BigData 模型
│   └── my_sigir_model.pth            # SIGIR 模型
│
├── data/                              # 嵌入文件
│   └── bert_embeddings.pkl           # Reddit BERT 嵌入
│
└── feature_data/                       # 特征数据
    ├── feature_reddit_500.csv         # Reddit 特征
    ├── feature_weibo_2.csv           # Weibo 特征
    ├── feature_bigdata.csv           # BigData 特征
    └── feature_sigir.csv            # SIGIR 特征
```

## 部署说明

此文件夹需要与 `backend/` 目录平级放置：

```
项目根目录/
├── backend/                    # FastAPI 后端
├── Fealeaner/                  # ⭐ 本文件夹，与 backend 平级
└── datasets/
    └── reddit/
        └── reddit_500.csv     # 用户数据集
```

## 文件说明

| 文件 | 大小 | 说明 |
|------|------|------|
| `predict_with_bestmodel.py` | - | 预测脚本入口 |
| `bestmodel/my_reddit_model.pth` | ~100MB | Reddit 模型权重 |
| `data/bert_embeddings.pkl` | ~28MB | BERT 嵌入向量 |
| `feature_data/feature_reddit_500.csv` | ~10MB | 用户特征表 |
