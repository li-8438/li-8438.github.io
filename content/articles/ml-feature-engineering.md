---
title: 特征工程：归一化、标准化与独热编码
slug: ml-feature-engineering
summary: 为什么量纲差异会让模型训练崩掉？归一化与标准化怎么选、独热编码什么时候用、以及这些操作在 Embedding 和大模型场景里为什么依然重要。
tags: [机器学习, 特征工程, 归一化, 标准化, One-Hot]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

先说一个真实的翻车场景：用"面积（50~200 平方米）"和"房龄（0~30 年）"预测房价。面积这个特征的数值范围远大于房龄，在梯度下降中它对损失的贡献会被放大，模型会**严重偏向数值大的特征**，训练过程震荡、收敛极慢。

这就是特征缩放（Feature Scaling）要解决的问题。它是特征工程里最基础、也最容易被忽略的一步。

## 归一化：把数据压到 0~1

归一化（Normalization）也叫最小-最大缩放，公式是：

```
x_new = (x - x_min) / (x_max - x_min)
```

结果所有值都被映射到 **[0, 1]** 区间。

```python
from sklearn.preprocessing import MinMaxScaler

scaler = MinMaxScaler()
x_train_scaled = scaler.fit_transform(x_train)  # 训练集：先 fit 再 transform
x_test_scaled  = scaler.transform(x_test)       # 测试集：只 transform，绝不重新 fit
```

**它的致命缺点是怕异常值**。假设 99 个样本的收入在 5000~20000 之间，但有 1 个是 1000 万，那么 `x_max` 被这个离群点拉到 1000 万，剩下 99 个样本全被压缩到 0.002 附近，特征几乎失去了区分度。

所以归一化适合**数据分布边界明确、且没有极端离群值**的场景，比如图像像素值（天然就在 0~255）。

## 标准化：把数据变成均值 0 标准差 1

标准化（Standardization）也叫 Z-score 标准化，公式是：

```
x_new = (x - 均值) / 标准差

方差   = (1/n) · Σ(x - 均值)²
标准差 = √方差
```

结果数据变成**均值为 0、标准差为 1** 的分布，但不限制在固定区间内。

```python
from sklearn.preprocessing import StandardScaler

scaler = StandardScaler()
x_train_scaled = scaler.fit_transform(x_train)
x_test_scaled  = scaler.transform(x_test)
```

标准化**对异常值的容忍度比归一化高得多**——因为均值和标准差受单个极端值的影响，远小于 max/min 受的影响。

## 两者怎么选

| 对比项 | 归一化 MinMaxScaler | 标准化 StandardScaler |
|---|---|---|
| 结果范围 | 固定 [0, 1] | 不定，均值 0 标准差 1 |
| 对异常值 | 非常敏感 | 相对稳健 |
| 适合场景 | 数据边界已知、分布均匀 | 数据近似正态、有离群点 |
| 典型用途 | 图像处理、神经网络输入 | 回归、SVM、逻辑回归、PCA |

实践中的默认选择：**拿不准就用标准化**。它是绝大多数算法（尤其是涉及距离计算和梯度下降的）的安全默认值。

一个必须注意的例外：**树模型不需要特征缩放**。决策树、随机森林、XGBoost 这类模型是按阈值切分数据的，数值大小不影响切分逻辑，做不做缩放结果完全一样。

## fit 和 transform 的区别

这是初学者最常搞混的地方，也是**数据泄漏**的主要来源。

- `fit` —— 计算数据的统计参数（最小值/最大值、均值/标准差）
- `transform` —— 用算好的参数去转换数据
- `fit_transform` —— 两者一起做，**只能在训练集上用**

必须严格遵守的规则：

```python
# ✅ 正确：用训练集的参数去转换测试集
scaler.fit(x_train)
x_train_s = scaler.transform(x_train)
x_test_s  = scaler.transform(x_test)

# ❌ 错误：测试集重新 fit，等于偷看了测试集的分布
x_test_s = scaler.fit_transform(x_test)
```

为什么错？因为真实场景中，新数据是**一条一条**来的，你不可能先攒一批算好均值和标准差再去预测。测试集在这个意义上的角色是"未来数据"，只能用训练集学到的参数。

