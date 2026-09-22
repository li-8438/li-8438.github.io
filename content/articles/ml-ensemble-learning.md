---
title: 集成学习：Bagging 随机森林与 Boosting
slug: ml-ensemble-learning
summary: 三个臭皮匠顶过一个专家——讲清 Bagging 与 Boosting 两大流派的本质区别、随机森林凭什么比单棵决策树稳、Adaboost 怎么「知错就改」，以及 XGBoost 为什么是比赛神器。
tags: [机器学习, 集成学习, 随机森林, Adaboost, XGBoost]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

上一篇说决策树有两个硬伤：**不稳定**（数据变动一点，树结构大变）和**易过拟合**。集成学习的思路很朴素：既然一棵树不靠谱，那就**同时养很多棵树，让它们投票**。

这不是拍脑袋，有统计依据：假设每棵树的错误率都是 40%、且彼此独立，那么 100 棵树投票后出错的概率会低到接近 0。关键在于**让每棵树犯的错不一样（多样性）**。

按照"怎么养这些树"，集成学习分成两大流派。

## Bagging：并行养树，平权投票

Bagging（Bootstrap Aggregating）的思路是**多棵树同时、独立地训练，最后投票或取平均**。

核心机制是**有放回抽样（Bootstrap）**：从原始数据集中随机抽一个样本记下来、放回去，再抽，重复 N 次。这样每棵树看到的训练集都略有不同，树之间自然产生差异。

三个特征：

1. **有放回抽样** —— 每棵树训练不同的数据子集
2. **并行执行** —— 树之间互不依赖，可以同时训练，天然适合多核
3. **平权投票 / 平均** —— 分类时少数服从多数，回归时取所有树预测的平均值

## 随机森林：Bagging 的最强实现

**随机森林（Random Forest）** 是 Bagging 在决策树上的实现，而且比普通 Bagging 多做了一步——**随机特征选择**。

普通 Bagging 只是样本随机，随机森林还让**每个节点分裂时只从随机抽出的部分特征里挑最优的**。这个"双重随机"进一步加大了树之间的差异，让集成效果更好。

```python
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(
    n_estimators=100,   # 多少棵树，通常 100~500
    max_depth=8,        # 单棵树深度，随机森林里一般也建议限制
    max_features='sqrt',# 每个节点随机考虑的特征数，sqrt(总特征数) 是常用默认
    n_jobs=-1,          # 用满所有 CPU 核心并行训练
    random_state=42
)
model.fit(x_train, y_train)
```

随机森林为什么比单棵决策树强这么多？因为它做了**方差削减**：单棵树的波动被平均掉了。而且它**几乎不会过拟合**——增加树的数量只会让模型更稳，不会让它变差（这点和其他算法很不一样，树越多越好，只是边际收益递减）。

还有个附带好处：随机森林可以**顺便做特征选择**，看 `feature_importances_` 就知道哪些特征有用。

## Boosting：串行养树，知错就改

Boosting 完全换了思路：**树是一棵一棵串行训练的，后一棵树专门去纠正前一棵树的错误**。

三个特征：

1. **基于上一轮的残差强化训练** —— 前一棵树分错的样本，在下一轮会被赋予更高的权重
2. **串行执行** —— 必须等前一棵训完才能训下一棵，无法并行
3. **加权投票 / 加权平均** —— 表现得好的树话语权更大

**Adaboost** 是 Boosting 的经典实现：

```python
from sklearn.ensemble import AdaBoostClassifier
from sklearn.tree import DecisionTreeClassifier

model = AdaBoostClassifier(
    estimator=DecisionTreeClassifier(max_depth=1),  # 弱学习器，常用一层的"决策树桩"
    n_estimators=100,
    learning_rate=0.1,   # 每棵树的贡献权重，越小越需要更多树
    random_state=42
)
model.fit(x_train, y_train)
```

Boosting 的逻辑很像考试复盘：先做一遍，把错题标出来，第二遍重点做错题，第三遍再做还错的……每一轮都在补短板。

## Bagging vs Boosting 怎么选

