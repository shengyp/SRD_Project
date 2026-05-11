"""
Emoji工具：词汇表构建与预训练权重加载
"""
import os
import numpy as np
import pandas as pd
import gensim.models as gsm
from collections import Counter


def get_emoji_vocabulary(emoji_csv_path, max_vocab_size=500):
    """
    构建emoji词汇表（基于全量数据）
    """
    if not os.path.exists(emoji_csv_path):
        raise FileNotFoundError(f"Emoji数据集未找到: {emoji_csv_path}")
    
    print(f"\n===== 构建Emoji词汇表 =====")
    print(f"正在读取数据: {emoji_csv_path}")
    df = pd.read_csv(emoji_csv_path)

    # 兼容两种CSV格式：
    # - 旧格式: Post (单条emoji序列)
    # - 微博格式: emoji_sequence (逗号分隔的多帖子emoji序列)
    if 'Post' in df.columns:
        col = 'Post'
        is_multi_post = False
    elif 'emoji_sequence' in df.columns:
        col = 'emoji_sequence'
        is_multi_post = True
    else:
        raise ValueError(f"Emoji CSV缺少序列列(Post 或 emoji_sequence). 实际列: {list(df.columns)}")
    
    emoji_counts = Counter()
    for _, row in df.iterrows():
        emoji_str = str(row[col]) if pd.notna(row[col]) else ''
        if not emoji_str or emoji_str == 'nan':
            continue
        if is_multi_post:
            for part in emoji_str.split(','):
                if part and part != 'nan':
                    emoji_counts.update(list(part))
        else:
            emoji_counts.update(list(emoji_str))
    
    common_emojis = [emoji for emoji, count in emoji_counts.most_common(max_vocab_size - 2)]
    emoji_vocab = ["<PAD>", "<UNK>"] + common_emojis
    emoji_to_id = {emoji: idx for idx, emoji in enumerate(emoji_vocab)}
    
    print(f"Emoji词汇表大小: {len(emoji_vocab)} (基于全量数据)")
    print(f"  - 特殊符号: 2 (<PAD>, <UNK>)")
    print(f"  - 有效emoji: {len(common_emojis)}")
    
    return emoji_vocab, emoji_to_id


def load_pretrained_emoji_weights(emoji_vocab, emoji2vec_path, embedding_dim=300):
    """
    加载预训练的emoji2vec权重矩阵
    """
    if not os.path.exists(emoji2vec_path):
        raise FileNotFoundError(f"emoji2vec.bin未找到: {emoji2vec_path}")
    
    print(f"\n===== 加载预训练Emoji权重 =====")
    print(f"正在加载emoji2vec模型: {emoji2vec_path}")
    e2v_model = gsm.KeyedVectors.load_word2vec_format(emoji2vec_path, binary=True)
    print(f"加载完成，共 {len(e2v_model.index_to_key)} 个emoji向量")
    
    weights = np.zeros((len(emoji_vocab), embedding_dim), dtype=np.float32)
    found_count = 0
    
    for idx, emoji in enumerate(emoji_vocab):
        if emoji in ["<PAD>", "<UNK>"]:
            continue
        if emoji in e2v_model:
            weights[idx] = e2v_model[emoji]
            found_count += 1
        else:
            weights[idx] = np.random.uniform(-2.65, 2.58, embedding_dim).astype(np.float32)
    
    print(f"权重矩阵构建完成: {weights.shape}")
    print(f"  - 预训练向量: {found_count}/{len(emoji_vocab)-2}")
    print(f"  - 随机初始化: {len(emoji_vocab)-2-found_count}/{len(emoji_vocab)-2}")
    
    return weights
