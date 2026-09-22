---
title: 模型评估：混淆矩阵、精确率召回率与交叉验证
slug: ml-model-evaluation
summary: 准确率 95% 的模型可能是垃圾——这篇讲清混淆矩阵怎么看、精确率和召回率怎么权衡、F1 和 AUC 什么时候用、交叉验证为什么比单次划分可靠，以及网格搜索怎么用。
tags: [机器学习, 模型评估, 混淆矩阵, 交叉验证, 网格搜索]
section: 学习笔记
topic: 模型基础
subtopic: 机器学习与深度学习
published: true
---

先说一个真实教训：某疾病在人群中的发病率是 0.1%。有个模型对所有人一律预测"健康"，准确率高达 99.9%——但它一个病人都没找出来，毫无价值。

这就是只盯准确率的代价。**评估指标选错，模型优化的方向就全错了**。

## 混淆矩阵：一切分类指标的源头

混淆矩阵把预测结果拆成四种情况。先看这张表（以"预测是否患病"为例）：

|  | 预测：正例 | 预测：反例 |
|---|---|---|
| **真实：正例** | TP（猜对了，确实有病） | FN（漏判了，有病没查出来） |
| **真实：反例** | FP（误报了，没病说有病） | TN（猜对了，确实没病） |

命名规则：**第二个字母是模型的预测，第一个字母表示预测得对不对**。TP = True Positive = 预测为正例，且预测对了。

```python
from sklearn.metrics import confusion_matrix

# labels 指定类别顺序，避免顺序搞反
cm = confusion_matrix(y_test, y_pred, labels=[1, 0])
print(cm)
```

## 四个核心指标

从混淆矩阵出发，能算出所有指标：

**准确率（Accuracy）** —— 所有预测里猜对的比例：

```
Accuracy = (TP + TN) / (TP + TN + FP + FN)
```

最直观，但**在样本不平衡时会严重误导**（就是开头那个 99.9% 的例子）。

**精确率（Precision）** —— 模型说是正的里面，真的是正的比例。**查得准不准**：

```
Precision = TP / (TP + FP)
```

追求精确率的场景：**宁可漏，不可错**。比如垃圾邮件拦截——把重要邮件误判成垃圾，代价远大于放进来几封广告。

**召回率（Recall）** —— 真实是正的里面，被找出来的比例。**查得全不全**：

```
Recall = TP / (TP + FN)
```

追求召回率的场景：**宁可错，不可漏**。比如癌症筛查、金融反欺诈——漏掉一个的代价极大。

**F1-Score** —— 精确率和召回率的调和平均，综合评估：

```
F1 = 2 · Precision · Recall / (Precision + Recall)
```

注意是**调和平均**不是算术平均，所以只要有一个很低，F1 就会被拉下来——这正是我们想要的"不能偏科"的特性。

```python
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from sklearn.metrics import classification_report

print('准确率:', accuracy_score(y_test, y_pred))
print('精确率:', precision_score(y_test, y_pred, pos_label=1))
print('召回率:', recall_score(y_test, y_pred, pos_label=1))
print('F1:', f1_score(y_test, y_pred, pos_label=1))

# 一个函数看全部，还带每个类别的明细
print(classification_report(y_test, y_pred))
```

### 精确率和召回率是对立的

这两者几乎永远在拉扯：想提高召回率（多抓），就得放宽标准，误报必然增多，精确率下降；想提高精确率（只抓有把握的），标准收紧，必然漏掉一些，召回率下降。

应对方法：

- **按业务定权重** —— 用 `F-beta`，beta > 1 更看重召回，beta < 1 更看重精确
- **调分类阈值** —— 模型输出的是概率，默认 0.5 一刀切。改成 0.3 会提高召回降低精确，改成 0.7 反之
- **看 PR 曲线** —— 画出不同阈值下的精确率-召回率曲线，选业务最需要的那个点

```python
from sklearn.metrics import precision_recall_curve
import matplotlib.pyplot as plt

# predict_proba 输出概率，而不是 predict 的硬分类
y_score = model.predict_proba(x_test)[:, 1]
precision, recall, thresholds = precision_recall_curve(y_test, y_score)
plt.plot(recall, precision)
plt.xlabel('召回率'); plt.ylabel('精确率')
plt.show()
```

## 交叉验证：别被一次划分骗了

前面一直用的 `train_test_split`，其实有个隐患：**评估结果依赖这一次怎么切的**。运气好切得均匀，分数虚高；运气不好，分数虚低。数据量小的时候，这个波动能有好几个百分点。

**K 折交叉验证（K-Fold CV）** 解决这个问题：把数据分成 K 份，每次拿 1 份做测试、其余 K-1 份做训练，重复 K 次，最后取平均得分。

