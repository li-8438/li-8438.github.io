---
title: PyTorch 张量：创建、运算、索引与形状变换
slug: pytorch-tensor
summary: 张量是深度学习的通用数据载体。这篇讲清张量的创建方式、点乘与点积的区别、dim 轴到底指什么、reshape/squeeze/transpose 的用法，以及 cat 和 stack 最容易搞混的地方。
tags: [PyTorch, 张量, 深度学习, 张量运算]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

张量（Tensor）就是**多维数组**。它是 PyTorch 里一切数据的载体：输入特征、模型权重、Embedding 向量、大模型中间层的激活值，全都是张量。

```
标量（0维）：3.14
向量（1维）：[1, 2, 3]
矩阵（2维）：[[1, 2], [3, 4]]
3维张量：    [[[1,2],[3,4]], [[5,6],[7,8]]]   ← 一批图像/一批文本
```

搞不清张量的形状（shape），训练时会遇到无穷无尽的 `RuntimeError: mat1 and mat2 shapes cannot be multiplied`。**形状意识是写 PyTorch 最重要的基本功**。

## 创建张量

```python
import torch

# 方式一：小写 tensor，直接指定数据
t = torch.tensor([1, 2, 3])

# 方式二：大写 Tensor，指定数据 + 维度
t = torch.Tensor([1, 2, 3])      # 从数据推断
t = torch.Tensor(2, 3)            # 指定形状，值是未初始化的随机内存

# 方式三：指定类型创建
# int16/int32/int64 对应 short/int/long；float16/32/64 对应 half/float/double
t = torch.IntTensor([1, 2, 3])
t = torch.FloatTensor([1.0, 2.0])

# 线性张量
torch.arange(0, 10, 2)      # tensor([0, 2, 4, 6, 8])，包左不包右
torch.linspace(0, 10, 5)    # tensor([0, 2.5, 5, 7.5, 10])，包左包右，按数量均分

# 随机张量
torch.manual_seed(42)       # 设置随机种子，保证实验可复现
torch.rand(2, 3)            # [0, 1) 均匀分布
torch.randn(2, 3)           # 标准正态分布（均值0 方差1）
torch.randint(0, 10, (2,3)) # 随机整数，包左不包右

# 全 0 / 全 1
torch.zeros(2, 3)           # 按形状创建
torch.zeros_like(t)         # 按已有张量的形状创建
torch.ones(2, 3)
torch.ones_like(t)

# 指定值填充
torch.full((2, 3), 7)       # 2×3 全是 7
torch.full_like(t, 7)
```

**设置随机种子是个好习惯**。深度学习里大量地方用到随机（权重初始化、数据打乱、Dropout），不固定种子会出现"同样的代码两次跑出不同结果"，debug 时非常痛苦。

## 数据类型转换

```python
t = torch.tensor([1, 2, 3])

t.type(torch.float32)   # 转成指定类型
t.float()               # 等价的简写，最常用
t.half()                # float16，省显存
t.int()                 # int32
t.long()                # int64，做分类标签时用
```

一个高频坑：**平均值的计算要求浮点类型**。

```python
t = torch.tensor([[1, 2], [3, 4]])
# t.mean()  # 报错：整数类型算不出均值
t = t.float()
print(t.mean())  # tensor(2.5000)
```

## 与 NumPy 互转

PyTorch 和 NumPy 的数据可以互相转换，但有个**共享内存**的陷阱：

```python
import numpy as np

# tensor → numpy
t = torch.tensor([1, 2, 3])
n = t.numpy()              # 共享内存！改一个另一个也变
n = t.numpy().copy()       # 不共享，安全

# numpy → tensor
n = np.array([1, 2, 3])
t = torch.from_numpy(n)    # 共享内存
t = torch.tensor(n)        # 重新创建，不共享，推荐

# 从单元素张量取标量值
t = torch.tensor([5])
print(t.item())            # 5，Python 数字
```

