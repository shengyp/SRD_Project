"""
Emocc模型推理服务
基于 BERT + Emoji 双模态层次融合模型进行自杀风险检测
支持输出每个帖子的注意力分数
"""
import os
import sys
import json
import pickle
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path
from dataclasses import dataclass

# 添加Emocc模型路径
_EOCC_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "Emocc"
_EMOCC_MODEL_PATH = _EOCC_ROOT / "Emocc_model"
_EMOCC_DATA_PATH = _EOCC_ROOT / "data"

sys.path.insert(0, str(_EOCC_ROOT))
sys.path.insert(0, str(_EMOCC_MODEL_PATH))

# 导入Emocc模型组件
try:
    from Emocc_model.model import (
        TemporalAttention,
        AdaptiveGateFusion,
        MultiLayerPerceptron,
        GlobalSelfAttention,
        BertEmojiModel
    )
    from Emocc_model.utils.emoji_utils import get_emoji_vocabulary, load_pretrained_emoji_weights
except ImportError as e:
    print(f"[EmoccService] 导入Emocc模型失败: {e}")
    BertEmojiModel = None
    get_emoji_vocabulary = None
    load_pretrained_emoji_weights = None


@dataclass
class EmoccInferenceResult:
    """Emocc推理结果"""
    user_hash: str
    risk_level: str  # high/medium/low
    risk_score: float  # 0-1
    risk_class: int  # 0-4 五分类
    confidence: float
    post_attention_scores: List[Dict[str, Any]]  # 每个帖子的注意力分数
    model_info: Dict[str, Any]


@dataclass
class ModelArgs:
    """模型参数"""
    dropout: float = 0.5
    gru_size: int = 128
    class_num: int = 5


class GlobalSelfAttentionWithScores(nn.Module):
    """
    扩展的GlobalSelfAttention，输出每个帖子的注意力分数
    """
    def __init__(self, input_dim, hidden_dim=None):
        super(GlobalSelfAttentionWithScores, self).__init__()
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim or input_dim

        self.W_Q = nn.Linear(input_dim, self.hidden_dim)
        self.W_K = nn.Linear(input_dim, self.hidden_dim)
        self.W_V = nn.Linear(input_dim, self.hidden_dim)
        self.scale = torch.sqrt(torch.tensor(self.hidden_dim, dtype=torch.float32))

        self._init_weights()

    def _init_weights(self):
        nn.init.xavier_uniform_(self.W_Q.weight)
        nn.init.xavier_uniform_(self.W_K.weight)
        nn.init.xavier_uniform_(self.W_V.weight)
        nn.init.zeros_(self.W_Q.bias)
        nn.init.zeros_(self.W_K.bias)
        nn.init.zeros_(self.W_V.bias)

    def forward(self, x, mask=None, return_scores=False):
        B, T, d = x.size()

        Q = self.W_Q(x)
        K = self.W_K(x)
        V = self.W_V(x)

        attn_scores = torch.matmul(Q, K.transpose(-2, -1)) / self.scale

        if mask is not None:
            attn_mask = mask.unsqueeze(1)
            attn_scores = attn_scores.masked_fill(attn_mask == 0, -1e9)

        attn_weights = F.softmax(attn_scores, dim=-1)
        V_common = torch.matmul(attn_weights, V)

        if mask is not None:
            mask_float = mask.unsqueeze(-1).type_as(V_common)
            V_common = V_common * mask_float

        V_common = V_common.sum(dim=1)
        
        # 返回注意力分数用于分析
        if return_scores:
            # attn_weights: (B, T, T) - 每个帖子对所有帖子的注意力
            # 我们取对角线元素作为每个帖子自己的重要性权重
            post_scores = torch.diagonal(attn_weights, dim1=1, dim2=2)  # (B, T)
            return V_common, post_scores
        
        return V_common