```python
from sklearn.model_selection import cross_val_score
from sklearn.ensemble import RandomForestClassifier

# cv=5 表示 5 折：训练 5 次，每次用不同的一份做验证，返回 5 个得分
scores = cross_val_score(RandomForestClassifier(), x, y, cv=5, scoring='accuracy')
print('每折得分:', scores)
print('平均得分:', scores.mean(), '±', scores.std())
```

`cv=5` 就是分 5 折，会训练 5 次，最后取平均分。常用取值是 5 或 10。**标准差（std）也很重要**——如果 5 折得分忽高忽低，说明模型不稳定，光看平均分会被误导。

## 网格搜索：让程序帮你调参

模型有很多超参数（KNN 的 K、随机森林的树数、决策树的深度），手调太累。网格搜索的思路很简单：**把所有候选值列出来，穷举所有组合，用交叉验证给每个组合打分，选最高的**。

```python
from sklearn.model_selection import GridSearchCV
from sklearn.ensemble import RandomForestClassifier

param_grid = {
    'n_estimators': [100, 200],
    'max_depth': [5, 10, None],
    'min_samples_leaf': [1, 3]
}

# 传入一个"干净"的模型，返回一个会自动找最优参数的模型
grid = GridSearchCV(
    estimator=RandomForestClassifier(random_state=42),
    param_grid=param_grid,
    cv=5,
    n_jobs=-1    # 并行搜索
)
grid.fit(x_train, y_train)

print('最优参数:', grid.best_params_)
print('最优交叉验证分:', grid.best_score_)
print('测试集得分:', grid.score(x_test, y_test))  # 直接用最优模型评估
```

两点提醒：

**网格搜索必须配交叉验证**。否则参数会过拟合到某一次特定的数据划分上，换一批数据就不灵了。

**组合数量会爆炸**。上面 2×3×2 = 12 种组合 × 5 折 = 60 次训练。参数一多就扛不住，这时改用 `RandomizedSearchCV`——随机采样若干组合，性价比更高。

```python
from sklearn.model_selection import RandomizedSearchCV
from scipy.stats import randint

param_dist = {'n_estimators': randint(50, 300), 'max_depth': randint(3, 15)}
search = RandomizedSearchCV(RandomForestClassifier(), param_dist, n_iter=20, cv=5)
search.fit(x_train, y_train)
```

## 回归问题的评估

分类看准确率，回归看误差：

```python
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

mae  = mean_absolute_error(y_test, y_pred)   # 平均绝对误差
rmse = mean_squared_error(y_test, y_pred) ** 0.5  # 均方根误差
r2   = r2_score(y_test, y_pred)              # R² 决定系数，越接近 1 越好
```

**R²** 的含义是"模型解释了目标变量多少比例的方差"，1 是完美，0 等于直接预测均值，负数说明还不如瞎猜。它比 MAE/RMSE 好在**无量纲**，可以跨任务比较。

## 大模型应用开发中的落地

**第一，RAG 系统的评估就是这套指标的延伸**。

- **检索环节**：召回率（相关文档被检索出来的比例）和精确率（检索出来的文档里相关的比例）是核心指标。RAG 里往往**召回率更重要**——漏掉关键信息，大模型就会编造答案
- **生成环节**：忠实度（答案是否忠于检索内容）、相关性（答案是否回答了问题）
- **整体**：端到端的准确率

做 RAG 优化时，先分别测检索召回率和生成质量，定位瓶颈在哪一环，再针对性优化——这比端到端瞎调有效得多。

**第二，样本不平衡在大模型场景极其常见**。做内容风控时，违规内容可能只占千分之一。这时候准确率毫无意义，必须看**召回率**（漏放了多少违规内容）和**精确率**（误杀了多少正常内容），并根据业务定阈值。误杀用户体验差，漏放有合规风险，这个平衡点必须由业务方拍板。

**第三，交叉验证思维适用于大模型评测集的构建**。只用一份测试集评测大模型，很容易"评测集过拟合"——业界已经有不少模型在公开榜单上刷分、实际表现平平的案例。正确做法是：**留出从不上线的held-out 测试集 + 定期更换评测样本 + 线上 A/B 测试**。

**第四，few-shot 示例的选择可以网格搜索化**。选哪些示例、给几个、按什么顺序，这些都可以当成"超参数"，在一个小验证集上做网格搜索找最优组合。这比凭感觉挑示例靠谱得多，而且成本很低。

## 小结

评估的核心要点：**准确率在样本不平衡时会骗人，必须看精确率（查得准不准）和召回率（查得全不全），两者对立，按业务场景权衡**；用 **K 折交叉验证**替代单次划分，结果才稳定可信；用**网格搜索 + 交叉验证**自动找最优超参数。

这套指标体系不只属于传统机器学习——**它是所有 AI 系统（包括大模型）评测的共同语言**。

上面讲的都是有标签的监督学习。如果数据根本没有标签怎么办？接着看 [KMeans 聚类：无监督学习与簇数选择](article.html?slug=ml-clustering-kmeans)。
