---
title: 端到端实战：用全连接网络做手机价格分类
slug: dl-project-classification
summary: 从读 CSV 到保存模型再到预测评估，走一遍完整的深度学习项目流程，并把训练过程中的优化手段（换优化器、加层、加 BN、学习率衰减）逐个拆解说明。
tags: [PyTorch, 项目实战, 分类, 训练流程, 端到端]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

前面把深度学习的零件都讲了一遍：张量、自动微分、网络层、优化器、正则化。这一篇把它们串起来，走一个完整的真实项目流程——**根据手机参数（电池容量、内存、像素等 20 个特征）预测价格区间（4 个档位）**。

这个项目的价值在于它涵盖了工业界训练模型的**全部标准环节**：数据加载、切分、建模、训练、保存、加载、预测、评估、优化。

## 完整流程概览

```
1. 准备数据      → 读 CSV，分出特征和标签
2. 数据预处理    → 划分训练集/测试集，转张量，封装 Dataset
3. 准备模型      → 定义网络结构
4. 训练模型      → 前向传播 + 反向传播，多轮迭代
5. 保存模型      → 存 state_dict
6. 加载并预测    → 读权重，切 eval 模式，推理
7. 模型评估      → 算准确率
8. 模型优化      → 根据结果调参
```

## 第一步：准备数据

```python
import pandas as pd
import numpy as np
import torch
from sklearn.model_selection import train_test_split
from torch.utils.data import TensorDataset

def create_data():
    # 1.1 加载 CSV
    data = pd.read_csv('手机价格预测.csv', sep=',', encoding='utf-8')

    # 1.2 划分为特征和标签（最后一列是标签）
    x = data.iloc[:, :-1]
    y = data.iloc[:, -1]

    # 1.3 划分训练集和测试集
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=0
    )

    # 1.4 转张量并封装成 Dataset
    train_dataset = TensorDataset(
        torch.tensor(x_train.values, dtype=torch.float32),
        torch.tensor(y_train.values)
    )
    test_dataset = TensorDataset(
        torch.tensor(x_test.values, dtype=torch.float32),
        torch.tensor(y_test.values)
    )

    # 1.5 返回入参和出参数量，建模时需要
    return train_dataset, test_dataset, x.shape[1], len(np.unique(y))
```

几个细节：

**`x_train.values`** —— DataFrame 要先转成 NumPy 数组才能转张量。这是 Pandas → PyTorch 的标准桥接方式。

**标签要用 `torch.long`（int64）** —— `CrossEntropyLoss` 要求标签是类别编号的长整型。`y_train.values` 本身是 int64，转张量后自动正确。

**返回 `input_dim` 和 `output_dim`** —— 搭建网络时必须知道输入特征数和输出类别数，硬编码很容易出错。

## 第二步：定义模型

```python
class PhonePriceModel(torch.nn.Module):
    def __init__(self, input_dim, output_dim):
        super().__init__()
        # 输入 20 维，隐藏层 128 → 256 → 512，输出 4 类
        self.fc1 = torch.nn.Linear(input_dim, 128)
        self.fc2 = torch.nn.Linear(128, 256)
        self.fc3 = torch.nn.Linear(256, 512)

        # 批量归一化，作用在加权求和之后、激活函数之前
        self.bn1 = torch.nn.BatchNorm1d(128)
        self.bn2 = torch.nn.BatchNorm1d(256)
        self.bn3 = torch.nn.BatchNorm1d(512)

        self.out = torch.nn.Linear(512, output_dim)

    def forward(self, x):
        x1 = torch.relu(self.bn1(self.fc1(x)))
        x2 = torch.relu(self.bn2(self.fc2(x1)))
        x3 = torch.relu(self.bn3(self.fc3(x2)))
        return self.out(x3)   # 不加 softmax！CrossEntropyLoss 内部会做
```

**最后一层不加 softmax 是硬规矩**。`nn.CrossEntropyLoss` 的输入必须是原始 logits，它内部集成了 LogSoftmax。如果你自己加了 softmax，等于做了两次，会导致数值不稳定和训练困难。