`item()` 在记录 loss 时天天用——`total_loss += loss.item()`，把张量转成 Python 数字才能累加和画图。

## 基本运算

```python
a = torch.tensor([[1, 2], [3, 4]])
b = torch.tensor([[1, 1], [2, 2]])

a + 1        # 加常数，广播机制：每个元素都 +1
a + b        # 对应位置相加
a - b
a * b        # 点乘（逐元素乘）
a / b
-a

# 方法形式等价
a.add(b)
a.mul(b)
```

**带下划线的方法表示原地修改**：

```python
a.add_(b)   # 直接修改 a，不创建新张量
a.add(b)    # 返回新张量，a 不变
```

**在训练代码里千万别乱用原地操作**，它可能破坏计算图导致自动微分失败。唯一常见的安全用法是 `x.grad.zero_()` 清空梯度。

## 点乘 vs 点积

这是最容易混淆的一对概念：

**点乘（element-wise）** —— 两个**形状相同**的张量，对应位置相乘，结果形状不变：

```python
a * b          # 或 torch.mul(a, b)
```

**点积（矩阵乘法）** —— 矩阵乘法，**没有交换律**。前提是 `A 的列数 == B 的行数`：

```python
# (3,2) @ (2,2) → (3,2)
t3 = torch.tensor([[1,2],[2,3],[3,4]])   # 3行2列
t2 = torch.tensor([[2,2],[3,3]])         # 2行2列
result = t3 @ t2                          # 结果 3行2列
# 或写 torch.matmul(t3, t2)
```

结果形状规则：**A(m,n) @ B(n,p) → (m,p)**，中间维度被消掉。

全连接层的本质就是点积：`y = x @ Wᵀ + b`。所以每次写 `nn.Linear(in_features, out_features)`，你要保证输入张量的最后一维等于 `in_features`。

## 聚合运算与 dim 轴

```python
data = torch.tensor([[1, 2, 3],
                     [4, 5, 6]])

data.sum()          # 全部求和 → 21
data.sum(dim=0)     # 沿第0维（列方向）求和 → tensor([5, 7, 9])
data.sum(dim=1)     # 沿第1维（行方向）求和 → tensor([6, 15])
data.mean()
data.max()
data.min()
```

**dim 的理解技巧：dim=n 就是把第 n 维"消掉"**。`data.shape` 是 (2,3)，`sum(dim=0)` 结果是 (3,)，`sum(dim=1)` 结果是 (2,)。

其他常用运算：

```python
data.sqrt()      # 开方
data.square()    # 平方
data.pow(2)      # 2次幂，等价 square()
data.abs()       # 绝对值
data.exp()       # e 的指数
data.log()       # 自然对数（注意：log2 和 log10 是另外两个）
```

## 索引与切片

```python
data = torch.randint(1, 10, (3, 4))

data[0]           # 第 0 行（语法糖）
data[0, :]        # 同上，显式写法
data[:, 0]        # 第 0 列

# 列表索引：取出指定的 (行,列) 组合
data[[0, 1], [1, 2]]   # 取出 (0,1) 和 (1,2) 两个位置的元素

# 范围切片
data[:2, :3]      # 前 2 行、前 3 列

# 布尔索引：筛选
mask = data > 5
data[data > 5]    # 取出所有大于 5 的元素，返回一维张量
```

布尔索引在 NumPy 和 Pandas 里通用，做数据筛选时非常顺手。

## 形状变换

```python
data = torch.tensor([[1,2,3],[4,5,6]])   # shape (2,3)

# reshape：改变形状，不改变数据
data.reshape(1, 6)      # (1,6)
data.reshape(3, -1)     # -1 表示自动计算，这里等于 2
# 前提：总元素数必须一致，(2,3)=6 个元素不能 reshape 成 (4,2)=8

# squeeze：删除所有值为 1 的维度
t = torch.randn(1, 3, 1, 5)
t.squeeze().shape       # torch.Size([3, 5])

# unsqueeze：在指定位置插入一个维度
t = torch.randn(3, 5)
t.unsqueeze(0).shape    # torch.Size([1, 3, 5])，常用于加 batch 维度

# transpose：交换指定的两个维度
t = torch.randn(2, 3, 5)
t.transpose(0, 1).shape  # torch.Size([3, 2, 5])

# permute：一次性重排多个维度
t.permute(2, 0, 1).shape # torch.Size([5, 2, 3])
```

