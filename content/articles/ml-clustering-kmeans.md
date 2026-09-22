---
title: KMeans 聚类：无监督学习与簇数选择
slug: ml-clustering-kmeans
summary: 没有标签怎么做机器学习？讲清 KMeans 的迭代流程、K 值怎么定（肘部法与轮廓系数）、算法的三类局限，并用用户分群案例说明落地思路。
tags: [机器学习, 聚类, KMeans, 无监督学习, 用户分群]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

前面讲的都是**有监督学习**——数据里带着标签，模型学的是"从特征到标签的映射"。但现实中大部分数据是没有标签的：你有一百万用户的购买记录，但没人告诉你他们该分成几类、每类叫什么。

**聚类**就是解决这个问题：不告诉模型任何标准答案，让它自己根据数据的相似性把样本分组。这是**无监督学习**最典型的应用。

## KMeans 的执行流程

KMeans 的算法非常直观，五步就能说清：

1. **确定要分成几个簇（K 值）** —— 这个必须你提前指定
2. **随机挑 K 个样本作为初始簇心**
3. **算距离归类** —— 每个样本计算和 K 个簇心的距离，归入最近的那一簇
4. **重算簇心** —— 每一簇取所有成员的平均位置，作为新的簇心
5. **重复 3、4 步**，直到新簇心和旧簇心位置基本重合（收敛）

```python
from sklearn.cluster import KMeans

model = KMeans(n_clusters=3, random_state=42, n_init=10)
labels = model.fit_predict(x)          # 直接拿到每个样本所属簇的编号
centers = model.cluster_centers_       # 各簇的簇心坐标
```

注意 `n_init=10` 这个参数：因为初始簇心是随机的，不同的起点可能收敛到不同的结果。多跑几次取最优，能有效避免陷入糟糕的局部最优解。

## K 值怎么定

KMeans 唯一必须你指定的参数就是 K，但它恰恰是最难确定的。两个主流方法：

### 肘部法（SSE）

**SSE（误差平方和）** 是每个样本到其簇心距离的平方和。K 越大，簇越细，SSE 必然越小（极端情况 K = 样本数，SSE = 0，但毫无意义）。

画 K-SSE 曲线，找**下降速度突然变缓的那个拐点**（像手臂的肘部），就是合适的 K。

```python
from sklearn.cluster import KMeans
import matplotlib.pyplot as plt

sse = []
for k in range(1, 11):
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    km.fit(x)
    sse.append(km.inertia_)   # inertia_ 就是 SSE

plt.plot(range(1, 11), sse, marker='o')
plt.xlabel('簇数 K'); plt.ylabel('SSE')
plt.title('肘部法')
plt.show()
```

### 轮廓系数（Silhouette Coefficient，SC）

轮廓系数同时考虑了"簇内紧密程度"和"簇间分离程度"，取值 **[-1, 1]**：

- 接近 **1** —— 样本离自己簇很近、离其他簇很远，聚类效果好
- 接近 **0** —— 样本处在两个簇的边界上
- **负值** —— 样本可能分错簇了

```python
from sklearn.metrics import silhouette_score

for k in range(2, 11):
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = km.fit_predict(x)
    print(f'K={k}, 轮廓系数={silhouette_score(x, labels):.3f}')
```

**取轮廓系数最大的 K**。这个方法比肘部法更自动化，因为肘部点有时候肉眼判断很主观。

实践中会**两个方法结合着看**，再叠加一个关键约束：**业务上这个 K 有没有意义**。把用户分成 7 类，运营团队能针对性地设计 7 套策略吗？如果只有 3 套资源，那就聚成 3 类。

## 实战：用户分群

聚类最经典的落地场景就是**用户画像分群**。假设有用户的消费频次、客单价、最近活跃天数三个特征：