class BertEmojiModelWithAttention(nn.Module):
    """
    扩展的BertEmojiModel，支持输出每个帖子的注意力分数
    
    架构流程：
    1. Text Encoding Layer (GRU1): BERT嵌入(768维) → Post-level BiGRU1(768 → 2H)
    2. Emoji Fusion Layer: GRU1输出(2H) + Emoji均值池化(300维) → 拼接(2H+300维)
    3. Feature Extraction: GlobalSelfAttention 计算每个帖子的重要性权重
    4. 输出: 分类logits + 帖子注意力分数
    """
    def __init__(self, args, emoji_vocab_size, device, 
                 emoji_weights=None, is_pretrain_emoji=False):
        super(BertEmojiModelWithAttention, self).__init__()
        self.args = args
        self.device = device
        self.dropout = args.dropout
        self.gru_size = args.gru_size
        self.class_num = args.class_num
        self.bert_dim = 768
        self.emoji_dim = 300
        
        if is_pretrain_emoji and emoji_weights is not None:
            self.emoji_embed = nn.Embedding.from_pretrained(emoji_weights, freeze=False)
        else:
            self.emoji_embed = nn.Embedding(emoji_vocab_size, self.emoji_dim)
        
        self.emoji_embed_drop = nn.Dropout(args.dropout)
        
        self.gru1 = nn.GRU(
            input_size=self.bert_dim,
            hidden_size=self.gru_size,
            num_layers=1,
            bidirectional=True,
            batch_first=True
        )
        self.gru1_drop = nn.Dropout(args.dropout)
        
        # 使用支持注意力分数输出的GlobalSelfAttention
        self.global_attention = GlobalSelfAttentionWithScores(
            input_dim=2 * self.gru_size + self.emoji_dim,
            hidden_dim=2 * self.gru_size
        )
        
        self.adaptive_gate_fusion = AdaptiveGateFusion(2 * self.gru_size)
        
        self.class_fc = MultiLayerPerceptron(
            input_dim=2 * self.gru_size,
            embed_dims=[2 * self.gru_size, self.gru_size, self.gru_size // 2],
            dropout=self.dropout,
            class_num=self.class_num
        )
        
        self._init_weights()
    
    def _init_weights(self):
        for name, param in self.gru1.named_parameters():
            if "weight" in name:
                nn.init.xavier_uniform_(param)

    def forward(self, bert_embeddings, emoji_ids, post_masks, emoji_masks, return_attention=False):
        """
        Args:
            bert_embeddings: (B, T, 768) BERT嵌入
            emoji_ids: (B, T, E) Emoji ID序列
            post_masks: (B, T) 帖子有效mask
            emoji_masks: (B, T, E) Emoji有效mask
            return_attention: 是否返回每个帖子的注意力分数
        
        Returns:
            如果 return_attention=True: (logits, attention_scores)
            否则: logits
        """
        import torch.nn.functional as F
        
        B, T, _ = bert_embeddings.size()
        
        post_lengths = post_masks.sum(dim=1).cpu()
        non_zero_indices = (post_lengths > 0).nonzero(as_tuple=True)[0]
        if len(non_zero_indices) == 0:
            if return_attention:
                return torch.zeros(B, self.class_num, device=self.device), torch.zeros(B, T, device=self.device)
            return torch.zeros(B, self.class_num, device=self.device)
        
        valid_bert = bert_embeddings[non_zero_indices]
        valid_lengths = post_lengths[non_zero_indices]
        
        packed_bert = nn.utils.rnn.pack_padded_sequence(
            valid_bert, valid_lengths, batch_first=True, enforce_sorted=False
        )
        gru1_output, _ = self.gru1(packed_bert)
        gru1_output, _ = nn.utils.rnn.pad_packed_sequence(gru1_output, batch_first=True)
        gru1_output = self.gru1_drop(gru1_output)
        
        emoji_embeds = self.emoji_embed(emoji_ids)
        emoji_embeds = self.emoji_embed_drop(emoji_embeds)
        
        emoji_mask_expanded = emoji_masks.unsqueeze(-1).float()
        emoji_embeds_masked = emoji_embeds * emoji_mask_expanded
        emoji_counts = emoji_masks.sum(dim=-1, keepdim=True).clamp(min=1)
        emoji_mean = emoji_embeds_masked.sum(dim=2) / emoji_counts
        
        max_len = int(valid_lengths.max().item())
        if max_len <= 0:
            max_len = 1
        valid_emoji = emoji_mean[non_zero_indices][:, :max_len, :]
        
        fused_features = torch.cat([gru1_output, valid_emoji], dim=-1)
        
        valid_post_masks = post_masks[non_zero_indices][:, :max_len]
        
        last_indices = (valid_post_masks.cumsum(dim=1) == valid_post_masks.sum(dim=1, keepdim=True)).float()
        V_short_valid = (gru1_output * last_indices.unsqueeze(-1)).sum(dim=1)
        
        # 获取注意力分数
        V_common_valid, post_attn_scores_valid = self.global_attention(
            fused_features, mask=valid_post_masks, return_scores=True
        )
        
        V_short = torch.zeros(B, 2 * self.gru_size, device=self.device)
        V_short[non_zero_indices] = V_short_valid
        
        V_common = torch.zeros(B, 2 * self.gru_size, device=self.device)
        V_common[non_zero_indices] = V_common_valid
        
        # 处理注意力分数
        post_attn_scores = torch.zeros(B, T, device=self.device)
        post_attn_scores[non_zero_indices, :post_attn_scores_valid.size(1)] = post_attn_scores_valid
        
        V_final = self.adaptive_gate_fusion(V_short, V_common)
        
        logits = self.class_fc(V_final)
        
        if return_attention:
            return logits, post_attn_scores
        return logits


class EmoccInferenceService:
    """
    Emocc模型推理服务
    加载预训练模型，对用户帖子进行自杀风险检测
    """
    
    # 五分类到风险等级映射
    CLASS_TO_RISK = {
        0: ("low", 0.1),
        1: ("low", 0.3),
        2: ("medium", 0.5),
        3: ("medium", 0.7),
        4: ("high", 0.9)
    }
    
    def __init__(self):
        self.model = None
        self.emoji_to_id = None
        self.device = torch.device('cpu')
        self.is_loaded = False
        self.model_config = None
        
    def _get_paths(self) -> Tuple[Path, Path, Path]:
        """获取模型和数据路径"""
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        emocc_root = project_root / "Emocc"
        
        # 查找模型权重文件
        model_paths = [
            emocc_root / "Emocc_model" / "checkpoints" / "emocc_model.pth",
            emocc_root / "Emocc_model" / "checkpoints" / "best_model.pth",
        ]
        
        model_path = None
        for p in model_paths:
            if p.exists():
                model_path = p
                break
        
        # 查找BERT嵌入文件
        dataset_root = project_root / "datasets"
        bert_paths = [
            dataset_root / "reddit" / "reddit_500_bert_embeddings.pkl",
            emocc_root / "data" / "reddit_500_bert_embeddings.pkl",
        ]
        
        bert_path = None
        for p in bert_paths:
            if p.exists():
                bert_path = p
                break
        
        # Emoji CSV（从Emocc/data目录）
        emoji_csv_path = emocc_root / "data" / "reddit_500_emoji.csv"
        
        # emoji2vec 预训练向量路径
        emoji2vec_path = emocc_root / "pre-trained" / "emoji2vec.bin"

        return model_path, bert_path, emoji_csv_path, emoji2vec_path
    
    def load_model(self, model_path: Optional[str] = None, use_pretrained_emoji: bool = True) -> bool:
        """
        加载Emocc预训练模型
        
        Args:
            model_path: 模型权重路径，默认从Emocc目录查找
            use_pretrained_emoji: 是否使用预训练的emoji2vec向量（必须与训练时一致）
        
        Returns:
            是否加载成功
        """
        if BertEmojiModel is None:
            print("[EmoccService] Emocc模型未正确导入")
            return False
            
        try:
            # 确定路径
            if model_path:
                model_file = Path(model_path)
            else:
                paths = self._get_paths()
                model_file = paths[0]
            
            if model_file is None or not model_file.exists():
                print(f"[EmoccService] 模型文件未找到: {model_file}")
                return False
            
            # 构建词汇表
            paths = self._get_paths()
            emoji_csv = paths[2]
            if not emoji_csv.exists():
                print(f"[EmoccService] Emoji CSV未找到: {emoji_csv}")
                return False
            
            print(f"[EmoccService] 构建Emoji词汇表...")
            emoji_vocab, self.emoji_to_id = get_emoji_vocabulary(str(emoji_csv))
            
            # 加载预训练的emoji2vec向量（与训练时保持一致）
            emoji_weights = None
            emoji2vec_path = paths[3]
            if use_pretrained_emoji and emoji2vec_path.exists() and load_pretrained_emoji_weights is not None:
                print(f"[EmoccService] 加载预训练emoji2vec向量: {emoji2vec_path}")
                emoji_weights_np = load_pretrained_emoji_weights(
                    emoji_vocab, 
                    str(emoji2vec_path), 
                    embedding_dim=300
                )
                emoji_weights = torch.FloatTensor(emoji_weights_np)
            
            # 创建模型
            args = ModelArgs(
                dropout=0.5,
                gru_size=128,
                class_num=5
            )
            
            print(f"[EmoccService] 创建模型...")
            self.model = BertEmojiModelWithAttention(
                args=args,
                emoji_vocab_size=len(emoji_vocab),
                device=self.device,
                emoji_weights=emoji_weights,
                is_pretrain_emoji=use_pretrained_emoji and emoji_weights is not None
            )
            
            # 加载预训练权重
            print(f"[EmoccService] 加载权重: {model_file}")
            checkpoint = torch.load(model_file, map_location=self.device)
            
            # 处理不同的checkpoint格式
            if 'model_state_dict' in checkpoint:
                state_dict = checkpoint['model_state_dict']
            else:
                state_dict = checkpoint
            
            self.model.load_state_dict(state_dict, strict=False)
            self.model.to(self.device)
            self.model.eval()
            
            self.model_config = {
                'model_path': str(model_file),
                'vocab_size': len(emoji_vocab),
                'emoji_csv': str(emoji_csv),
                'emoji2vec_path': str(emoji2vec_path) if use_pretrained_emoji else None,
                'use_pretrained_emoji': use_pretrained_emoji and emoji_weights is not None
            }
            
            self.is_loaded = True
            print(f"[EmoccService] 模型加载成功!")
            return True
            
        except Exception as e:
            print(f"[EmoccService] 模型加载失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def predict_single_user(
        self,
        user_hash: str,
        bert_embeddings: np.ndarray,
        emoji_sequences: List[List[str]],
        post_texts: Optional[List[str]] = None
    ) -> EmoccInferenceResult:
        """
        对单个用户进行风险预测
        
        Args:
            user_hash: 用户哈希
            bert_embeddings: (T, 768) BERT嵌入数组
            emoji_sequences: 每个帖子的emoji列表
            post_texts: 每个帖子的文本（用于返回注意力分数对应的帖子）
        
        Returns:
            EmoccInferenceResult
        """
        if not self.is_loaded or self.model is None:
            return EmoccInferenceResult(
                user_hash=user_hash,
                risk_level="unknown",
                risk_score=0.0,
                risk_class=-1,
                confidence=0.0,
                post_attention_scores=[],
                model_info={"error": "模型未加载"}
            )
        
        try:
            import torch.nn.functional as F
            
            B, T, bert_dim = 1, bert_embeddings.shape[0], bert_embeddings.shape[1]
            
            # 准备数据
            max_emojis = 10
            max_posts = min(50, T)
            
            # BERT embeddings
            bert_embeds = torch.zeros((B, max_posts, bert_dim), dtype=torch.float32)
            post_mask = torch.zeros((B, max_posts), dtype=torch.float32)
            
            for i in range(min(T, max_posts)):
                bert_embeds[0, i] = torch.tensor(bert_embeddings[i], dtype=torch.float32)
                post_mask[0, i] = 1.0
            
            # Emoji处理
            emoji_ids = torch.zeros((B, max_posts, max_emojis), dtype=torch.int64)
            emoji_mask = torch.zeros((B, max_posts, max_emojis), dtype=torch.float32)
            
            for i in range(min(T, max_posts)):
                emojis = emoji_sequences[i] if i < len(emoji_sequences) else []
                for j, emoji in enumerate(emojis[:max_emojis]):
                    emoji_id = self.emoji_to_id.get(emoji, self.emoji_to_id.get("<UNK>", 1))
                    emoji_ids[0, i, j] = emoji_id
                    emoji_mask[0, i, j] = 1.0
            
            # 移动到设备
            bert_embeds = bert_embeds.to(self.device)
            emoji_ids = emoji_ids.to(self.device)
            post_mask = post_mask.to(self.device)
            emoji_mask = emoji_mask.to(self.device)
            
            # 推理
            with torch.no_grad():
                logits, attention_scores = self.model(
                    bert_embeds, emoji_ids, post_mask, emoji_mask, return_attention=True
                )
            
            # 处理结果
            probs = F.softmax(logits, dim=-1)
            pred_class = torch.argmax(probs, dim=-1).item()
            confidence = probs[0, pred_class].item()
            
            risk_level, risk_score = self.CLASS_TO_RISK.get(pred_class, ("medium", 0.5))
            
            # 处理注意力分数
            attn_np = attention_scores[0].cpu().numpy()
            post_attention_scores = []
            
            for i in range(min(T, max_posts)):
                if post_texts and i < len(post_texts):
                    text_preview = post_texts[i][:100] + "..." if len(post_texts[i]) > 100 else post_texts[i]
                else:
                    text_preview = f"Post {i+1}"
                
                post_attention_scores.append({
                    "post_index": i,
                    "attention_score": float(attn_np[i]),
                    "text_preview": text_preview,
                    "emoji_count": len(emoji_sequences[i]) if i < len(emoji_sequences) else 0
                })
            
            # 按注意力分数排序
            post_attention_scores.sort(key=lambda x: x["attention_score"], reverse=True)
            
            return EmoccInferenceResult(
                user_hash=user_hash,
                risk_level=risk_level,
                risk_score=risk_score,
                risk_class=pred_class,
                confidence=confidence,
                post_attention_scores=post_attention_scores,
                model_info={
                    "model_type": "emocc",
                    "total_posts": T,
                    "analyzed_posts": min(T, max_posts),
                    "class_probs": probs[0].cpu().tolist()
                }
            )
            
        except Exception as e:
            print(f"[EmoccService] 推理失败: {e}")
            import traceback
            traceback.print_exc()
            return EmoccInferenceResult(
                user_hash=user_hash,
                risk_level="unknown",
                risk_score=0.0,
                risk_class=-1,
                confidence=0.0,
                post_attention_scores=[],
                model_info={"error": str(e)}
            )
    
    def predict_batch(
        self,
        user_data_list: List[Dict]
    ) -> List[EmoccInferenceResult]:
        """
        批量预测
        
        Args:
            user_data_list: [{user_hash, bert_embeddings, emoji_sequences, post_texts}, ...]
        
        Returns:
            结果列表
        """
        results = []
        for user_data in user_data_list:
            result = self.predict_single_user(
                user_hash=user_data.get("user_hash", ""),
                bert_embeddings=user_data.get("bert_embeddings"),
                emoji_sequences=user_data.get("emoji_sequences", []),
                post_texts=user_data.get("post_texts")
            )
            results.append(result)
        return results


# 全局单例
_emocc_service: Optional[EmoccInferenceService] = None


def get_emocc_service() -> EmoccInferenceService:
    """获取全局Emocc推理服务单例"""
    global _emocc_service
    if _emocc_service is None:
        _emocc_service = EmoccInferenceService()
    return _emocc_service


def load_emocc_model(model_path: Optional[str] = None, use_pretrained_emoji: bool = True) -> bool:
    """加载Emocc模型
    
    Args:
        model_path: 模型权重路径，默认从Emocc目录查找
        use_pretrained_emoji: 是否使用预训练的emoji2vec向量（必须与训练时一致）
    """
    service = get_emocc_service()
    return service.load_model(model_path, use_pretrained_emoji)