**unsqueeze 在实战中极常用**——给单条数据加 batch 维度才能送进模型：

```python
x = torch.randn(768)          # 一个 768 维的向量
x = x.unsqueeze(0)            # (1, 768)，变成"批大小为1"
output = model(x)
```

**transpose 在注意力机制里天天见**——Transformer 里对 Q、K 做点积前，经常要转置最后一个维度。

## 张量拼接：cat vs stack

这是另一个高频混淆点：

**cat** —— 不增加维度，在已有维度上拼接。**除了拼接的那一维，其他维度必须相同**：

```python
a = torch.tensor([[1,2,3],[4,5,6]])      # (2,3)
b = torch.tensor([[7,8,9]])              # (1,3)

torch.cat([a, b], dim=0).shape   # (3,3)，沿行拼接：2 行 + 1 行 = 3 行
```

**stack** —— 会增加一个新维度，**要求所有张量形状完全一致**：

```python
a = torch.tensor([[1,2,3],[4,5,6]])   # (2,3)
b = torch.tensor([[1,2,3],[4,5,6]])   # (2,3)

torch.stack([a,b], dim=0).shape   # (2,2,3)
torch.stack([a,b], dim=1).shape   # (2,2,3)
torch.stack([a,b], dim=2).shape   # (2,3,2)
```

记忆口诀：
- **cat**：其他维度不变，拼接的那一维做**加法**
- **stack**：其他维度不变，新升的那一维等于**拼接的数据条数**

一个实际例子：给多模态模型喂数据，图片张量 + 文字张量要合成一条消息，用 `stack` 把它们叠成一个新维度。

## 大模型应用开发中的落地

**第一，搞清楚大模型输入输出的形状**。以 batch 推理为例：

```
input_ids.shape  = (batch_size, seq_len)      # 比如 (8, 512)
logits.shape     = (batch_size, seq_len, vocab_size)  # 比如 (8, 512, 151936)
```

vocab_size 动辄十几万，这就是大模型输出层巨大的原因。做生成时取 `logits[:, -1, :]`（最后一个位置的预测）来采样下一个 token。

**第二，attention_mask 是形状对齐的关键**。批量推理时句子长度不同，短的要用 padding token 补齐到相同长度，但**padding 不能参与注意力计算**，所以需要一个同形状的 mask 张量标记哪些位置是真实 token。`unsqueeze` 和 `expand` 在这里被大量使用。

**第三，Embedding 就是一张查表**。输入形状 `(batch, seq_len)` 的整数 ID，经过 `nn.Embedding(vocab_size, hidden_dim)` 后变成 `(batch, seq_len, hidden_dim)` 的向量。理解了这个形状变化，向量检索和 RAG 的很多操作就都是张量运算而已。

**第四，显存不够时先看形状**。`CUDA out of memory` 最常见的解法是减小 batch_size，本质就是缩小张量的第 0 维。也可以把 float32 转 float16（`t.half()`），显存直接减半。

## 小结

张量的核心是**形状意识**：创建时知道要什么形状，运算时清楚结果是什么形状。几个必记要点：`@` 是矩阵乘法要求中间维度匹配、`dim=n` 表示把第 n 维消掉、`unsqueeze(0)` 加 batch 维度、`cat` 不升维 `stack` 升维、以及**整数张量不能求均值**。

会操作张量之后，下一步是让 PyTorch 自动帮我们算梯度——这是训练得以进行的关键，接着看 [自动微分与模型训练五步法](article.html?slug=pytorch-autograd)。