```python
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans

df = pd.read_csv('customers.csv')

# 1. 选特征
features = df[['frequency', 'monetary', 'recency']]

# 2. 标准化（聚类基于距离，必须做！）
scaler = StandardScaler()
x_scaled = scaler.fit_transform(features)

# 3. 聚类
model = KMeans(n_clusters=4, random_state=42, n_init=10)
df['cluster'] = model.fit_predict(x_scaled)

# 4. 解读每个簇：看各簇的特征均值
print(df.groupby('cluster')[['frequency', 'monetary', 'recency']].mean())
```

最后一步**最关键也最容易被忽略**：聚类只给你编号 0/1/2/3，不告诉你它们是什么。你必须去看每个簇的统计特征，给它们**起业务名字**。

比如可能得到：高频高消费（VIP）、高频低消费（羊毛党）、低频高消费（潜力客户）、低频低消费（流失风险）。有了名字，运营才能行动。

## KMeans 的三类局限

**第一，必须预先指定 K**。而 K 往往正是你想知道的答案。

**第二，只能发现"球状"簇**。KMeans 用欧氏距离，天然假设每个簇是圆形/球形的。遇到月牙形、环形这类不规则形状的分布，它会分得乱七八糟。这类数据要用 **DBSCAN**（基于密度）或**谱聚类**。

**第三，对初始簇心敏感**。不同的随机起点可能得到完全不同的结果，所以才有 `n_init=10` 这种多次重启的做法。改进版本是 **KMeans++**（sklearn 默认用的就是它），它让初始簇心尽量互相远离，收敛更稳定。

还有两点要注意：
- **必须做标准化** —— 和 KNN 同理，基于距离的算法都对量纲敏感
- **对异常值敏感** —— 一个极端值会把簇心拉偏，必要时先剔除离群点

## 大模型应用开发中的落地

**第一，文档去重是 RAG 建库的第一步**。爬来的知识库文档常常大量重复（同一份制度文件的多个版本、转载的同一篇文章），全部入库会浪费存储，还会让检索结果总是返回几条一模一样的内容。标准做法是：把所有文档做成 Embedding，用 KMeans 聚类，每个簇只保留一篇（或少量）代表性文档。这能把知识库体积砍掉一大半而几乎不损失信息。

**第二，聚类可以自动发现用户意图**。做客服机器人时，把历史用户问题做成 Embedding 后聚类，每个簇往往对应一类意图（退款咨询、物流查询、功能故障）。**这比人工列意图清单靠谱得多**——你能发现意料之外的意图类别，也能验证自己设计的分类体系是否合理。之后每个簇挑几个代表问题作为 few-shot 示例，分类准确率会明显提升。

**第三，聚类 + 采样 = 高质量评测集**。要评测大模型在某个领域的表现，需要一批覆盖各种情况的问题。从大量候选问题中聚类，每个簇各采样几条，能用很小的样本量覆盖尽可能全的场景，比随机采样高效得多。

**第四，聚类是提示词工程的辅助工具**。收集到的失败案例（bad cases）聚类之后，往往能一眼看出失败模式集中在哪几类——是格式问题、理解问题、还是知识缺失。然后针对每一类分别设计解决方案，而不是一次改一堆东西却不知道哪个起作用。

**第五，要注意 Embedding 聚类前先归一化**。和前面讲的一样，做聚类前把 Embedding 向量做 L2 归一化，等价于用余弦距离聚类，对文本相似度更合理。

## 小结

KMeans 五步迭代：**定 K → 随机簇心 → 按距离归类 → 重算簇心 → 收敛停止**。K 值用**肘部法（看 SSE 拐点）**和**轮廓系数（取最大值）**结合业务判断来定。它的两大前提是**必须先标准化**和**只能处理球状簇**。

聚类的价值不在算法本身，而在**聚完之后能不能解读出业务含义**——一堆编号没有意义，给它们起名字才有。

到这里，机器学习部分（回归、分类、聚类、评估）就完整了。接下来进入深度学习：从 PyTorch 张量开始，看神经网络是怎么搭起来并训练的。