## 独热编码：把类别变成数字

模型只认数字，但数据里大量是类别字符串：性别（男/女）、城市（北京/上海/广州）、颜色（红/绿/蓝）。

最简单的想法是映射成 1/2/3。但这样会**凭空引入大小关系和距离**——模型会认为"广州(3) > 北京(1)"，还会认为北京和上海的距离(1)小于北京和广州的距离(2)。实际上这三个城市之间没有任何顺序关系。

**独热编码（One-Hot Encoding）** 解决这个问题：一个类别变量展开成多个二值列，属于该类为 1，否则为 0。

```
性别: ['male', 'female']
          ↓
   sex_male  sex_female
      1          0        ← 男
      0          1        ← 女
```

```python
import pandas as pd

df = pd.DataFrame({'Sex': ['male', 'female', 'male'], 'Age': [22, 28, 35]})
df_encoded = pd.get_dummies(df)   # 自动对所有类别列做独热编码
```

用 sklearn 版本（更适合放进流水线）：

```python
from sklearn.preprocessing import OneHotEncoder

encoder = OneHotEncoder(sparse_output=False, handle_unknown='ignore')
# handle_unknown='ignore' 很关键：遇到训练集没见过的类别不会报错，而是全 0
x_encoded = encoder.fit_transform(x_train[['Sex', 'City']])
```

### 独热编码的坑

**维度爆炸**。如果一个特征是"用户所在城市"，有 300 个取值，独热后会多出 300 列。特征维度暴涨会让模型更难训练，也更容易过拟合。

高基数类别的替代方案：
- **目标编码（Target Encoding）** —— 用该类别对应的目标变量均值来编码
- **Embedding** —— 深度学习里用低维稠密向量表示类别，这是大模型的标准做法
- **分箱** —— 把低频类别归并为"其他"

还有一点：独热编码后各列是**完全共线**的（知道前 n-1 列就能推出最后一列），这叫虚拟变量陷阱。做线性回归时建议用 `drop='first'` 丢掉一列。

## 大模型应用开发中的落地

**第一，向量归一化是 RAG 的标准操作**。Embedding 模型输出的向量在做相似度检索前，通常会先做 L2 归一化（把向量缩放到模长为 1）。归一化之后，余弦相似度就等于向量点积，检索可以直接用矩阵乘法加速，这也是向量数据库里 `normalize_embeddings=True` 这个参数的由来。

```python
import numpy as np

def l2_normalize(vec):
    return vec / np.linalg.norm(vec, axis=-1, keepdims=True)

# 归一化后，余弦相似度 == 点积，检索速度大幅提升
sim = l2_normalize(query_vec) @ l2_normalize(doc_vecs).T
```

**第二，Tokenizer 输出的 input_ids 也是一种编码**。只不过它比独热高效得多——独热是"词表多大就有多少维，且只有一个 1"，而 Tokenizer 给每个 token 一个整数 ID，再由 Embedding 层查表映射成**低维稠密向量**（比如 768 维）。这既避免了维度爆炸，又能表达语义相似性，是独热编码的全面升级版。

**第三，输入大模型的数值特征同样需要归一化**。如果你在做多模态或结构化数据预测，把"价格""数量"这类字段直接拼进提示词或特征向量，量纲差异会让模型难以学到有效模式。先标准化再输入，效果通常有明显提升。

**第四，序列长度要对齐**。批量推理时，一批文本的 token 数不同，需要用 padding 补齐到相同长度，同时用 attention_mask 标记哪些是真实 token、哪些是填充。这就是"标准化"思想在序列数据上的体现——让不同长度的输入变成规整的张量。

## 小结

特征工程三件套：**归一化**把数据压到 [0,1] 但怕异常值，**标准化**转成均值 0 标准差 1 更稳健（拿不准就选它），**独热编码**把无序类别变成二值向量但要防维度爆炸。而贯穿这一切的铁律是：**只能用训练集的参数去转换测试集**，否则就是数据泄漏。

特征准备好了，就可以开始跑算法了。第一个要学的是最简单直观的 KNN —— 它连"训练"都不需要，接着看 [KNN 算法：原理、K 值选择与鸢尾花实战](article.html?slug=ml-knn)。
