---
title: NumPy 与 Pandas 数据处理
slug: numpy-pandas
summary: NumPy 管数值计算、Pandas 管表格处理，从数组创建、矩阵运算、广播机制，到 DataFrame 的查询、分组聚合与 CSV 清洗。
tags: [Python, NumPy, Pandas, 数据分析]
section: 学习笔记
topic: 数据与存储
subtopic: ""
published: true
---

数据分析三剑客各有分工：**NumPy** 负责数值计算（生成、运算数据），**Pandas** 负责表格处理（查询、清洗、聚合），**Matplotlib** 负责可视化。本文先讲前两个——它们是后续一切数据分析的地基。

## NumPy：数值计算

NumPy 的核心是 `ndarray`——一个高效的多维数组，比 Python 原生列表快得多，也支持向量化运算。

### 创建数组

```python
import numpy as np

np.array([1, 2, 3])                # 一维数组
np.array([[1, 2], [2, 3]])         # 二维数组

np.zeros((2, 3))                   # 全 0 数组
np.ones((2, 3))                    # 全 1 数组

np.arange(0, 10, 3)                # 起始 0、结束 10、步长 3（包头不包尾）
np.linspace(1, 2, 3)               # 1 到 2 均分成 3 份

np.random.rand(2, 3)               # 0~1 均匀分布
np.random.randn(2, 3)              # 标准正态分布（约 -3~3）
```

### 数组属性与形状处理

```python
a = np.array([[1, 2, 3], [4, 5, 6]])
a.ndim        # 2  维度
a.shape       # (2, 3) 形状
a.size        # 6  元素总数
a.dtype       # 数据类型

a.reshape(3, 2)   # 重置形状
a.T               # 转置，行列互换
a.flatten()       # 压成一维
```

### 数组运算与统计

数组支持逐元素的算术和比较运算，矩阵乘法用 `dot` 或 `@`：

```python
a + b        # 逐元素加
a * b        # 逐元素乘
a > b        # 逐元素比较

np.dot(a, b) # 矩阵乘法（前提：A 的列数 = B 的行数）
a @ b        # 等价写法
```

统计函数默认算全局，加 `axis` 参数可以按行或按列：

```python
np.sum(a)            # 全部和
np.sum(a, axis=0)    # 按列求和（每列的和）
np.sum(a, axis=1)    # 按行求和
np.mean(a)           # 均值
np.var(a)            # 方差
np.std(a)            # 标准差
np.max(a) / np.min(a)          # 最大/最小值
np.argmax(a) / np.argmin(a)    # 最大/最小值的索引
```

### 广播机制

广播是 NumPy 最巧妙也最容易出错的地方——不同形状的数组也能运算，靠「从少到多扩散」：

```python
a = np.array([[1, 2, 3], [4, 5, 6], [7, 8, 9]])   # (3,3)
b = np.array([10, 20, 30])                          # (3,)
print(a + b)   # b 自动「复制」成 3 行再相加
```

广播原则一句话：**维度从尾看，相同才广播，见 1 都能扩，不足就补 1**。

## Pandas：数据处理

Pandas 的两个核心对象：**Series**（一列数据）和 **DataFrame**（一张表）。

### 创建数据

```python
import pandas as pd

# Series：一列
pd.Series([1, 2, 3, 4, 5])
pd.Series({"one": 1, "two": 2, "three": 3})   # 字典时，键变成索引

# DataFrame：多列
df = pd.DataFrame({
    "姓名": ["成员A", "成员B", "成员C"],
    "年龄": [18, 19, 20],
    "部门": ["行政部", "销售部", "销售部"],
})
```

### 查看与查询

```python
df.shape         # 形状
df.columns       # 列名
df.index         # 索引名
df.dtypes        # 每列的数据类型

df.head(2)       # 从头看 2 行
df.tail(2)       # 从尾看 2 行

df["年龄"]             # 按列名取一列
df[["姓名", "年龄"]]    # 取多列
df.loc["索引名"]        # 按标签取行
df.iloc[0]             # 按位置取行（第 0 行）
```

### 筛选、排序、分组聚合

```python
df.query('年龄 > 18 and 部门 == "销售部"')      # 条件筛选
df.sort_values("年龄", ascending=False)          # 按列排序
df.sort_values(["部门", "年龄"], ascending=[False, True])

df.groupby("部门").sum()                          # 单分组单聚合
df.groupby(["部门", "性别"]).sum()                # 多分组
df.groupby("部门").agg(["sum", "mean", "max"])    # 单分组多聚合

df.pivot_table(columns="地区", values="销售额", aggfunc="sum")   # 透视表
```

### 读写 CSV 与空值处理

真实数据第一步永远是「读进来、看有没有空值」：

```python
df = pd.read_csv("data.csv", sep=",", encoding="utf-8")

df.isnull().sum()      # 每列的空值数量
df.notnull().sum()     # 每列的非空数量

df.dropna()                    # 删除带空值的行
df.dropna(axis=1)              # 删除带空值的列
df.dropna(inplace=True)        # 直接修改原数据

df.fillna(0)                   # 空值填 0
df.fillna(df.mean())           # 空值填该列均值
```

## 小结

NumPy 和 Pandas 的分工清晰：**NumPy 面向「数值」**——数组、矩阵运算、广播、统计；**Pandas 面向「表格」**——DataFrame 的增删查改、分组聚合、清洗。目标是「看到 API 能理解在干嘛」，用到哪个再查哪个。下一篇讲 Matplotlib，把数据画成图。
