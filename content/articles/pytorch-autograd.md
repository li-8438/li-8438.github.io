---
title: 自动微分与模型训练五步法
slug: pytorch-autograd
summary: loss.backward() 到底做了什么？这篇讲清自动微分的原理、requires_grad 的作用、训练循环的标准五步，并用线性回归案例跑通从数据到模型的完整流程。
tags: [PyTorch, 自动微分, backward, 训练流程, DataLoader]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

深度学习最反直觉的一点：**你从来不需要手算梯度**。

不管模型有 10 个参数还是 1000 亿个，只要写一行 `loss.backward()`，PyTorch 就会自动算出每个参数的梯度。这个能力叫**自动微分（Autograd）**，它是现代深度学习框架存在的根本理由。

## 自动微分是怎么工作的

原理其实不复杂：当你用 PyTorch 的算子做运算时，框架会在背后**记录下每一步运算，构建一张计算图**。调用 `backward()` 时，它沿着这张图反向走一遍，用链式法则算出所有梯度。

关键点：**只有设置了 `requires_grad=True` 的张量才会被追踪**。

```python
import torch

x = torch.linspace(-20, 20, 1000, requires_grad=True)
y = torch.sigmoid(x)     # 定义一个函数
y.sum().backward()       # 对函数求导
print(x.grad)            # x 每个位置的梯度
```

几个必须注意的细节：

**第一，只有标量才能直接 backward**。`backward()` 需要一个标量作为起点，如果 `y` 是向量，要先 `y.sum()` 聚合成标量，或者传入一个同形状的权重张量。

**第二，梯度是累加的**。每次 `backward()` 都会把新梯度**加到** `.grad` 上，而不是覆盖。所以每个 batch 训练前必须清空梯度，否则梯度会越积越大——这是新手最常踩的坑。

**第三，模型的参数默认就带 `requires_grad=True`**。用 `nn.Linear`、`nn.Conv2d` 这些层创建时，PyTorch 自动把权重设成可求导，所以你通常不需要手动设置。

## 一个完整的微分例子

```python
import torch

X = torch.ones(2, 5)           # 2 个样本，每个 5 个特征
W = torch.randn(5, 3, requires_grad=True)   # 权重 5→3
B = torch.randn(3, requires_grad=True)      # 偏置

Z = X @ W + B                  # 前向：加权求和，形状 (2,3)
Y = torch.zeros(2, 3)          # 真实标签

loss_fn = torch.nn.MSELoss()
loss = loss_fn(Z, Y)           # 算损失

loss.backward()                # 反向：自动微分

print(W.grad)   # 损失对 W 的梯度，形状与 W 相同 (5,3)
print(B.grad)   # 损失对 B 的梯度，形状 (3,)
```

**梯度张量的形状一定和对应参数的形状完全相同**——因为每个参数都需要一个梯度来更新自己。

## 训练的标准五步

不管是线性回归还是大模型微调，训练循环永远是这五步：

```python
for x_batch, y_batch in dataloader:
    # 1. 前向传播：模型预测
    y_pred = model(x_batch)

    # 2. 计算损失
    loss = loss_fn(y_pred, y_batch)

    # 3. 反向传播：自动微分算梯度
    loss.backward()

    # 4. 更新参数
    optimizer.step()

    # 5. 清空梯度（为下一个 batch 做准备）
    optimizer.zero_grad()
```

顺序不能乱，尤其是**第 4 步和第 5 步**：必须先更新再清空，否则梯度被清掉了就没法更新。

## 数据管道：从数组到 DataLoader

训练很少一次性把所有数据塞进模型（显存不够，而且效果也不好），而是**分批（batch）训练**。PyTorch 的标准管道是四层结构：

```
原始数据 → 张量 → 数据集 Dataset → 数据加载器 DataLoader
```

```python
from torch.utils.data import TensorDataset, DataLoader

# 1. 原始数据 → 张量
x = torch.tensor(x_numpy, dtype=torch.float32)
y = torch.tensor(y_numpy, dtype=torch.float32)

# 2. 张量 → 数据集（把特征和标签配对）
dataset = TensorDataset(x, y)

# 3. 数据集 → 数据加载器（自动分批 + 打乱）
dataloader = DataLoader(dataset, batch_size=16, shuffle=True)

# 100 条数据，batch_size=16 → 每轮 7 个批次（16×6 + 4）
```

`shuffle=True` 在训练集上是必须的——打乱顺序能防止模型记住数据的排列规律。测试时则要设为 False。

## 完整案例：模拟线性回归

用 sklearn 生成带噪声的线性数据，再用 PyTorch 训练一个线性模型去拟合它：

