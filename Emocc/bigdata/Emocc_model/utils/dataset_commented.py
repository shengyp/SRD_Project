"""
数据集：BertEmojiDataset和相关collate函数
（本文件定义了用于多模态模型的数据集加载类，负责将文本的BERT特征和emoji序列组合起来）
"""
import torch  # PyTorch深度学习框架，用于构建张量(Tensor)
from torch.utils.data import Dataset  # PyTorch的数据集基类，自定义数据集必须继承它
import numpy as np  # NumPy库，用于高效的数组和矩阵运算（科学计算基础库）
import pandas as pd  # Pandas库，用于处理表格数据（如读取CSV文件）
import pickle  # Python标准库，用于读写二进制文件（这里用于加载预处理好的BERT特征）


class BertEmojiDataset(Dataset):
    """
    加载BERT嵌入(768维) + Emoji序列的数据集
    
    核心功能：
    将用户的文本特征（已经提取好的BERT向量）和该用户发帖中使用的微表情（Emoji）序列结合起来。
    每个样本代表一个用户，包含该用户多条帖子的信息。
    """
    def __init__(self, bert_pkl_path, emoji_csv_path, emoji_to_id,
                 max_posts=200, max_emojis_per_post=10):
        """
        初始化数据集
        
        Args:
            bert_pkl_path: BERT嵌入pkl文件路径
                          (这个文件通常包含一个大的字典，里面有所有用户的文本特征向量)
            emoji_csv_path: emoji序列CSV路径
                          (这个文件记录了每个用户每条帖子用了哪些emoji)
            emoji_to_id: Dict, emoji词汇表
                          (字典结构：{"😀": 1, "😂": 2, ...}，将表情符号转为数字ID)
            max_posts: 最大帖子数（默认200）
                          (每个用户只取前200条帖子，多了截断，少了补零，保证所有样本维度一致)
            max_emojis_per_post: 每个帖子最大emoji数（默认10）
                          (每条帖子只取前10个emoji，同上，为了维度对齐)
        """
        self.emoji_to_id = emoji_to_id
        self.max_posts = max_posts
        self.max_emojis_per_post = max_emojis_per_post
        
        # 获取特殊标记的ID：PAD用于补零，UNK用于未知的表情
        self.EMOJI_PAD_ID = emoji_to_id["<PAD>"]
        self.EMOJI_UNK_ID = emoji_to_id["<UNK>"]
        
        # 1. 加载BERT特征数据
        # 使用pickle读取二进制文件，这里面存的是之前跑BERT模型提取出来的句向量
        with open(bert_pkl_path, 'rb') as f:
            bert_data = pickle.load(f)
        
        # 提取bert嵌入矩阵和对应的元数据dataframe
        # bert_embeddings 通常是一个大矩阵 [用户数, 帖子数, 768]
        bert_embeddings = bert_data['bert_embeddings']
        df = bert_data['dataframe']
        
        # 2. 加载Emoji数据
        # 读取CSV文件，包含 user_id 和 post_sequence (表情序列字符串)
        emoji_df = pd.read_csv(emoji_csv_path)
        
        self.samples = []  # 用于存储最终处理好的样本列表
        
        # 3. 遍历每个用户，匹配并组装数据
        for idx in range(len(df)):
            # 获取当前用户的ID和标签（是否自杀风险，通常0或1）
            user_id = int(df.iloc[idx]['user_id'])
            label = int(df.iloc[idx]['suicide_risk'])
            
            # 获取该用户的BERT嵌入矩阵 [最大帖子数, 768]
            # 注意：这里的 embeddings 可能包含很多全0行（如果该用户帖子数少）
            embeddings = bert_embeddings[idx]
            
            # 在emoji数据表中查找该用户的数据
            emoji_row = emoji_df[emoji_df['user_id'] == user_id]
            
            # 处理Emoji序列数据
            if len(emoji_row) == 0:
                # 如果没找到该用户的emoji记录，就设为空列表
                emoji_posts = []
            else:
                # 取出该用户的emoji序列字符串，格式可能是 "😀,😂,😭 | 🙏,💪" 这种用逗号或特定符分隔的
                # 这里假设 post_sequence 列是用逗号分隔不同帖子的emoji串
                emoji_str = str(emoji_row.iloc[0]['post_sequence'])
                
                # 判空检查：确保字符串不是 nan 且不为空
                if emoji_str and emoji_str != 'nan' and pd.notna(emoji_str):
                    # 将长字符串分割成列表，每个元素对应一条帖子的emoji串
                    emoji_posts = [s.strip() for s in emoji_str.split(',')]
                else:
                    emoji_posts = []
            
            # 计算有效的帖子数量
            # embeddings != 0 会生成布尔矩阵，any(axis=-1) 只要某一行不全为0，就认为是有效帖子
            valid_mask = (embeddings != 0).any(axis=-1)
            num_posts = int(valid_mask.sum())
            
            # --- 数据对齐逻辑 Start ---
            # BERT数据里的帖子数 (num_posts) 和 Emoji数据里的帖子数 (len(emoji_posts)) 可能不一致
            # 必须让它们一一对应
            
            if num_posts > len(emoji_posts):
                # 如果BERT帖子多，说明Emoji数据缺了一些（可能没提取到），用空字符串补齐
                emoji_posts.extend([''] * (num_posts - len(emoji_posts)))
            elif num_posts < len(emoji_posts):
                # 如果BERT帖子少，说明Emoji数据多余了，截断Emoji列表以匹配BERT
                emoji_posts = emoji_posts[:num_posts]
            
            # --- 数据对齐逻辑 End ---
            
            # --- 全局最大长度截断 ---
            # 如果实际有效帖子数超过了我们设定的 max_posts (例如200)
            if num_posts > max_posts:
                embeddings = embeddings[:max_posts]  # 截断BERT嵌入
                emoji_posts = emoji_posts[:max_posts] # 截断emoji列表
                num_posts = max_posts # 更新有效帖子数
            
            # --- 初始化最终的张量容器 ---
            # 使用 numpy 创建全0数组，类似于"画布"，把数据填进去
            # post_embeddings: [200, 768] - 存文本向量
            post_embeddings = np.zeros((max_posts, 768), dtype=np.float32)
            # post_emoji_ids: [200, 10] - 存每条帖子的emoji id序列
            post_emoji_ids = np.zeros((max_posts, max_emojis_per_post), dtype=np.int64)
            # post_mask: [200] - 标记哪些位置是真实帖子 (1)，哪些是补零的 (0)
            post_mask = np.zeros(max_posts, dtype=np.int64)
            # emoji_mask: [200, 10] - 标记每个emoji位置是否真实存在
            emoji_mask = np.zeros((max_posts, max_emojis_per_post), dtype=np.int64)
            
            # 填数据
            for i in range(num_posts):
                # 1. 填充BERT向量
                post_embeddings[i] = embeddings[i]
                post_mask[i] = 1 # 标记该行有效
                
                # 2. 处理Emoji
                # 获取第 i 条帖子的emoji字符串
                emoji_str = emoji_posts[i] if i < len(emoji_posts) else ''
                # 将字符串转为字符列表，并截断到最大数量 (例如10个)
                emoji_list = list(emoji_str)[:max_emojis_per_post]
                # 查表转换：字符 -> ID，找不到的用 UNK 替代
                emoji_ids = [emoji_to_id.get(e, self.EMOJI_UNK_ID) for e in emoji_list]
                
                # 填充具体的emoji ID到矩阵中
                for j, eid in enumerate(emoji_ids):
                    post_emoji_ids[i, j] = eid
                    emoji_mask[i, j] = 1 # 标记该emoji有效
            
            # 将处理好的单样本数据加入列表
            self.samples.append({
                'bert_embeddings': post_embeddings, # (max_posts, 768)
                'emoji_ids': post_emoji_ids,        # (max_posts, max_emojis_per_post)
                'post_mask': post_mask,             # (max_posts,)
                'emoji_mask': emoji_mask,           # (max_posts, max_emojis_per_post)
                'label': label,                     # 标量：0 或 1
                'user': user_id                     # 标量：用户ID
            })
    
    def __len__(self):
        """返回数据集总样本数"""
        return len(self.samples)
    
    def __getitem__(self, idx):
        """根据索引获取单个样本"""
        return self.samples[idx]


