"""
文件说明：
这是 Emocc_model/utils/dataset.py 的详细注释版副本。
包含了逐行代码解释、数据维度说明和实际数据示例。
"""

# 导入必要的库
import torch  # 导入 PyTorch 深度学习框架
from torch.utils.data import Dataset  # 从 PyTorch 导入 Dataset 基类，用于构建自定义数据集
import numpy as np  # 导入 NumPy 用于数值计算和数组操作
import pandas as pd  # 导入 Pandas 用于处理表格数据（如 CSV）
import pickle  # 导入 pickle 用于加载 .pkl 格式的序列化文件

# 定义一个新的数据集类 BertEmojiDataset，继承自 torch.utils.data.Dataset
class BertEmojiDataset(Dataset):
    """
    这个类的作用是加载处理过的数据，包括 BERT 的文本嵌入向量和 Emoji 表情序列。
    主要用于后续的模型训练。
    """
    
    # 初始化函数，在创建数据集对象时会自动调用
    def __init__(self, bert_pkl_path, emoji_csv_path, emoji_to_id,
                 max_posts=1, max_emojis_per_post=10):
        """
        Args (参数说明):
            bert_pkl_path: 存储了 BERT 向量的 .pkl 文件路径。
                           这个文件里有一个字典，包含 'dataframe' (表格数据) 和 'bert_embeddings' (很多个矩阵)。
            emoji_csv_path: 存储了原始帖子内容和表情的 .csv 文件路径。
            emoji_to_id: 一个字典，类似于词汇表。把表情符号映射成数字 ID。例如: {'😂': 1, '😭': 2, ...}
            max_posts: 每个样本包含的帖子数量，这里固定为 1。
            max_emojis_per_post: 每个帖子最多保留多少个表情符号（多余截断，不足补0）。
        """
        
        # 将传入的参数保存到类实例变量中，方便以后使用
        self.emoji_to_id = emoji_to_id  # 保存表情词汇表
        self.max_posts = 1  # 设定每个样本只处理 1 个帖子
        self.max_emojis_per_post = max_emojis_per_post  # 保存每个帖子的最大表情数 (例如 10)
        
        # 从词汇表中获取特殊标记的 ID
        # <PAD>: Padding，用于填充，通常是 0
        self.EMOJI_PAD_ID = emoji_to_id["<PAD>"]  
        # <UNK>: Unknown，用于表示没见过的表情
        self.EMOJI_UNK_ID = emoji_to_id["<UNK>"]  
        
        # 使用 'rb' (二进制只读) 模式打开 BERT 的 .pkl 文件
        with open(bert_pkl_path, 'rb') as f:
            # 使用 pickle.load 加载文件内容到内存
            # 这里的 bert_data 是一个字典
            bert_data = pickle.load(f)
        
        # 检查加载的数据是不是字典格式，这是一种安全检查
        if isinstance(bert_data, dict):
            # 取出 'dataframe' 部分，这是一个 Pandas DataFrame 表格
            # 里面通常包含标签(Label)等信息
            dataframe = bert_data['dataframe']
            
            # 取出 'bert_embeddings' 部分，这是一个列表
            # 列表里每个元素是一个 numpy 数组，代表一句话的 BERT 向量
            # 结构示例: [数组1, 数组2, ...]，数组形状为 (序列长度, 768)
            bert_embeddings = bert_data['bert_embeddings']
        else:
            # 如果格式不对，抛出错误
            raise ValueError(f"Unexpected pickle format: {type(bert_data)}")
        
        # 使用 Pandas 读取 emoji 的 CSV 文件
        # 这个文件里有 'Post' (帖子内容) 和 'Label' (标签) 列
        emoji_df = pd.read_csv(emoji_csv_path)
        
        # 初始化一个空列表，用来存放处理好的最终样本
        self.samples = []
        
        # 开始遍历数据，idx 从 0 到 数据总长度-1
        # len(dataframe) 就是数据的总条数
        for idx in range(len(dataframe)):
            
            # --- 步骤 1: 获取情感标签 ---
            
            # 从 dataframe 的第 idx 行取出 'Label' 列的值
            # 并强制转换为整数 (int)，例如 0 或 1
            label = int(dataframe.iloc[idx]['Label'])
            
            # --- 步骤 2: 获取 BERT 文本向量 ---
            
            # 从 bert_embeddings 列表里取出第 idx 个文本的向量
            # 它的形状通常是 (Token数量, 768)。例如 (20, 768) 表示这句话有20个词，每个词由768维向量表示
            token_embeddings = bert_embeddings[idx]
            
            # 计算这句话的“平均向量”
            # axis=0 表示沿着 token 的方向求平均
            # 结果形状变为 (768,)，即用一个 768 维的向量代表整句话
            sentence_embedding = np.mean(token_embeddings, axis=0).astype(np.float32)
            
            # --- 步骤 3: 获取 Emoji 字符串 ---
            
            # 检查 idx 是否在这个 dataframe 的范围内 (防止越界)
            if idx < len(emoji_df):
                # 获取第 idx 行的 'Post' 列内容
                raw_post = emoji_df.iloc[idx]['Post']
                
                # 如果内容不是 NaN (非空)，就把它转成字符串；否则设为空字符串 ''
                # 示例: raw_post 可能是 "今天很开心😊"
                emoji_str = str(raw_post) if pd.notna(raw_post) else ''
            else:
                # 越界情况设为空
                emoji_str = ''
            
            # --- 步骤 4: 初始化数据容器 (占位符) ---
            
            # 创建一个全零数组存放句子向量
            # 形状: (1, 768)，因为 max_posts=1
            post_embeddings = np.zeros((1, 768), dtype=np.float32)
            
            # 创建一个全零数组存放表情 ID
            # 形状: (1, 10)，因为 max_emojis_per_post=10
            post_emoji_ids = np.zeros((1, max_emojis_per_post), dtype=np.int64)
            
            # 创建一个全一数组作为“帖子掩码”
            # 形状: (1,)。1 表示这个位置有帖子，0表示没有 (这里固定有1个帖子)
            post_mask = np.ones(1, dtype=np.int64)
            
            # 创建一个全零数组作为“表情掩码”
            # 形状: (1, 10)。用来标记哪些位置是真的表情，哪些是填充的 0
            emoji_mask = np.zeros((1, max_emojis_per_post), dtype=np.int64)
            
            # --- 步骤 5: 填充数据 ---
            
            # 把刚才计算的 sentence_embedding (768,) 填入 post_embeddings 的第 0 个位置
            post_embeddings[0] = sentence_embedding
            
            # 如果 emoji_str 有内容 且 不是字符串 'nan'
            if emoji_str and emoji_str != 'nan':
                # 将字符串转为字符列表，并只取前 max_emojis_per_post 个
                # 示例: 如果字符串是 "🤣🤣🤣" 且 max=10 -> ['🤣', '🤣', '🤣']
                # 如果字符串超长，就会被截断
                emoji_list = list(emoji_str)[:max_emojis_per_post]
                
                # 将表情字符转换为数字 ID
                # 遍历列表，如果在词表中找到就用对应的 ID，找不到就用 <UNK> 的 ID
                # 示例: ['🤣', '🤣'] -> [12, 12]
                emoji_ids = [emoji_to_id.get(e, self.EMOJI_UNK_ID) for e in emoji_list]
                
                # 将 ID 填入 post_emoji_ids 数组
                for j, eid in enumerate(emoji_ids):
                    post_emoji_ids[0, j] = eid  # 填入 ID
                    emoji_mask[0, j] = 1        # 对应的掩码位置设为 1，表示这里有真实数据
            
            # --- 步骤 6: 组装样本 ---
            
            # 将处理好的所有数据打包成一个字典
            sample = {
                'bert_embeddings': post_embeddings, # 形状: (1, 768)
                'emoji_ids': post_emoji_ids,        # 形状: (1, 10)
                'post_mask': post_mask,             # 形状: (1,)
                'emoji_mask': emoji_mask,           # 形状: (1, 10)
                'label': label                      # 标量: 0 或 1
            }
            
            # 将字典加入到 samples 列表中
            self.samples.append(sample)
    
    # 返回数据集的大小 (样本总数)
    def __len__(self):
        return len(self.samples)
    
    # 根据索引 idx 获取一个样本，DataLoader 需要这个函数
    def __getitem__(self, idx):
        return self.samples[idx]