```python
import torch
import matplotlib.pyplot as plt
from sklearn.datasets import make_regression
from torch.utils.data import TensorDataset, DataLoader

# 1. 创建数据
def create_data():
    # y = kx + b + noise，coef=True 会返回真实斜率供我们对照
    x, y, coef = make_regression(
        n_samples=100,    # 样本数量
        n_features=1,     # 特征数量
        n_targets=1,      # 标签数量
        bias=3,           # 真实偏置
        noise=10,         # 噪声（没有噪声就是完美直线）
        coef=True,
        random_state=3
    )
    return x, y.reshape(-1, 1), coef

# 2. 训练
def train(x, y, coef):
    # 数据 → 张量 → 数据集 → 加载器
    x = torch.tensor(x, dtype=torch.float32)
    y = torch.tensor(y, dtype=torch.float32)
    dataset = TensorDataset(x, y)
    dataloader = DataLoader(dataset, batch_size=16, shuffle=True)

    # 创建模型和优化器
    model = torch.nn.Linear(in_features=1, out_features=1)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.01)

    loss_list = []
    # 训练 100 轮（epoch），每轮遍历全部数据一遍
    for i in range(100):
        total_loss, count = 0, 0
        for x_train, y_train in dataloader:
            # ---- 前向传播 ----
            y_pred = model(x_train)
            loss = torch.nn.MSELoss()(y_pred, y_train)
            total_loss += loss.item()
            count += 1
            # ---- 反向传播 ----
            loss.backward()
            optimizer.step()
            optimizer.zero_grad()

        avg_loss = total_loss / count
        loss_list.append(avg_loss)
        if (i + 1) % 20 == 0:
            print(f'第{i+1}轮，平均损失: {avg_loss:.4f}')

    # 训练结束：学到的参数在模型里
    print('模型学到的参数:', model.state_dict())
    print(f'真实参数: 斜率={coef[0]:.4f}, 偏置=3')

    # 画损失曲线
    plt.plot(range(len(loss_list)), loss_list)
    plt.xlabel('轮数'); plt.ylabel('平均损失')
    plt.show()

x, y, coef = create_data()
train(x, y, coef)
```

### 三个关键概念

**Epoch（轮）** —— 把全部训练数据过一遍算一个 epoch。上面的例子跑了 100 轮。

**Batch（批）** —— 一次送入模型的数据量。100 条数据、batch_size=16，就是每轮 7 个 batch。

**Iteration（迭代）** —— 一个 batch 的一次前向+反向。100 轮 × 7 批 = 700 次迭代。

### 可视化时的两个坑

```python
# 坑1：numpy 数组不能和 tensor 直接运算
plt.plot(x, x * coef + 3)     # x 是 tensor，coef 是 numpy，这样写反而 OK

# 坑2：带梯度的张量不能转 numpy，必须先 detach
plt.plot(x, [i.detach().numpy() for i in model(x)])

# 更简洁的写法
y_pred = model(x).detach().numpy()
```

`detach()` 的作用是**把张量从计算图里摘出来**，之后就不再追踪梯度。凡是**只用来查看/画图/保存**的模型输出，都应该先 detach 再转 numpy。

## 模型的保存与加载

训练很贵，训完一定要存下来：

```python
# 保存（只存参数，推荐做法）
torch.save(model.state_dict(), 'model.pth')

# 加载
model = MyModel(...)
model.load_state_dict(torch.load('model.pth', weights_only=True))
```

推荐**只保存 `state_dict`（参数字典）**而不是整个模型对象。因为整个模型序列化后会依赖当时的类定义代码，类一改就加载不了。

## train 模式与 eval 模式

模型有两个模式，行为不同：

```python
model.train()   # 训练模式：启用 Dropout、BatchNorm 用当前批次的统计量
model.eval()    # 评估模式：关闭 Dropout、BatchNorm 用训练时累积的全局统计量
```

**忘了在推理前调 `model.eval()` 是个经典 bug**——开着 Dropout 做预测，结果会随机且不稳定。更稳妥的做法是配合 `torch.no_grad()`：

```python
model.eval()
with torch.no_grad():        # 不构建计算图，省显存、提速
    y_pred = model(x_test)
```

## 大模型应用开发中的落地

**第一，微调大模型的训练循环和这里完全一样**。只是模型从 `nn.Linear` 换成了 `AutoModelForSequenceClassification`，数据从数值特征换成了 token 化的文本。五步训练法一行不变。理解了这里，你就看得懂任何 HuggingFace 的训练脚本。

**第二，`no_grad()` 是推理服务的必选项**。做推理时不需要梯度，加上 `with torch.no_grad()` 能显著减少显存占用。这也是为什么同一个模型，推理时能跑比训练时大得多的 batch。

**第三，混合精度训练用的就是梯度的缩放机制**。`torch.cuda.amp.autocast()` 用 float16 做前向加速，同时用 `GradScaler` 把 loss 放大后再 backward，避免 float16 下梯度下溢成 0——本质还是对 `backward()` 的一层包装。

**第四，梯度累积是小显存训练大模型的标准技巧**。想要 batch_size=64 但显存只够 16，就每 4 个 batch 才做一次 `optimizer.step()`，中间只调 `backward()` 累积梯度。这是消费级显卡微调大模型的必备手段。

```python
accumulation_steps = 4
for i, (x, y) in enumerate(dataloader):
    loss = loss_fn(model(x), y) / accumulation_steps  # 注意要除以累积步数
    loss.backward()
    if (i + 1) % accumulation_steps == 0:
        optimizer.step()
        optimizer.zero_grad()
```

## 小结

自动微分让"算梯度"这件事彻底自动化——**只要张量带 `requires_grad`，`loss.backward()` 就会算出所有参数的梯度**。而训练循环永远五步：预测 → 算损失 → backward → step → zero_grad。配套的基础设施是 `TensorDataset` + `DataLoader` 做分批，以及 `train()/eval()` 加 `no_grad()` 切换模式。

训练能跑起来了，但"跑得动"和"跑得好"是两回事。学习率怎么设、用哪个优化器，直接决定收敛速度和最终效果，接着看 [优化器与学习率调度：从 SGD 到 Adam](article.html?slug=dl-optimizers)。
