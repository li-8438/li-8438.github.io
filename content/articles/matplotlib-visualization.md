---
title: Matplotlib 数据可视化
slug: matplotlib-visualization
summary: 掌握绘图的五步流程，解决中文乱码和负号显示，用一个 GDP 折线图案例串起 pandas 读数据到 matplotlib 出图的全过程。
tags: [Python, Matplotlib, 可视化]
section: 学习笔记
topic: 数据与存储
subtopic: ""
published: true
---

数据算完，还得让人「看得懂」。Matplotlib 是 Python 最基础的绘图库，也是三剑客里的最后一环。它的用法高度套路化——记住一个五步流程，几乎任何图都能照着画。

## 绘图的五步流程

```python
import matplotlib.pyplot as plt

# 1. 设置引擎 + 中文支持
import matplotlib
matplotlib.use("TkAgg")
matplotlib.rcParams["font.sans-serif"] = ["SimHei"]      # 支持中文
matplotlib.rcParams["axes.unicode_minus"] = False        # 负号正常显示

# 2. 设置画板大小
plt.figure(figsize=(9, 6))

# 3. 绘图
plt.plot([1, 2, 3], [4, 5, 6])

# 4.（可选）图例、标题、坐标轴说明、网格
plt.legend()
plt.title("示例图")
plt.xlabel("X 轴")
plt.ylabel("Y 轴")
plt.grid()

# 5. 展示
plt.show()
```

两个中文相关的坑要提前处理：不设 `font.sans-serif` 中文会变成方块，不设 `axes.unicode_minus` 负号会显示成乱码。

## 完整案例：中美日 GDP 折线图

把「读数据 → 预处理 → 绘图」串起来，就是数据分析的最小闭环：

```python
import matplotlib
import matplotlib.pyplot as plt
import pandas as pd

# 1. 引擎 + 中文支持
matplotlib.use("TkAgg")
matplotlib.rcParams["font.sans-serif"] = ["SimHei"]
matplotlib.rcParams["axes.unicode_minus"] = False

# 2. 准备数据：读 CSV、去空值、筛选
df = pd.read_csv("1960-2019全球GDP数据.csv", sep=",", encoding="gbk")
df.dropna(inplace=True)
df_us = df[df["country"] == "美国"]
df_cn = df[df["country"] == "中国"]
df_jp = df[df["country"] == "日本"]

# 3. 把年份设为索引（压缩数据量，属于优化）
df_us.set_index("year", inplace=True)
df_cn.set_index("year", inplace=True)
df_jp.set_index("year", inplace=True)

# 4. 绘图
plt.figure(figsize=(9, 6))
plt.plot(df_us.index, df_us["GDP"], label="美国", color="blue")
plt.plot(df_cn.index, df_cn["GDP"], label="中国", color="red")
plt.plot(df_jp.index, df_jp["GDP"], label="日本", color="yellow")

# 5. 修饰
plt.legend()
plt.title("1960-2019 全球 GDP 数据")
plt.xlabel("年份")
plt.ylabel("GDP")
plt.grid()

plt.show()
```

这段代码把前两篇的内容全用上了：`pandas` 读 CSV、`dropna` 清洗、条件筛选、`set_index` 优化，最后 `matplotlib` 出图。三条折线叠加，一眼看出三国 GDP 的增长趋势。

## 小结

Matplotlib 的套路就五步：**引擎 + 中文 → 画板 → 绘图 → 修饰 → 展示**。两个中文坑（字体、负号）务必先解决。至此，数据分析三剑客齐了：NumPy 算、Pandas 理、Matplotlib 画，一条从原始数据到可视化的完整链路就打通了。

> 本文是「Python 学习笔记」系列的收尾篇。从语法、函数、容器，到面向对象、装饰器、并发，再到数据存储与数据分析，Python 的核心能力就都覆盖到了。
