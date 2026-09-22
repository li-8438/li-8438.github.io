---
title: Attention 与 Transformer：大模型的技术基石
slug: nlp-attention-transformer
summary: 自注意力怎么算出「it 指的是 animal」？为什么除以 √d_k？多头注意力在并行看什么？这篇把 QKV、缩放点积、多头、位置编码、掩码机制逐个拆开，并给出可运行的最简实现。
tags: [Transformer, 注意力机制, 大模型, 位置编码, 多头注意力]
section: 学习笔记
topic: 模型基础
subtopic: NLP
published: true
---

2017 年那篇《Attention Is All You Need》改变了整个 AI 领域。今天所有大模型——GPT、Claude、LLaMA、Qwen、BERT——全部建立在它提出的 Transformer 架构上。

这篇把 Transformer 的核心讲透。理解它，你就能看懂大模型的技术文档、知道上下文长度和推理速度的权衡从哪来、明白为什么有些提示词写法更有效。

## 为什么需要 Attention

先回到 RNN 的问题。RNN 把整个序列压缩成一个隐藏状态，再往后传。这有两个后果：

**信息瓶颈** —— 无论序列多长，所有信息都要塞进一个固定维度的向量

**无法并行** —— 必须逐时间步串行计算

Attention 的思路极其直接：**别压缩了，让每个位置直接去看它需要的位置**。

具体做法：计算某个词的表示时，**让序列中所有词都参与加权平均，权重取决于它们和当前词的相关程度**。

这就是"注意力"的字面意思——**把注意力分配到相关的位置上**。

## 自注意力：Q、K、V

自注意力（Self-Attention）的三个核心概念：

- **Query（查询）** —— 当前位置"想找什么"
- **Key（键）** —— 每个位置"能提供什么"，用来和 Query 匹配
- **Value（值）** —— 每个位置"实际的内容"，用来加权求和

每个词都通过三个不同的权重矩阵，投影出自己的 Q、K、V：

```
Q = X · W_Q
K = X · W_K
V = X · W_V
```

### 计算过程

**第一步**：算 Q 和所有 K 的相似度（点积），得到注意力分数：

```
scores = Q · Kᵀ
```

**第二步**：缩放（关键步骤，稍后解释）：

```
scores = scores / √d_k
```

**第三步**： softmax 归一化成权重（加起来等于 1）：

```
weights = softmax(scores)
```

**第四步**：用权重对 V 做加权求和：

```
output = weights · V
```

合并成一个公式就是著名的：

```
Attention(Q, K, V) = softmax(QKᵀ / √d_k) · V
```

### 为什么除以 √d_k

这是个容易被忽略但很重要的细节。

如果不缩放，Q 和 K 的点积**会随着维度 d_k 增大而变大**（假设各维度独立，点积的方差约是 d_k 倍）。点积值一大，softmax 就会进入**饱和区**——输出接近 one-hot，梯度趋于 0。

**除以 √d_k 是为了把方差拉回 1，让 softmax 保持梯度健康的区域**。这就是论文标题里 "Scaled" 的由来。

### 一个直观例子

句子："The animal didn't cross the street because it was too tired"

问：句中的 "it" 指什么？

自注意力在处理 "it" 时，会拿它的 Query 和所有词的 Key 做匹配。训练充分的模型会给 "animal" 很高的权重，给 "street" 较低的权重——**因为语义上 it 指的是 animal**。

这个权重是**动态计算**的，取决于具体输入。这和 CNN 的固定卷积核、RNN 的固定循环权重完全不同——**注意力权重随输入而变**，这是它表达力强的根本原因。

## 多头注意力

单个注意力只能捕捉一种关系。多头注意力（Multi-Head Attention）的做法是：**并行跑 h 个注意力，每个用不同的投影矩阵，最后拼接起来**。

```
MultiHead(Q,K,V) = Concat(head_1, ..., head_h) · W_O

其中 head_i = Attention(Q·W_Qi, K·W_Ki, V·W_Vi)
```

具体实现是把 `d_model` 维切成 h 份，每份 `d_k = d_model / h` 维：

```
BERT-base: d_model=768, h=12 → 每个头 64 维
GPT-3:     d_model=12288, h=96 → 每个头 128 维
```

