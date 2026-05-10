"""
数据集：BertEmojiDataset和相关collate函数
"""
import torch
from torch.utils.data import Dataset
import numpy as np
import pandas as pd
import pickle


class BertEmojiDataset(Dataset):
    """
    加载BERT嵌入(768维) + Emoji序列的数据集
    新版本：一行一个用户，一个帖子
    """
    def __init__(self, bert_pkl_path, emoji_csv_path, emoji_to_id,
                 max_posts=1, max_emojis_per_post=10):
        """
        Args:
            bert_pkl_path: BERT嵌入pkl文件路径
            emoji_csv_path: emoji序列CSV路径
            emoji_to_id: Dict, emoji词汇表
            max_posts: 固定为1（每个样本只有一个帖子）
            max_emojis_per_post: 每个帖子最大emoji数
        """
        self.emoji_to_id = emoji_to_id
        self.max_posts = 1
        self.max_emojis_per_post = max_emojis_per_post
        self.EMOJI_PAD_ID = emoji_to_id["<PAD>"]
        self.EMOJI_UNK_ID = emoji_to_id["<UNK>"]
        
        with open(bert_pkl_path, 'rb') as f:
            bert_data = pickle.load(f)
        
        if isinstance(bert_data, dict):
            dataframe = bert_data['dataframe']
            bert_embeddings = bert_data['bert_embeddings']
        else:
            raise ValueError(f"Unexpected pickle format: {type(bert_data)}")
        
        emoji_df = pd.read_csv(emoji_csv_path)
        
        self.samples = []
        for idx in range(len(dataframe)):
            label = int(dataframe.iloc[idx]['Label'])
            
            token_embeddings = bert_embeddings[idx]
            sentence_embedding = np.mean(token_embeddings, axis=0).astype(np.float32)
            
            if idx < len(emoji_df):
                emoji_str = str(emoji_df.iloc[idx]['Post']) if pd.notna(emoji_df.iloc[idx]['Post']) else ''
            else:
                emoji_str = ''
            
            post_embeddings = np.zeros((1, 768), dtype=np.float32)
            post_emoji_ids = np.zeros((1, max_emojis_per_post), dtype=np.int64)
            post_mask = np.ones(1, dtype=np.int64)
            emoji_mask = np.zeros((1, max_emojis_per_post), dtype=np.int64)
            
            post_embeddings[0] = sentence_embedding
            
            if emoji_str and emoji_str != 'nan':
                emoji_list = list(emoji_str)[:max_emojis_per_post]
                emoji_ids = [emoji_to_id.get(e, self.EMOJI_UNK_ID) for e in emoji_list]
                
                for j, eid in enumerate(emoji_ids):
                    post_emoji_ids[0, j] = eid
                    emoji_mask[0, j] = 1
            
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
