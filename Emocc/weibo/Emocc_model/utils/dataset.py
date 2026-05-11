"""
数据集：BertEmojiDataset和相关collate函数
用于微博Emoji预测任务
"""
import torch
from torch.utils.data import Dataset
import numpy as np
import pandas as pd
import pickle


class BertEmojiDataset(Dataset):
    """
    加载BERT嵌入(768维) + Emoji序列的数据集
    
    数据格式：
    - bert_pkl: list[dict], 每个dict包含:
        - 'user_id': str
        - 'embeddings': list[np.ndarray], 每个元素是(768,)的帖子向量
        - 'label': int
    - emoji_csv: 包含列 user_id, emoji_sequence, label
      emoji_sequence格式: "微博1emoji,微博2emoji,微博3emoji,..."
    """
    def __init__(self, bert_pkl_path, emoji_csv_path, emoji_to_id,
                 max_posts=50, max_emojis_per_post=10):
        """
        Args:
            bert_pkl_path: BERT嵌入pkl文件路径
            emoji_csv_path: emoji序列CSV路径
            emoji_to_id: Dict, emoji词汇表
            max_posts: 每个用户最多帖子数
            max_emojis_per_post: 每个帖子最大emoji数
        """
        self.emoji_to_id = emoji_to_id
        self.max_posts = max_posts
        self.max_emojis_per_post = max_emojis_per_post
        self.EMOJI_PAD_ID = emoji_to_id.get("<PAD>", 0)
        self.EMOJI_UNK_ID = emoji_to_id.get("<UNK>", 1)
        
        # 加载BERT嵌入
        with open(bert_pkl_path, 'rb') as f:
            bert_data = pickle.load(f)
        
        # 加载emoji序列
        emoji_df = pd.read_csv(emoji_csv_path)
        
        # 验证数据格式
        if not isinstance(bert_data, list):
            raise ValueError(f"pkl应该是list格式，实际: {type(bert_data)}")
        
        if not {'user_id', 'emoji_sequence'}.issubset(set(emoji_df.columns)):
            raise ValueError(
                f"emoji_csv需要列 user_id, emoji_sequence; 实际列: {list(emoji_df.columns)}"
            )
        
        # 构建user_id -> emoji_sequence的映射
        emoji_map = {}
        for _, row in emoji_df.iterrows():
            uid = str(row['user_id'])
            seq = row['emoji_sequence']
            emoji_map[uid] = '' if pd.isna(seq) else str(seq)
        
        # 构建数据集
        self.samples = []
        for item in bert_data:
            if not isinstance(item, dict):
                raise ValueError(f"pkl列表中的元素应该是dict，实际: {type(item)}")
            
            uid = str(item.get('user_id', ''))
            label = int(item.get('label', 0))
            embeddings_list = item.get('embeddings', [])
            
            # 初始化输出数组
            post_embeddings = np.zeros((self.max_posts, 768), dtype=np.float32)
            post_emoji_ids = np.zeros((self.max_posts, max_emojis_per_post), dtype=np.int64)
            post_mask = np.zeros(self.max_posts, dtype=np.int64)
            emoji_mask = np.zeros((self.max_posts, max_emojis_per_post), dtype=np.int64)
            
            # 获取该用户的emoji序列（逗号分隔的多帖子）
            emoji_seq_str = emoji_map.get(uid, '')
            if emoji_seq_str:
                emoji_posts = emoji_seq_str.split(',')
            else:
                emoji_posts = []
            
            # 填充每个帖子
            n_posts = min(len(embeddings_list), self.max_posts)
            for p in range(n_posts):
                # BERT嵌入: (768,) -> 填入对应位置
                post_embedding = np.asarray(embeddings_list[p], dtype=np.float32)
                if post_embedding.shape != (768,):
                    raise ValueError(f"embedding应该是(768,)，实际: {post_embedding.shape}")
                post_embeddings[p] = post_embedding
                post_mask[p] = 1
                
                # Emoji序列: 第p个帖子对应第p个emoji子串
                emoji_str = emoji_posts[p] if p < len(emoji_posts) else ''
                if emoji_str and emoji_str != 'nan':
                    emoji_list = list(emoji_str)[:max_emojis_per_post]
                    emoji_ids = [emoji_to_id.get(e, self.EMOJI_UNK_ID) for e in emoji_list]
                    for j, eid in enumerate(emoji_ids):
                        post_emoji_ids[p, j] = eid
                        emoji_mask[p, j] = 1
            
            self.samples.append({
                'bert_embeddings': post_embeddings,
                'emoji_ids': post_emoji_ids,
                'post_mask': post_mask,
                'emoji_mask': emoji_mask,
                'label': label
            })
    
    def __len__(self):
        return len(self.samples)
    
    def __getitem__(self, idx):
        return self.samples[idx]


def collate_fn_bert_emoji(batch):
    """BERT+Emoji批处理函数"""
    if not batch:
        raise ValueError("Batch cannot be empty")
    
    batch_size = len(batch)
    example = batch[0]
    
    max_posts = example['bert_embeddings'].shape[0]
    bert_dim = example['bert_embeddings'].shape[1]
    max_emojis = example['emoji_ids'].shape[1]
    
    bert_embeddings = torch.zeros((batch_size, max_posts, bert_dim), dtype=torch.float32)
    emoji_ids = torch.zeros((batch_size, max_posts, max_emojis), dtype=torch.int64)
    post_masks = torch.zeros((batch_size, max_posts), dtype=torch.float32)
    emoji_masks = torch.zeros((batch_size, max_posts, max_emojis), dtype=torch.float32)
    labels = torch.zeros(batch_size, dtype=torch.int64)
    
    for i, sample in enumerate(batch):
        bert_embeddings[i] = torch.tensor(sample['bert_embeddings'], dtype=torch.float32)
        emoji_ids[i] = torch.tensor(sample['emoji_ids'], dtype=torch.int64)
        post_masks[i] = torch.tensor(sample['post_mask'], dtype=torch.float32)
        emoji_masks[i] = torch.tensor(sample['emoji_mask'], dtype=torch.float32)
        labels[i] = torch.tensor(sample['label'], dtype=torch.int64)
    
    return bert_embeddings, emoji_ids, post_masks, emoji_masks, labels