**关键认知：多头的计算量和单头几乎一样**。因为每个头只处理 `d_model/h` 维，h 个头加起来总量不变。所以多头的收益是**纯粹的表达力提升**，几乎不增加计算成本。

不同的头会自发学到不同的关系：有的专门看相邻词（局部语法），有的看句首（全局信息），有的从动词关注到它的主语（句法依赖）。

## 位置编码

自注意力有个先天缺陷：**它是置换不变的**。

因为注意力只依赖 Q·K 的内容相似度，跟位置无关。所以"狗咬人"和"人咬狗"在纯注意力看来完全一样——这显然不行。

解决办法是**把位置信息注入输入**：

```
输入 = 词嵌入 + 位置编码
```

### 正弦位置编码（原始 Transformer）

```
PE(pos, 2i)   = sin(pos / 10000^(2i/d_model))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))
```

每个位置得到一组独特的正弦/余弦值。它有三个优点：

- **无需学习参数**
- **能外推到更长的序列**（训练时没见过的长度也能算）
- 相对位置 `PE(pos+k)` 可以表示成 `PE(pos)` 的线性函数

### 可学习位置嵌入（BERT、GPT）

给每个位置一个可训练的向量，上限是训练时的最大长度（BERT 是 512）。简单有效，但**无法外推到更长序列**。

### RoPE（旋转位置编码）

**现代大模型的标配**（LLaMA、Mistral、Qwen）。它不把位置编码加到输入上，而是**直接旋转 Q 和 K 向量**：

```
把 Q、K 按位置角度旋转，使得点积 Q·K 天然包含相对位置信息
```

优势是**更好的长度外推能力**——训练时 4K 上下文，推理时能扩展到 32K 甚至更长（配合位置插值）。这就是为什么现在支持超长上下文的模型大多用 RoPE。

### ALiBi

另一种方案：给注意力分数**加一个和距离成正比的偏置**，越远惩罚越大。比 RoPE 更简单，外推性也不错。

## Transformer 块的结构

一个完整的 Transformer 层：

```
输入
  ↓
多头自注意力
  ↓
残差连接 + 层归一化    LayerNorm(x + Attention(x))
  ↓
前馈网络 FFN         两层全连接，中间维度通常 4 倍：FFN(x) = GELU(x·W₁)·W₂
  ↓
残差连接 + 层归一化    LayerNorm(x + FFN(x))
  ↓
输出
```

**残差连接是训练深度网络的关键**。`x + Sublayer(x)` 给梯度开了一条直达通道，让它不用穿过任何变换就能回传。没有残差，几十层的网络根本训不动（GPT-3 有 96 层）。

**Pre-Norm 优于 Post-Norm**：现代架构把 LayerNorm 放在子层**之前**而不是之后，梯度更稳定，能训更深。

## 三种架构流派

| 架构 | 代表模型 | 特点 | 适合任务 |
|---|---|---|---|
| **Encoder-only** | BERT、RoBERTa | 双向，每个位置看全句 | 分类、NER、语义匹配 |
| **Decoder-only** | GPT、LLaMA、Qwen | 单向，只看已生成部分 | 文本生成、对话 |
| **Encoder-Decoder** | T5、BART | 编码器理解 + 解码器生成 | 翻译、摘要 |

**现代大模型几乎全是 Decoder-only**。原因是它结构统一、训练目标简单（预测下一个词）、容易规模化，而且生成任务天然需要因果性。

### 因果掩码

Decoder-only 模型在训练时必须防止"偷看未来"——预测第 i 个词时，不能让它看到第 i+1 个词。

实现方式是**因果掩码（Causal Mask）**：把注意力矩阵的上三角（未来位置）设成负无穷，softmax 之后权重就变成 0。

```
掩码矩阵（3个token）：
[[  0, -inf, -inf],
 [  0,   0, -inf],
 [  0,   0,   0 ]]
```

第 1 行只能看自己，第 2 行能看 1、2，第 3 行能看 1、2、3。**这个上三角掩码就是"自回归生成"的实现方式**，也是为什么大模型只能一个词一个词往外吐——每生成一个新词都要重算一遍。

## 最简实现

理解原理最好的方式是看代码。这是一个能跑的单头注意力：