def collate_fn_bert_emoji(batch):
    """
    BERT+Emoji 批处理函数 (Collate Function)
    
    这个函数的作用是：
    DataLoader 在取数据时，会取出一组样本（比如 32 个）。
    这个函数负责把这 32 个独立的样本字典，打包成一个大的 Batch 张量。
    类似于把 32 个积木块拼成一个整齐的积木箱。
    """
    if not batch:
        raise ValueError("Batch cannot be empty")
    
    # 获取 Batch 大小（有多少个样本）
    batch_size = len(batch)
    example = batch[0] # 取出第一个样本用来查看维度信息
    
    # 获取维度常量
    max_posts = example['bert_embeddings'].shape[0] # 例如 200
    bert_dim = example['bert_embeddings'].shape[1]  # 例如 768
    max_emojis = example['emoji_ids'].shape[1]      # 例如 10
    
    # 初始化 Batch 容器（全0张量）
    # 维度通常是 [batch_size, ...]
    bert_embeddings = torch.zeros((batch_size, max_posts, bert_dim), dtype=torch.float32)
    emoji_ids = torch.zeros((batch_size, max_posts, max_emojis), dtype=torch.int64)
    post_masks = torch.zeros((batch_size, max_posts), dtype=torch.float32)
    emoji_masks = torch.zeros((batch_size, max_posts, max_emojis), dtype=torch.float32)
    labels = torch.zeros(batch_size, dtype=torch.int64)
    
    # 遍历列表中的每个样本，放入大容器的对应位置
    for i, sample in enumerate(batch):
        # 逐个赋值，并自动转换为 Tensor 格式
        bert_embeddings[i] = torch.tensor(sample['bert_embeddings'], dtype=torch.float32)
        emoji_ids[i] = torch.tensor(sample['emoji_ids'], dtype=torch.int64)
        post_masks[i] = torch.tensor(sample['post_mask'], dtype=torch.float32)
        emoji_masks[i] = torch.tensor(sample['emoji_mask'], dtype=torch.float32)
        labels[i] = torch.tensor(sample['label'], dtype=torch.int64)
    
    # 返回打包好的 Batch 数据，可以直接喂给模型
    return bert_embeddings, emoji_ids, post_masks, emoji_masks, labels
