---
title: 优化器与学习率调度：从 SGD 到 Adam
slug: dl-optimizers
summary: SGD、Momentum、Adagrad、RMSProp、Adam 到底差在哪？学习率衰减为什么能救活震荡的训练？这篇逐个拆解五种优化器的设计动机，并给出三种学习率调度策略的用法。
tags: [PyTorch, 优化器, Adam, 学习率, 梯度下降]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

梯度下降的更新公式只有一行：

```
w_new = w_old - lr × 梯度
```

但"梯度"到底怎么算、"lr"该多大，衍生出了一个庞大的优化器家族。选对优化器，训练速度能差好几倍；选错，loss 可能压根不降。

这些优化器的演进有一条清晰主线：**要么改进梯度（让方向更准），要么改进学习率（让步长更聪明），要么两个都改**。

## 先理解学习率有多关键

看一个最简单的函数 `y = 4x²`，最小值在 x=0：

```python
import torch

def func(x):
    return torch.pow(2 * x, 2)   # y = 4x²

x = torch.tensor([2.0], requires_grad=True)
lr = 0.1
for i in range(4):
    y = func(x)
    y.backward()
    print(f'Iter {i}: x={x.item():.4f}, grad={x.grad.item():.4f}, loss={y.item():.4f}')
    x.data.sub_(lr * x.grad)   # x = x - lr * grad
    x.grad.zero_()
```

三种典型情况：

- **lr = 0.01** —— 每步挪一点点，收敛极慢，100 轮还没到
- **lr = 0.1** —— 平滑逼近最优点，正常
- **lr = 0.3** —— 一步跨过最低点，x 跑到负数区域，再下一步又跨回来，来回震荡，loss 越来越大（**梯度爆炸**）

所以学习率调整的目标是：**开始步子大一点快速下降，接近最优点时步子变小精细收敛**。

## 五种优化器

### 1. SGD：最朴素的版本

```python
optimizer = torch.optim.SGD(model.parameters(), lr=0.01)
```

每次沿着**当前 batch 的梯度**直接更新。问题很明显：

- 不同 batch 的梯度方向不一致，参数会走"之"字形，收敛慢
- 容易卡在**鞍点**（某个方向是极小、另一个方向是极大的点）附近出不来
- 对学习率极其敏感

### 2. Momentum（动量法）：改进梯度

```python
optimizer = torch.optim.SGD(model.parameters(), lr=0.01, momentum=0.9)
```

思路来自物理：给梯度下降加**惯性**。不是完全按当前梯度走，而是把历史梯度按指数衰减累加起来，形成一个"速度"：

```
v = momentum × v + 梯度
w = w - lr × v
```

好处是：**在梯度方向一致的维度上加速，在梯度来回摇摆的维度上相互抵消**。就像推球下山，球会积累速度冲过平缓区域，也能冲出局部的小坑。

`momentum=0.9` 是标准取值，表示保留 90% 的历史速度。

### 3. Adagrad：改进学习率

```python
optimizer = torch.optim.Adagrad(model.parameters(), lr=0.01)
```

思路是**让每个参数有自己的学习率**：频繁更新的参数，学习率逐渐变小；稀疏更新的参数，学习率保持较大。这对稀疏特征（比如 NLP 里的长尾词）特别友好。

缺点是**学习率单调递减，训练到后期会小到几乎不动**，导致提前停止学习。

### 4. RMSProp：改进 Adagrad

```python
optimizer = torch.optim.RMSProp(model.parameters(), lr=0.01, alpha=0.9)
```

针对 Adagrad "学习率一路衰减到死"的问题，RMSProp 改用**指数移动平均**来累积历史梯度平方，而不是简单累加。这样近期的梯度权重更大，学习率不会无限衰减。

`alpha=0.9` 控制历史信息的衰减速度。

### 5. Adam：梯度 + 学习率都改

```python
optimizer = torch.optim.Adam(model.parameters(), lr=0.001, betas=(0.9, 0.999))
```

**Adam 是 Momentum + RMSProp 的结合**：既用动量平滑梯度方向（一阶矩估计），又用梯度平方的移动平均自适应调整每个参数的学习率（二阶矩估计）。

它几乎是**现代深度学习的默认选择**，原因很简单：收敛快、对学习率不那么敏感、默认参数在绝大多数任务上都能用。

两个 beta 参数的含义：
- `betas[0]=0.9` —— 梯度（一阶矩）的衰减率，等价于 momentum
- `betas[1]=0.999` —— 梯度平方（二阶矩）的衰减率

```python
# 常用配置
torch.optim.Adam(model.parameters(), lr=1e-3)          # 训练小网络
torch.optim.AdamW(model.parameters(), lr=2e-5, weight_decay=0.01)  # 微调预训练模型
```

**微调预训练模型时要用 AdamW**，它是 Adam 的改进版，把权重衰减（L2 正则化）从梯度更新中解耦出来，实际效果更好。HuggingFace 的 Trainer 默认就是 AdamW。

## 怎么选

