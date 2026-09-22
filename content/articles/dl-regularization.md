---
title: Dropout 与批量归一化：深度网络的正则化双雄
slug: dl-regularization
summary: 为什么随机让神经元失活反而能提升效果？BatchNorm 为什么能加速训练十倍？这篇讲清两者的作用时机、工作原理，以及为什么它们都必须在 train/eval 模式下行为不同。
tags: [PyTorch, Dropout, BatchNorm, 正则化, 过拟合]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

网络越深，参数越多，过拟合的风险就越大。传统机器学习用 L1/L2 正则化对付这个问题，深度学习里则有两个更直接的武器：**Dropout** 和 **BatchNorm**。

它们经常被一起用，但作用完全不同：Dropout 是**随机丢神经元**防过拟合，BatchNorm 是**规范数据分布**加速收敛。用错了位置和时机，反而会让模型变差。

## Dropout：随机让神经元失活

### 原理

训练过程中，**以概率 p 随机让一部分神经元失活（输出置 0）**，剩下的神经元按 `1/(1-p)` 放大。

```
训练时：每个神经元有 p 的概率"请假"，本次前向不参与计算；保留的神经元输出除以 (1-p) 放大
预测时：所有神经元都参与，且不再做任何缩放（训练时已放大过，期望值保持一致）
```

为什么要放大？保持输出的**期望值不变**。假设 p=0.5，一半神经元被置零，输出总和会减半，乘上 `1/(1-0.5)=2` 补回来。

### 为什么有效

直觉解释：Dropout 强迫网络**不能依赖任何一个特定神经元**。因为每次训练时，任何一个神经元都可能随机消失，网络必须学会"多条路径都能得出正确结论"，而不是把宝押在某几个神经元上。

这本质上是一种**模型集成**——每次训练相当于在训一个不同的子网络，最终模型是无数子网络的平均。

另一个角度：它打破了神经元之间的"共适应"关系。没有 Dropout 时，某些神经元会学会互相配合来拟合训练集的噪声，Dropout 让这种配合无法稳定形成。

### 使用规则

**三个关键时机**：

1. **只在训练时使用** —— 预测时所有神经元都要参与
2. **作用在激活函数之后** —— 先算激活值，再随机置零
3. **p 的常用取值** —— 全连接层 0.3~0.5，卷积层 0.1~0.2（卷积层参数少，不需要太强的正则化）

```python
import torch
import torch.nn as nn

class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(784, 256)
        self.dropout = nn.Dropout(p=0.5)   # 自动挡：作为层放进网络
        self.fc2 = nn.Linear(256, 10)

    def forward(self, x):
        x = torch.relu(self.fc1(x))
        x = self.dropout(x)      # 激活函数之后
        return self.fc2(x)

# 手动挡：函数式调用，train=True 表示启用
output = torch.dropout(x, p=0.5, train=True)
```

**最重要的一点**：用 `nn.Dropout` 作为网络层时，它会自动感知 `model.train()` 和 `model.eval()`：

```python
model.train()   # Dropout 生效，随机丢弃
model.eval()    # Dropout 自动关闭，所有神经元参与
```

**忘了在推理前调 `model.eval()`，预测结果会是随机的**——这是极其常见的 bug。

## 批量归一化 BatchNorm

### 原理

BatchNorm 对每个 batch 的数据做标准化（减均值、除标准差），然后再学两个参数 λ 和 β 做缩放和平移。

```
1. 计算当前 batch 的均值和标准差
2. 标准化：(x - 均值) / 标准差
3. 缩放平移：λ × 标准化值 + β    ← λ、β 是可学习参数
```

### 为什么需要第三步

如果只做标准化，数据被强行拉成均值 0 标准差 1，会**破坏上一层学到的特征分布**。比如经过 Sigmoid 前的数据如果全被压到 0 附近，Sigmoid 就退化成了线性函数，网络表达能力下降。

所以引入可学习的 λ 和 β，让网络**自己决定要不要恢复原始分布**。如果网络认为标准化有害，它完全可以学到 `λ=标准差, β=均值`，把数据还原回去。

另一个重要作用：**防止 ReLU 杀死神经元**。如果加权求和后的值全是负数，经过 ReLU 后全部变 0，梯度也就断了。BatchNorm 通过标准化把数据拉回 0 附近，让大约一半的值为正，保证 ReLU 有梯度流过。

### 作用时机

**激活函数之前、加权求和之后**：

```
Linear → BatchNorm → ReLU → Dropout
```

注意这和 Dropout 正好相反（Dropout 在激活之后）。要小心别搞混。

### 三个版本

```python
nn.BatchNorm1d(num_features=128)   # 全连接层，输入最多 3 维 (batch, features)
nn.BatchNorm2d(num_features=64)    # 卷积层，输入最多 4 维 (batch, channel, h, w)
nn.BatchNorm3d(num_features=32)    # 3D 数据如医学影像，最多 5 维
```

`num_features` 要填**特征的维度数**，也就是前一层的输出维度。

### 为什么能加速训练

BatchNorm 解决了一个叫**内部协变量偏移（Internal Covariate Shift）**的问题：深层网络中，前面层的参数更新会导致后面层的输入分布不断变化，后面层就得不断去适应新分布，训练因此变慢。

做了归一化后，每层的输入分布都稳定在均值 0 方差 1 附近，后面的层可以专心学自己的映射。**实践中 BatchNorm 能让训练速度提升数倍，还允许用更大的学习率**。

