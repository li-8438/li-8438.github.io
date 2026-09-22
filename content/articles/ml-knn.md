---
title: KNN 算法：原理、K 值选择与鸢尾花实战
slug: ml-knn
summary: 最「懒」的机器学习算法——不需要训练，靠找邻居投票做预测。这篇讲清距离度量怎么选、K 值大小有什么影响、为什么必须做标准化，并用鸢尾花数据集跑完整流程。
tags: [机器学习, KNN, 分类, 鸢尾花, scikit-learn]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

KNN（K-Nearest Neighbors，K 近邻）是最好理解的机器学习算法，一句话就能说清：**要判断一个新样本属于哪类，就看它周围最近的 K 个邻居多数属于哪类**。

它的特别之处在于**没有"训练"过程**——它只是把所有训练数据记下来（所以也叫"惰性学习"），等新数据来了再现场计算。这既是它的优点（简单、无需假设数据分布），也是它的致命缺点（预测时要和全部样本比距离，数据量大时极慢）。

## 算法原理

**分类问题**：找出距离新样本最近的 K 个样本，看它们的标签，票数多的类别就是预测结果。

**回归问题**：同样找 K 个邻居，但取它们标签的**平均值**作为预测值。

```python
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor

clf = KNeighborsClassifier(n_neighbors=5)   # 分类：默认 K=5
reg = KNeighborsRegressor(n_neighbors=3)    # 回归
```

## 距离怎么算

"最近"是用距离定义的，最常用的两种：

**欧氏距离** —— 两点之间的直线距离，最常用的默认选择：

```
d = √[(x1-x2)² + (y1-y2)²]
```

**曼哈顿距离** —— 坐标轴上的绝对距离之和，像在城市街区里走路：

```
d = |x1-x2| + |y1-y2|
```

```python
KNeighborsClassifier(n_neighbors=5, metric='euclidean')  # 欧氏（默认）
KNeighborsClassifier(n_neighbors=5, metric='manhattan')  # 曼哈顿
```

这里就有了一个关键推论：**KNN 对特征量纲极其敏感**。如果"收入"这个特征的范围是 0~100000，而"年龄"是 0~100，那么距离计算会被收入完全主导，年龄基本不起作用。

**所以 KNN 之前必须做标准化**——这是它和树类模型最大的区别。

## K 值怎么选

K 是最关键的超参数，直接决定模型行为：

- **K 太小（比如 K=1）** —— 只看最近的一个邻居，对噪声极度敏感，决策边界崎岖，**过拟合**
- **K 太大** —— 邻居范围过大，远处的样本也参与投票，模型过于平滑，**欠拟合**
- **经验做法** —— 从 3、5、7、9 这些小奇数开始试（奇数可以避免投票平局），用交叉验证选最优

与其手动猜，不如让程序帮你搜：

```python
from sklearn.model_selection import GridSearchCV
from sklearn.neighbors import KNeighborsClassifier

# 网格搜索 + 5 折交叉验证，自动找出最优 K
param_grid = {'n_neighbors': [1, 3, 5, 7, 9, 11]}
grid = GridSearchCV(KNeighborsClassifier(), param_grid, cv=5)
grid.fit(x_train, y_train)

print('最优参数:', grid.best_params_)
print('最优得分:', grid.best_score_)
```

## 实战：鸢尾花分类

鸢尾花（Iris）数据集是机器学习界的 "Hello World"：150 朵花，每朵测了 4 个特征（花萼长宽、花瓣长宽），共 3 个品种。

### 第一步：加载并观察数据

```python
from sklearn.datasets import load_iris

datasets = load_iris()
print(datasets.data)           # 特征，形如 [[5.1, 3.5, 1.4, 0.2], ...]
print(datasets.target)         # 标签，形如 [0, 0, 1, 2, ...]
print(datasets.feature_names)  # ['sepal length', 'sepal width', 'petal length', 'petal width']
print(datasets.target_names)   # ['setosa', 'versicolor', 'virginica']
```

### 第二步：数据可视化

建模前先看一眼数据长什么样，能提前发现很多问题：

