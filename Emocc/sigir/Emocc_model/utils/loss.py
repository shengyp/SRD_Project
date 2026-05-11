"""
损失函数：有序分类损失和评估指标
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np


def true_metric_loss(true, no_of_classes, scale=1):
    """
    生成有序分类的软标签
    """
    batch_size = true.size(0)
    true = true.view(batch_size, 1)
    
    if not isinstance(true, torch.cuda.LongTensor):
        true = true.long().to(true.device)
    true_labels = true.repeat(1, no_of_classes).float()
    
    class_labels = torch.arange(no_of_classes, dtype=torch.float32, device=true.device)
    phi = (scale * torch.abs(class_labels - true_labels))
    y = nn.Softmax(dim=1)(-phi)
    return y


def loss_function(output, labels, loss_type="ce", expt_type=2, scale=2.5):
    """
    支持多种损失函数类型，二分类任务使用交叉熵损失
    """
    if loss_type == "ordered":
        targets = true_metric_loss(labels, expt_type, scale)
        return torch.sum(-targets * F.log_softmax(output, -1), -1).mean()
    else:
        return F.cross_entropy(output, labels)


def binary_metrics(op, t):
    """
    针对二分类任务（如 Weibo, SuicidEmoji）的评价指标函数。
    计算标准 Accuracy, Precision, Recall 和 F1-score。
    """
    from sklearn import metrics
    
    op = np.array(op)
    t = np.array(t)

    # 1. 计算 Accuracy
    acc = metrics.accuracy_score(t, op)

    # 2. 计算标准的 Precision, Recall, F1-score (针对正类，即标签 1)
    # 使用 zero_division=0 处理分母为 0 的情况
    precision = metrics.precision_score(t, op, average='binary', zero_division=0)
    recall = metrics.recall_score(t, op, average='binary', zero_division=0)
    f1 = metrics.f1_score(t, op, average='binary', zero_division=0)

    # 返回四元组以保持与 gr_metrics 的返回结构一致：
    # (Accuracy, Precision, Recall, F1)
    return acc, precision, recall, f1