| 对比项 | Bagging（随机森林） | Boosting（Adaboost/XGBoost） |
|---|---|---|
| 训练方式 | 并行，树之间独立 | 串行，后树依赖前树 |
| 核心目标 | 降低**方差**（让模型更稳） | 降低**偏差**（让模型更准） |
| 对过拟合 | 天然抗过拟合 | 树太多会过拟合，需控制轮数 |
| 对噪声 | 鲁棒 | 敏感（会追着噪声学） |
| 调参难度 | 低，默认参数就能用 | 高，学习率/树深/轮数要仔细调 |
| 训练速度 | 快（可并行） | 慢（串行） |

实践建议：**先用随机森林做基线**——它开箱即用、不需要怎么调参、不容易翻车。如果想要更高的精度，再上 XGBoost / LightGBM 这类 Boosting 模型。

## XGBoost：表格数据的王者

XGBoost 是 Boosting 的工程化巅峰，Kaggle 上长期霸榜。相比 Adaboost 它做了几件关键改进：

- **二阶泰勒展开** —— 用一阶和二阶导数信息，收敛更快
- **内置正则化** —— 目标函数里直接加了 L1/L2 惩罚项，天生抗过拟合
- **自动处理缺失值** —— 不用手动填充
- **工程优化** —— 支持并行、缓存优化、外存计算

```python
import xgboost as xgb

model = xgb.XGBClassifier(
    n_estimators=200,
    max_depth=6,
    learning_rate=0.1,
    subsample=0.8,        # 每棵树只用 80% 样本，增加随机性
    colsample_bytree=0.8, # 每棵树只用 80% 特征
    reg_lambda=1.0,       # L2 正则化
    random_state=42
)
model.fit(x_train, y_train)
```

**在处理结构化表格数据时，XGBoost / LightGBM 至今仍吊打深度学习**。这是个反直觉但很重要的结论：如果你的数据是表格（用户表、订单表），先上 XGBoost，别一上来就搞神经网络。

## 大模型应用开发中的落地

**第一，"集成"思想在大模型里随处可见**。

- **Self-Consistency**（自一致性）：让模型对同一问题采样多次，取多数答案——这就是 Bagging 投票
- **多次调用取最优**：生成 3 个答案让另一个模型打分挑最好的——这是加权投票
- **Model Routing**：把问题分给不同模型，最后综合——集成的变体

**第二，Boosting 的思路就是"迭代优化提示词"**。你发现模型在某类问题上总是答错，于是针对性补充 few-shot 示例或加一条规则，再测，再补——这和 Boosting 提高错分样本权重是一个逻辑。**做提示词工程时应该建立错题集，这比凭感觉调有效得多**。

**第三，别用大模型去做表格分类**。这是最常见的资源浪费。很多团队拿到"用户流失预测""风险等级判定"这类任务就想微调大模型，实际上几千条标注数据下 XGBoost 会又快又准，推理成本只有大模型的万分之一。判断标准很简单：**任务是理解自然语言，还是识别结构化模式？** 前者用大模型，后者用树模型。

**第四，随机森林的特征重要性可以直接优化 RAG**。做检索排序时，你可以把"BM25 分数""向量相似度""文档长度""发布时间"作为特征，训一个模型来预测"这条文档是否相关"。树模型会告诉你哪些特征真正起作用，避免你在无效信号上浪费工程 effort。LightGBM 的 `LambdaMART` 就是专门做排序（Learning to Rank）的成熟方案。

## 小结

集成学习的两派：**Bagging**（随机森林）靠并行养树 + 投票来降方差，稳定抗噪、开箱即用；**Boosting**（Adaboost/XGBoost）靠串行纠错来降偏差，精度更高但对噪声敏感、需要仔细调参。处理表格数据的第一选择是 XGBoost / LightGBM，不是深度学习。

模型能跑起来了，但"跑起来了"不等于"跑得好"。怎么科学评估一个模型、怎么避免被测试集骗了，接着看 [模型评估：混淆矩阵、精确率召回率与交叉验证](article.html?slug=ml-model-evaluation)。