```python
import pandas as pd
import matplotlib.pyplot as plt

df = pd.DataFrame(datasets.data, columns=datasets.feature_names)
df['target'] = datasets.target

colors = ['red', 'blue', 'green']
for i in range(3):
    subset = df[df['target'] == i]
    plt.scatter(subset.iloc[:, 0], subset.iloc[:, 2], color=colors[i], label=datasets.target_names[i])

plt.xlabel('花萼长度'); plt.ylabel('花瓣长度')
plt.legend(); plt.show()
```

散点图会告诉你：setosa 这个品种和另外两个**分得特别开**，而 versicolor 和 virginica 有部分重叠。这就预示了模型大概能做到什么水平。

### 第三步：完整建模流程

```python
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import accuracy_score

# 1. 准备数据
x, y = load_iris(return_X_y=True)

# 2. 划分训练集和测试集
x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.2, random_state=42)

# 3. 标准化（KNN 必做！且只能 fit 训练集）
scaler = StandardScaler()
x_train_scaled = scaler.fit_transform(x_train)
x_test_scaled  = scaler.transform(x_test)

# 4. 模型训练
model = KNeighborsClassifier(n_neighbors=5)
model.fit(x_train_scaled, y_train)

# 5. 模型预测
y_pred = model.predict(x_test_scaled)

# 6. 模型评估
print('模型自带评分:', model.score(x_test_scaled, y_test))
print('准确率:', accuracy_score(y_test, y_pred))
```

鸢尾花数据集上，KNN 通常能拿到 95% 以上的准确率。

## KNN 的优缺点

**优点**：
- 原理简单，几乎没有数学门槛
- 无需训练，新数据可以随时加入
- 对数据分布没有假设，能拟合任意形状的决策边界
- 天然支持多分类

**缺点**：
- **预测极慢** —— 每预测一个样本都要和全部训练样本算距离，数据量上万就很吃力
- **对量纲敏感** —— 必须做标准化
- **高维失效** —— 维度很高时，所有样本之间的距离都趋于接近（维度灾难），"邻居"这个概念本身就模糊了
- **对不平衡数据不友好** —— 样本多的类别容易在投票中占优

生产环境中，KNN 很少直接用在大规模在线服务上，更多是作为**基线模型**——先跑一个 KNN 看看数据能到什么水平，再用复杂模型去超越它。

## 大模型应用开发中的落地

**第一，KNN 就是最朴素的"语义检索"**。RAG 系统里用向量相似度找相关文档，逻辑和 KNN 完全一样：把 query 变成向量，在向量库里找最相似的 K 条。区别只在于距离度量从欧氏距离换成了余弦相似度，特征从手工设计的数值换成了 Embedding 向量。向量数据库底层的 HNSW、IVF 索引，本质都是**给 KNN 计算加速**的数据结构。

**第二，"K 值权衡"在 RAG 里一样成立**。K 太小（召回 1 条）可能漏掉关键信息；K 太大（召回 50 条）会把无关内容塞进上下文，反而干扰大模型判断，还会撑爆 token 预算。RAG 的常用取值是 top_k=3~10，也是靠实验调出来的。

**第三，KNN 的"惰性学习"思路在小样本场景很有用**。做意图识别时，如果只有几十条标注样本，微调模型根本不够，把每条样本的文本做成 Embedding 存起来，新 query 来了直接找最相似的几条作为示例塞进提示词（这就是 few-shot 的动态版本），效果往往很好且零训练成本。

**第四，维度灾难提醒我们：Embedding 不是维度越高越好**。常见有 384、768、1536 维。维度越高表达力越强，但检索时区分度会下降、存储和计算成本也更高。实践中的选择是跟着 Embedding 模型走，不要盲目追求高维。

## 小结

KNN 的核心就三件事：**算距离找邻居、分类靠投票回归靠平均、K 值靠交叉验证调**。它最大的实践要点是**必须先做标准化**，最大的局限是**预测慢且高维失效**。

不过 KNN 的思想价值远超它作为模型的价值——"找最相似的 K 个"这个模式，正是现代向量检索和 RAG 的原型。

KNN 只适合中小规模数据。想要处理更大数据量、还能给出可解释规则，就得上决策树了，接着看 [决策树：信息增益、基尼系数与剪枝](article.html?slug=ml-decision-tree)。