| 优化器 | 改进对象 | 适用场景 |
|---|---|---|
| SGD | 无 | 理论基础，收敛慢，现在很少单独用 |
| SGD + Momentum | 梯度方向 | 图像任务（ResNet 等）常用，泛化可能略好 |
| Adagrad | 学习率 | 稀疏数据，但后期会停止学习 |
| RMSProp | 学习率 | 强化学习、RNN 常用 |
| **Adam** | 梯度 + 学习率 | **默认首选，绝大多数场景** |
| AdamW | 梯度 + 学习率 + 解耦正则 | **微调预训练模型 / 大模型的标准选择** |

实践建议：**不知道选什么就 Adam**。基线跑通后，如果追求极致效果，可以试试 SGD + Momentum + 学习率衰减（有些图像任务上泛化更好），但调参成本会高很多。

## 学习率衰减

固定学习率有个矛盾：训练初期需要大步快跑，后期需要小步精调。学习率衰减就是让 lr 随着训练推进逐步变小。

PyTorch 里通过 **scheduler（调度器）** 实现，用法固定三步：

```python
scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=5, gamma=0.1)
# 每个 epoch 结束后
scheduler.step()
# 查看当前学习率
scheduler.get_last_lr()
```

### 等间距衰减 StepLR

每隔固定轮数，学习率乘以一个衰减系数：

```python
# 每 5 轮，lr 变成原来的 0.1 倍
# 初始 0.1 → 第6轮 0.01 → 第11轮 0.001 → ...
scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=5, gamma=0.1)
```

### 指定间距衰减 MultiStepLR

在**指定的轮数**上衰减，比等间距更灵活：

```python
# 在第 3、5、8 轮时衰减，衰减率 0.1
scheduler = torch.optim.lr_scheduler.MultiStepLR(optimizer, milestones=[3, 5, 8], gamma=0.1)
```

典型用途：训练到一半损失不再下降时，手动降一个数量级。

### 指数衰减 ExponentialLR

每轮都按固定比例衰减：

```python
# 每轮 lr ×= 0.95，平滑下降
scheduler = torch.optim.lr_scheduler.ExponentialLR(optimizer, gamma=0.95)
```

### 预热 Warmup

微调大模型时还有一个必用技巧：**学习率预热**。训练最开始，模型参数是随机初始化的分类头，梯度很大，如果直接用大学习率会把预训练权重冲坏。所以前几步先把 lr 从 0 线性升到设定值，然后再衰减。

```python
from transformers import get_linear_schedule_with_warmup

# 总步数 = epoch数 × 每轮batch数
scheduler = get_linear_schedule_with_warmup(
    optimizer,
    num_warmup_steps=100,    # 前 100 步预热
    num_training_steps=1000
)
```

HuggingFace Trainer 里的 `warmup_steps` 参数就是干这个的，微调时通常设为总步数的 6%~10%。

## 大模型应用开发中的落地

**第一，微调大模型的黄金参数组合**：

```python
optimizer = torch.optim.AdamW(model.parameters(), lr=2e-5, weight_decay=0.01)
# 配合 warmup + 线性衰减
```

`2e-5` 这个学习率是业界用无数实验试出来的：太大（如 1e-3）会破坏预训练权重导致灾难性遗忘，太小（如 1e-7）则学不动。**微调的第一条经验法则：学习率要比从零训练小 1~2 个数量级**。

**第二，LoRA 微调的学习率要大得多**。因为 LoRA 只训练少量新增的低秩矩阵，可以放心用更大的学习率，通常是全量微调的 10 倍左右（`1e-4` ~ `2e-4`）。

**第三，batch_size 和学习率要配套调**。batch 变大时，梯度估计更准确，可以相应调大学习率。经验规则是"线性缩放"：batch_size 翻倍，学习率也翻倍。但配合 Adam 时这个规则不那么严格，实践中更常用的做法是固定学习率、只调 batch。

**第四，loss 不降时先怀疑学习率**。这是最常见的原因。诊断流程：
- loss 剧烈震荡或变成 NaN → 学习率太大，降到 1/10
- loss 几乎不动 → 学习率太小，或者卡在鞍点，试试换成 Adam
- loss 下降但很慢 → 加学习率衰减，或换优化器
- 训练集 loss 降但验证集 loss 升 → 过拟合，加正则化、早停，跟学习率无关

## 小结

优化器的演进逻辑很清晰：**SGD 是基础，Momentum 用惯性改进梯度方向，Adagrad/RMSProp 自适应调整每个参数的学习率，Adam 两者兼得（默认首选，微调用 AdamW）**。学习率衰减让训练"先快跑后精调"，三种调度策略（StepLR 等间距、MultiStepLR 指定间距、ExponentialLR 指数）按需选择，微调大模型时别忘了加 warmup。

优化器管的是"怎么更新参数"，另一类问题是"怎么防止模型记住噪声"——Dropout 和 BatchNorm 就派上用场了，接着看 [Dropout 与批量归一化：深度网络的正则化双雄](article.html?slug=dl-regularization)。