```python
import torch
import torch.nn as nn
import math

class SelfAttention(nn.Module):
    def __init__(self, d_model):
        super().__init__()
        self.d_k = d_model
        self.W_q = nn.Linear(d_model, d_model)
        self.W_k = nn.Linear(d_model, d_model)
        self.W_v = nn.Linear(d_model, d_model)

    def forward(self, x, mask=None):
        # x: (batch, seq_len, d_model)
        Q = self.W_q(x)
        K = self.W_k(x)
        V = self.W_v(x)

        # 1. Q·Kᵀ 算相似度
        scores = Q @ K.transpose(-2, -1)

        # 2. 缩放
        scores = scores / math.sqrt(self.d_k)

        # 3. 掩码（因果语言模型用）
        if mask is not None:
            scores = scores.masked_fill(mask == 0, -1e9)

        # 4. softmax 归一化
        weights = torch.softmax(scores, dim=-1)

        # 5. 加权求和
        return weights @ V
```

实际使用时直接调用 PyTorch 内置实现（用了 Flash Attention 等优化）：

```python
# 一行搞定多头注意力
nn.MultiheadAttention(embed_dim=768, num_heads=12, batch_first=True)

# 完整的 Transformer 层
layer = nn.TransformerEncoderLayer(
    d_model=768, nhead=12, dim_feedforward=3072, batch_first=True
)
```

## Transformer 的复杂度问题

注意力的计算量是 **O(n²)**——序列长度 n 翻倍，计算量和显存占用变成 4 倍。

这解释了大模型应用的很多现象：

- **长文本贵** —— 上下文从 4K 到 128K，attention 计算量增长近千倍
- **KV Cache 吃显存** —— 推理时要缓存所有历史 token 的 K、V，长对话显存暴涨
- **为什么分块（chunking）重要** —— RAG 把长文档切成小块，不只是为了检索精度，也是为了避开平方复杂度

业界的优化方向：Flash Attention（IO 优化）、稀疏注意力（只看局部+少量全局）、线性注意力（把复杂度降到 O(n)）、滑动窗口注意力。

## 大模型应用开发中的落地

**第一，理解 O(n²) 才能真正控制成本**。长上下文的 API 调用贵不是厂商乱收费，而是计算量确实平方增长。实践建议：**RAG 检索出的内容要控制总量**，把 top_k 从 20 降到 5，成本能降一大截而效果未必变差。

**第二，注意力机制解释了"提示词中信息位置"的重要性**。研究显示大模型对**开头和结尾**的信息记忆最强，中间部分容易"迷路"（lost in the middle）。因为注意力权重分布有位置偏置。**关键指令放开头或结尾，长文档中的重要信息不要放在正中间**——这是有实验依据的提示词技巧。

**第三，因果掩码决定了 few-shot 的写法**。模型生成时只能看到前面的内容，所以示例必须放在问题**之前**。这不是习惯问题，而是架构决定的硬约束。

**第四，KV Cache 是推理优化的核心**。多轮对话时，历史 token 的 K、V 可以缓存复用，不用每轮重算。这就是为什么**第二轮对话通常比第一轮快**，也是为什么很多 API 对"缓存命中"的输入给折扣价。设计应用时，**把稳定的系统提示词放在最前面**，能最大化缓存命中率，显著降低成本和延迟。

**第五，Encoder-only 模型在检索场景仍有优势**。做语义相似度匹配、文本分类时，BERT 类的双向模型（以及现代 Embedding 模型）比生成式大模型更合适且更便宜。选型判断：**要"理解"用 Encoder 类，要"生成"用 Decoder 类**。

## 小结

Transformer 的核心是**自注意力**：用 Q·Kᵀ 算相关性、除以 √d_k 防梯度消失、softmax 归一化后对 V 加权求和。**多头**让模型并行捕捉多种关系且几乎不增加计算量；**位置编码**（现代多用 RoPE）补上顺序信息；**残差连接 + LayerNorm** 让深层网络可训练；**因果掩码**实现自回归生成。

它取代 RNN 的根本原因是**可并行训练**，代价是 **O(n²) 的复杂度**——这个约束塑造了大模型应用的几乎所有工程实践。

有了 Transformer 架构，下一个问题是：**怎么利用它解决具体任务**。从头训练一个大模型不现实，于是有了预训练+微调的范式，接着看 [迁移学习与 BERT 微调实战](article.html?slug=nlp-transfer-learning-bert)。