### train/eval 模式的区别

这是 BatchNorm 最容易出错的地方：

- **训练时**：用**当前 batch** 的均值和方差
- **推理时**：用训练过程中**累积的全局**均值和方差（滑动平均）

推理时 batch 可能只有 1 条数据，根本算不出有意义的方差，只能用训练时统计好的。所以**推理前必须 `model.eval()`**，否则单个样本的预测结果会依赖同批次的其他样本，导致结果不可复现。

## 完整网络示例

把 Dropout、BatchNorm、激活函数串起来，一个标准的深层网络长这样：

```python
import torch
import torch.nn as nn

class Classifier(nn.Module):
    def __init__(self, input_dim, output_dim):
        super().__init__()
        self.fc1 = nn.Linear(input_dim, 128)
        self.bn1 = nn.BatchNorm1d(128)
        self.fc2 = nn.Linear(128, 256)
        self.bn2 = nn.BatchNorm1d(256)
        self.fc3 = nn.Linear(256, 512)
        self.bn3 = nn.BatchNorm1d(512)
        self.dropout = nn.Dropout(p=0.3)
        self.out = nn.Linear(512, output_dim)

    def forward(self, x):
        # 顺序：Linear → BatchNorm → 激活 → Dropout
        x = self.dropout(torch.relu(self.bn1(self.fc1(x))))
        x = self.dropout(torch.relu(self.bn2(self.fc2(x))))
        x = self.dropout(torch.relu(self.bn3(self.fc3(x))))
        return self.out(x)   # 注意：不加 softmax，CrossEntropyLoss 内部会做
```

**用了 BatchNorm 之后，通常就不需要再做输入数据的标准化了**——第一层的 BN 已经帮你做了。

## 参数初始化

网络层定义好之后，权重的初始值也很重要。全 0 初始化是**绝对不行**的：所有神经元算出完全相同的梯度，更新也完全相同，网络退化成一个神经元。

```python
nn.init.zeros_(w)      # 全 0 —— 不可用，会导致对称性问题
nn.init.ones_(w)       # 全 1 —— 同样有问题
nn.init.constant_(w, 0.123)   # 指定常数
nn.init.uniform_(w)    # 均匀分布随机
nn.init.normal_(w)     # 正态分布随机
nn.init.kaiming_normal_(w)    # 凯明初始化，只考虑输入维度，配合 ReLU 用
nn.init.xavier_normal_(w)     # 泽维尔初始化，同时考虑输入输出维度，配合 tanh/sigmoid 用
```

**选择规则**：ReLU 系激活函数用 Kaiming（凯明），tanh/Sigmoid 用 Xavier（泽维尔）。

不过实践中，PyTorch 的 `nn.Linear`、`nn.Conv2d` **已经内置了合理的默认初始化**，大多数情况下你什么都不用做。只有自己手写权重时才需要关心这个。

## 大模型应用开发中的落地

**第一，LayerNorm 是 BatchNorm 在大模型中的替代品**。Transformer 几乎不用 BatchNorm，而用 **LayerNorm**。原因是：BatchNorm 依赖 batch 统计量，而大模型的 batch 往往很小（显存限制），甚至有时是单条推理，batch 统计量不可靠。LayerNorm 改为**在特征维度上归一化**（对单个样本自己的所有特征做标准化），与 batch 无关，天然适合序列数据和变长输入。

```python
nn.LayerNorm(hidden_size)   # Transformer 标准配置
```

**第二，RMSNorm 是更现代的选择**。LLaMA、Qwen 等新一代大模型用 RMSNorm 替代 LayerNorm，它去掉了减均值的操作，只做均方根归一化，计算更快且效果相当。看到模型配置里的 `rms_norm_eps` 参数，就知道用的是这个。

**第三，Dropout 在现代大模型里用得少了**。因为大模型训练数据极其充分（几万亿 token），过拟合风险本身就低，加 Dropout 反而拖慢收敛。GPT 系列基本不用 Dropout。但在**微调场景**下，数据量小（几千条），过拟合风险高，Dropout 就又变得有用了。判断标准：**数据量越小，越该加 Dropout**。

**第四，Pre-Norm 比 Post-Norm 更稳定**。现代 Transformer 把 LayerNorm 放在子层**之前**（Pre-Norm）而不是之后，梯度更稳定，能训练更深的网络。这和我们前面说的"BatchNorm 在激活函数前"是同一个思路——归一化前置。

**第五，推理服务里的 eval() 是硬要求**。部署模型时忘记 `model.eval()`，Dropout 会让每次预测结果不同，BatchNorm 会用单条样本的统计量导致输出异常。生产环境的正确写法：

```python
model.eval()
with torch.no_grad():
    output = model(input_tensor)
```

## 小结

**Dropout** 在训练时以概率 p 随机让神经元失活（放在激活函数**之后**），通过打破神经元共适应来防过拟合；**BatchNorm** 对每个 batch 标准化后再学 λ、β 缩放（放在激活函数**之前**），通过稳定层输入分布来加速训练。两者都**依赖 train/eval 模式切换**，推理前必须调 `model.eval()`。

标准网络层的顺序是：`Linear → BatchNorm → ReLU → Dropout`。

全连接层讲完了，但处理图像时全连接网络有个致命缺陷——它把像素拉成一维，完全丢掉了空间结构。卷积神经网络就是为此设计的，接着看 [卷积神经网络：卷积层、池化层与感受野](article.html?slug=dl-cnn)。
