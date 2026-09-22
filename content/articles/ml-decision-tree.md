---
title: 决策树：信息增益、基尼系数与剪枝
slug: ml-decision-tree
summary: 树模型是怎么自动挑出「哪个特征最该先问」的？这篇讲清信息熵、信息增益、基尼系数的计算逻辑，预剪枝与后剪枝的区别，并用泰坦尼克号案例跑通完整分类流程。
tags: [机器学习, 决策树, 信息增益, 基尼系数, 剪枝]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

决策树是机器学习里**最贴近人类思维方式**的算法。医生诊断时问"发烧吗？→ 咳嗽吗？→ 有接触史吗？"，一步步缩小范围，这就是一棵决策树。

它最大的魅力是**白盒可解释**——训完能直接画出图，每一个判断依据都看得见。这在金融风控、医疗诊断这类需要向监管或客户解释"为什么拒绝"的场景里，是刚需。

## 树是怎么长出来的

决策树的构建流程可以拆成四步：

### 第一步：强制二分

每个节点上，算法要把数据按某个特征**一分为二**：

- **分类问题** —— 问"是不是 xxx"，比如"花瓣长度 > 2.5cm？"
- **回归问题** —— 问"x 是否 >= 阈值"，比如"年龄 >= 30？"

### 第二步：选最有价值的特征

这是决策树的核心。节点上可能有十几个特征可用，**先问哪一个能最快缩小范围？**

衡量标准有两个主流选择：

**基尼系数（Gini）** —— 衡量"不纯度"，值越小说明划分后越纯：

```
Gini = 2 · p(正) · (1 - p(正))
```

其中 `p(正)` 是正样本占比。如果节点里全是正样本（p=1），Gini = 0，纯度最高；如果正负各一半（p=0.5），Gini = 0.5，最不纯。

**信息熵（Entropy）与信息增益** —— 熵衡量不确定性，信息增益是"划分前后熵减少了多少"：

```
Entropy = -Σ p(i) · log₂ p(i)
信息增益 = 划分前熵 - 划分后加权熵
```

算法会**遍历所有特征的所有可能切分点，挑信息增益最大（或基尼系数下降最多）的那个**。

```python
from sklearn.tree import DecisionTreeClassifier

DecisionTreeClassifier(criterion='gini')     # 默认，基尼系数，计算快
DecisionTreeClassifier(criterion='entropy')  # 信息增益，理论上更精细
```

实践中两者效果差异通常很小，基尼系数因为不用算对数、速度快，是默认选择。

### 第三步：递归划分

对每个子节点重复步骤一、二，一层层往下长，直到满足停止条件。

### 第四步：剪枝

如果不加限制，树会一直长到**每个叶子节点只剩一个样本**——训练集准确率 100%，但测试集一塌糊涂，典型的过拟合。剪枝就是主动限制树的生长。

## 剪枝：防过拟合的关键

剪枝分两种思路：

**预剪枝（更常用）** —— 在树生长过程中就设限，长到条件就停：

```python
DecisionTreeClassifier(
    max_depth=5,              # 最大深度，最常用最有效的限制
    min_samples_split=20,     # 节点至少有多少样本才允许继续分裂
    min_samples_leaf=5,       # 叶子节点至少包含多少样本
    max_leaf_nodes=20,        # 最多允许多少个叶子节点
)
```

**后剪枝** —— 先让树长满，再从底部往上删掉那些"去掉后对性能影响不大"的分支。效果通常更好但计算成本高。sklearn 提供了 `ccp_alpha`（成本复杂度剪枝）参数来做后剪枝：树先长满，再按"每剪掉一个分支，误差增加多少"来权衡，`ccp_alpha` 越大剪得越狠。实际工程中预剪枝更常用，因为简单直观。

**最重要的参数是 `max_depth`**。树的深度每增加 1，能表达的规则复杂度就指数上升。从 3 开始试，逐步加大看测试集表现，是标准调参流程。

## 实战：泰坦尼克号生存预测

经典入门案例：根据乘客的舱位、年龄、性别等特征，预测他是否幸存。

```python
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier, plot_tree
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, classification_report
import matplotlib.pyplot as plt

# 1. 加载数据
df = pd.read_csv('titanic_train.csv')
# df.info()  # 先看一眼：Age 列有大量缺失

# 2. 特征选择与数据清洗
x = df[['Pclass', 'Age', 'Sex']].copy()   # copy() 避免后续修改触发警告
y = df['Survived']
x['Age'] = x['Age'].fillna(x['Age'].mean())  # 年龄缺失用均值填充

# 3. 独热编码：Sex 是字符串，必须转成数值
x_new = pd.get_dummies(x)

# 4. 划分数据集
x_train, x_test, y_train, y_test = train_test_split(x_new, y, test_size=0.2, random_state=42)

# 5. 模型训练（限制深度防过拟合）
model = DecisionTreeClassifier(max_depth=4, random_state=42)
model.fit(x_train, y_train)

# 6. 预测与评估
y_pred = model.predict(x_test)
print('准确率:', accuracy_score(y_test, y_pred))
print('精确率:', precision_score(y_test, y_pred, pos_label=1))
print('召回率:', recall_score(y_test, y_pred, pos_label=1))
print('F1 值:', f1_score(y_test, y_pred, pos_label=1))
print(classification_report(y_test, y_pred))
```