# 定义 collate_fn 函数，用于 DataLoader 批量取数据
# batch 是一个列表，里面包含了 batch_size 个由 __getitem__ 返回的样本字典
def collate_fn_bert_emoji(batch):
    """
    BERT+Emoji 批处理函数。
    作用：把多个样本拼起来，变成一个大的 Tensor (张量)。
    """
    # 如果 batch 为空，抛出异常
    if not batch:
        raise ValueError("Batch cannot be empty")
    
    # 获取这个 batch 的大小，例如 32
    batch_size = len(batch)
    
    # 取出第一个样本，用来查看数据的维度
    example = batch[0]
    
    # 获取关键维度信息
    max_posts = example['bert_embeddings'].shape[0]  # 通常是 1
    bert_dim = example['bert_embeddings'].shape[1]   # 通常是 768
    max_emojis = example['emoji_ids'].shape[1]       # 通常是 10 (max_emojis_per_post)
    
    # --- 初始化 Batch 容器 (全 0 张量) ---
    
    # 存放 BERT 向量: 形状 (Batch数, 1, 768)
    bert_embeddings = torch.zeros((batch_size, max_posts, bert_dim), dtype=torch.float32)
    
    # 存放表情 ID: 形状 (Batch数, 1, 10)
    emoji_ids = torch.zeros((batch_size, max_posts, max_emojis), dtype=torch.int64)
    
    # 存放帖子掩码: 形状 (Batch数, 1)
    post_masks = torch.zeros((batch_size, max_posts), dtype=torch.float32)
    
    # 存放表情掩码: 形状 (Batch数, 1, 10)
    emoji_masks = torch.zeros((batch_size, max_posts, max_emojis), dtype=torch.float32)
    
    # 存放标签: 形状 (Batch数,)
    labels = torch.zeros(batch_size, dtype=torch.int64)
    
    # --- 填充数据 ---
    
    # 遍历 batch 中的每一个样本
    for i, sample in enumerate(batch):
        # 将 numpy 数组转换为 torch.Tensor，并填入对应位置 i
        bert_embeddings[i] = torch.tensor(sample['bert_embeddings'], dtype=torch.float32)
        emoji_ids[i] = torch.tensor(sample['emoji_ids'], dtype=torch.int64)
        post_masks[i] = torch.tensor(sample['post_mask'], dtype=torch.float32)
        emoji_masks[i] = torch.tensor(sample['emoji_mask'], dtype=torch.float32)
        labels[i] = torch.tensor(sample['label'], dtype=torch.int64)
    
    # 返回打包好的 Tensor，可以直接喂给模型
    return bert_embeddings, emoji_ids, post_masks, emoji_masks, labels