模型的三要素缺一不可：
- `super().__init__()` 调用父类初始化（漏掉会报错）
- `__init__` 里定义层
- `forward` 里定义数据流向

## 第三步：训练

```python
import time

def train(data, input_dim, output_dim):
    dataloader = DataLoader(data, batch_size=16, shuffle=True)
    model = PhonePriceModel(input_dim, output_dim)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001, betas=(0.9, 0.999))
    scheduler = torch.optim.lr_scheduler.ExponentialLR(optimizer, gamma=0.9)
    loss_fn = torch.nn.CrossEntropyLoss()

    model.train()   # 开启训练模式
    for i in range(100):
        total_loss, count, start = 0, 0, time.time()
        for x, y in dataloader:
            # 前向传播
            pre = model(x)
            loss = loss_fn(pre, y)
            # 反向传播
            loss.backward()
            optimizer.step()
            optimizer.zero_grad()
            # 统计
            total_loss += loss.item()
            count += 1

        scheduler.step()   # 每轮结束更新学习率
        if (i + 1) % 10 == 0:
            print(f'第{i+1}轮, 损失: {total_loss/count:.4f}, 耗时: {time.time()-start:.2f}s')

    # 保存模型参数
    torch.save(model.state_dict(), 'PhonePriceModel.pth')
```

注意循环的三个层次：

```
for epoch in range(100):        # 100 轮，每轮遍历全部数据
    for x, y in dataloader:     # 每轮若干批次，每批 16 条
        ...                      # 每个批次一次前向+反向
    scheduler.step()            # 每轮结束才更新学习率（不是每批！）
```

**`scheduler.step()` 的位置**：PyTorch 新版本要求它在 epoch 循环内（而不是 batch 循环内）。放错位置学习率会衰减过快。

## 第四步：加载并预测

```python
def predict(data, input_dim, output_dim):
    dataloader = DataLoader(data, batch_size=8)   # 测试不打乱
    model = PhonePriceModel(input_dim, output_dim)
    model.load_state_dict(torch.load('PhonePriceModel.pth', weights_only=True))
    model.eval()   # 关键：开启评估模式

    correct = 0
    with torch.no_grad():   # 推理不追踪梯度，省显存
        for x, y in dataloader:
            pre = model(x)
            # argmax 取概率最大的下标作为预测类别
            correct += (torch.argmax(pre, dim=1) == y).sum().item()

    total = len(data)
    print(f'准确率: {correct / total:.4f}')
```

**`torch.argmax(pre, dim=1)`** 是分类任务的标准操作：`pre` 的形状是 `(batch, 4)`，每行 4 个类别的得分，`dim=1` 表示在类别维度上取最大值的下标。

**`with torch.no_grad()`** 在推理时必加，能显著降低显存占用并提速。

**测试集不打乱** —— `DataLoader(test_data, batch_size=8)` 默认 `shuffle=False`，这样才能按顺序对齐预测结果和真实标签。

## 第五步：模型优化

第一轮跑完，准确率可能只有 60% 左右。接下来是**优化环节**，也是深度学习工程中最花时间的部分。

### 优化手段一览

**1. 换优化器** —— 从 SGD 换成 Adam。这是收益最大的一步，通常能带来几个百分点的提升，因为 Adam 的自适应学习率让训练稳定得多。

**2. 增加隐藏层** —— 网络太浅，表达能力不够。从 2 层加到 3 层，配合增加神经元数量（128 → 256 → 512）。

**3. 加 BatchNorm** —— 稳定每层的输入分布，允许用更大的学习率，收敛更快。注意加了 BN 之后，**就不需要再对输入数据做 StandardScaler 了**，网络第一层会自己处理。

**4. 学习率衰减** —— `ExponentialLR(gamma=0.9)` 让后期学习率逐步变小，在最优附近精细收敛。