### 把树画出来看

决策树最爽的地方就在这里——模型决策过程完全可见：

```python
plt.figure(figsize=(20, 10))
plot_tree(model, filled=True, feature_names=x_new.columns,
          class_names=['遇难', '幸存'], max_depth=3)  # 层数太多会看不清
plt.savefig('./titanic_tree.png', dpi=150)
plt.show()
```

图里每个节点显示四行信息：判断条件、基尼系数、样本数、各类别数量。颜色深浅表示纯度，橙色/蓝色表示倾向的类别。

### 用网格搜索自动调参

手动试参数太累，交给程序：

```python
from sklearn.model_selection import GridSearchCV

param_grid = {
    'max_depth': [3, 4, 5, 6, 8],
    'min_samples_leaf': [1, 3, 5, 10],
    'criterion': ['gini', 'entropy']
}
grid = GridSearchCV(DecisionTreeClassifier(random_state=42), param_grid, cv=5)
grid.fit(x_train, y_train)
print('最优参数:', grid.best_params_)
```

## 决策树做回归

把 `Classifier` 换成 `Regressor` 就是回归树，区别在于：

- 划分标准变成 **MSE**（不再用基尼/熵）
- 叶子的预测值是该叶子内所有样本标签的**平均值**

```python
from sklearn.tree import DecisionTreeRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

model = DecisionTreeRegressor(max_depth=5)
model.fit(x_train, y_train)
y_pred = model.predict(x_test)
print('MAE:', mean_absolute_error(y_test, y_pred))
```

## 决策树的优缺点

**优点**：
- **可解释性极强**，能直接输出规则，业务方看得懂
- **几乎不需要特征工程** —— 不用做标准化（树按阈值切分，量纲无关），不用处理共线性
- 能处理数值和类别混合的特征
- 训练和预测都很快

**缺点**：
- **极易过拟合** —— 单棵树不加限制基本没法用
- **不稳定** —— 训练数据稍微变动，树结构可能大变
- **不擅长处理线性关系** —— 树是阶梯状的分段函数，拟合连续趋势很吃力
- 有偏性 —— 倾向于选择取值多的特征

正是"不稳定"和"易过拟合"这两个缺点，催生了下一篇要讲的**集成学习**——把很多棵树组合起来，让它们互相纠错。

## 大模型应用开发中的落地

**第一，决策树的可解释性是 LLM 时代的稀缺品**。大模型是黑盒，你很难解释"为什么给出这个判断"。在信贷审批、医疗辅助这类受监管场景，往往还是用小模型（决策树、逻辑回归、XGBoost）做决策，因为它能给出可追溯的规则链，合规上站得住。现在的常见架构是**大模型负责理解与生成，小模型负责最终判决**。

**第二，思维链（Chain of Thought）本质上就是一棵决策树**。让大模型"一步步思考再给答案"，等价于让它显式地展开决策路径。提示词里写"先判断意图类别，再决定调用哪个工具，最后组织答案"，就是在手工构造一棵浅决策树。**好的提示词工程，很多工作就是在设计这棵树的分支**。

**第三，决策树的特征重要性可以直接指导提示词设计**。训完树看 `model.feature_importances_`，哪个特征权重最高，说明它最有区分度——这个信息可以直接告诉你：做分类提示词时，应该让模型重点看哪些字段。

```python
import pandas as pd
importance = pd.Series(model.feature_importances_, index=x_new.columns)
print(importance.sort_values(ascending=False))
```

**第四，Agent 里的路由（Router）就是决策树的应用**。根据用户问题分类到"查数据库 / 调 API / 直接回答 / 转人工"，这个分类器可以是训练好的决策树，也可以是让大模型做零样本分类。数据量小时用大模型，数据量大且要求低延迟时换回小模型——这个取舍在大模型应用开发中反复出现。

## 小结

决策树的四步是：**强制二分 → 用基尼系数或信息增益挑最优特征 → 递归划分 → 剪枝防过拟合**。它的核心价值在于**可解释**和**免特征工程**，主要弱点是**不稳定、易过拟合**。

单棵树不够稳，那就多种几棵让它投票——这就是集成学习。接着看 [集成学习：Bagging 随机森林与 Boosting](article.html?slug=ml-ensemble-learning)。