**5. 增加训练轮数** —— 100 轮不够就加到 200、300。配合早停（Early Stopping）防止过拟合：验证集 loss 连续几轮不降就停止。

**6. 调学习率** —— Adam 常用 1e-3，如果 loss 震荡就降到 1e-4，如果下降太慢就升到 3e-3。

### 优化的诊断顺序

遇到效果不好，按这个顺序排查：

```
1. 先看训练集 loss 有没有降 → 没降说明模型没在学，检查学习率和网络结构
2. 训练集 loss 降但测试集准确率低 → 过拟合，加 Dropout / 减小网络 / 早停
3. 都低 → 欠拟合，加大网络、加特征、训更久
4. loss 震荡或变 NaN → 学习率太大
```

### 查看模型规模

```python
from torchsummary import summary

model = PhonePriceModel(20, 4)
summary(model, input_size=(20,))
```

会打印出每层的形状、参数量，以及总参数量。手算也能估：一个 `Linear(20, 128)` 的参数量是 `20 × 128 + 128 = 2688`（权重加偏置）。

## 小结：可复用的项目模板

把上面的代码抽象成模板，以后任何深度学习项目都能套：

```python
# 1. 数据
train_dataset, test_dataset, in_dim, out_dim = create_data()
train_loader = DataLoader(train_dataset, batch_size=16, shuffle=True)
test_loader  = DataLoader(test_dataset,  batch_size=16, shuffle=False)

# 2. 模型 + 优化器 + 损失
model = MyModel(in_dim, out_dim)
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
criterion = torch.nn.CrossEntropyLoss()

# 3. 训练
model.train()
for epoch in range(num_epochs):
    for x, y in train_loader:
        loss = criterion(model(x), y)
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()

# 4. 保存
torch.save(model.state_dict(), 'model.pth')

# 5. 评估
model.eval()
with torch.no_grad():
    for x, y in test_loader:
        pred = model(x).argmax(dim=1)
```

## 大模型应用开发中的落地

**第一，这个模板就是微调大模型的骨架**。把 `MyModel` 换成 `AutoModelForSequenceClassification`，把 `TensorDataset` 换成 Tokenizer 的输出，其余流程一行不变。HuggingFace 的 Trainer 本质上就是把这套循环封装起来，加了日志、混合精度、梯度累积等工程细节。

**第二，"先跑通再优化"的方法论同样适用**。做大模型应用时，**先用最简单的方式（比如直接调 API + 零样本提示词）跑通基线**，测出准确率，再逐步加 RAG、加 few-shot、考虑微调。跳步直接上复杂方案，出了 bug 根本不知道问题在哪。

**第三，评估集的重要性再怎么强调都不过分**。项目里我们留了 20% 测试集，大模型应用同样需要一份**固定的、人工标注的评测集**。没有它，你所有的优化都是盲目的——改了提示词感觉"好像好了"，但无法量化。

**第四，保存 checkpoint 的习惯要养成**。训练几小时的模型崩了没保存是灾难。大模型场景下更要设 `save_strategy="epoch"`，每个 epoch 存一次，配合 `load_best_model_at_end=True` 自动保留最佳版本。

**第五，注意类别不平衡**。如果手机价格四档里，中档占了 80%，模型只要全预测中档就有 80% 准确率。此时要看每一类的精确率和召回率（`classification_report`），必要时用 `class_weight` 给少数类加权。

## 小结

一个完整的深度学习项目就是八个环节：准备数据 → 预处理 → 建模 → 训练 → 保存 → 加载预测 → 评估 → 优化。核心代码套路固定，真正花时间的是**优化环节**，而优化的前提是**能诊断出问题出在哪**（看训练集和测试集的 loss 曲线对比）。

至此，机器学习与深度学习的主干就走完了。接下来进入 NLP —— 让模型处理人类语言，这也是通向大模型的必经之路，接着看 [NLP 文本预处理：分词、词性标注与命名实体识别](article.html?slug=nlp-text-preprocessing)。
