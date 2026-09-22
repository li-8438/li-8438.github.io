---
title: Python 文件读写与异常处理
slug: python-file-exception
summary: 用 try/except 兜住错误，用 open/with 读写文件，再掌握 os 模块操作文件和文件夹。
tags: [Python, 文件, 异常]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

程序不可能永远不出错：文件可能不存在、用户可能乱输入、网络可能超时。写程序要做的，是**让错误可控**——出错时给出提示、保住关键状态，而不是直接崩溃。这就是异常处理，和文件读写一起，构成了「和外部世界打交道」的基本功。

## 异常处理

异常处理的核心目的：防止一段代码报错影响后续代码的执行。

```python
try:
    result = 10 / 0     # 尝试执行的代码
except Exception as e:
    print("出错了：", e)  # 报错时执行
else:
    print("没报错")       # 没有报错时执行
finally:
    print("无论报不报错都会执行")
```

四个块的分工：

- `try`：放可能出错的代码。
- `except`：捕获异常，`as e` 拿到异常对象，`e` 里是报错信息。
- `else`：`try` 里没抛异常时才走这里。
- `finally`：无论是否异常都会执行，常用来做清理（关文件、释放连接）。

一个实用技巧：当你不确定一段代码会不会出问题时，先用 `try` 包住，保证主流程不被中断。

## 文件读写

读文件和写文件，都从一个 `open` 开始：

```python
f = open(
    file="data.txt",       # 路径：相对路径或绝对路径
    mode="r",              # 打开模式
    encoding="utf-8",      # 编码
)
content = f.read()         # 读整个文件
f.close()                  # 记得关闭
```

### 打开模式

| 模式 | 含义 |
|------|------|
| `r` | 只读，光标在开头，文件不存在会报错 |
| `w` | 写入，光标在开头，会覆盖原内容，可创建文件 |
| `a` | 追加，光标在结尾，不会覆盖 |
| `b` | 二进制模式（图片、视频） |
| `+` | 扩展，如 `r+` 读写、`w+` 读写、`rb+` 二进制读写 |

### 读的三种方式

```python
f.read()          # 一次读整个文件
f.read(10)        # 读 10 个字符
f.readline()      # 一行一行读
for line in f:    # 更优雅的逐行遍历
    print(line)
```

### 用 with 自动关闭

手动 `close()` 容易被忘记，`with` 语句会在代码块结束时自动关闭文件，是官方推荐写法：

```python
with open("data.txt", mode="r", encoding="utf-8") as f:
    content = f.read()

with open("out.txt", mode="w", encoding="utf-8") as f:
    f.write("写入一行内容")
```

## 编码问题

读写文件最常见的坑就是编码不一致。中文在 Windows 上默认可能是 GBK，而现代标准是 UTF-8。规则很简单：**打开文件时用的 encoding，要和你写文件时用的一致**。看到 `UnicodeDecodeError`，先去查编码。

## os 模块

`os` 是内置的「文件和文件夹操作」工具包：

```python
import os

os.mkdir("新文件夹")      # 创建文件夹
os.rmdir("新文件夹")      # 删除空文件夹
os.remove("文件.txt")     # 删除文件
os.listdir(".")          # 查看文件夹下有哪些内容
os.getenv("PATH")        # 读取环境变量
```

## 小结

异常处理让程序「摔倒了能爬起来」，文件读写让程序「能存取数据」，`os` 模块让程序「能操作文件系统」。这三样是把脚本变成「能干实事」的工具的关键一步。到这里，Python 基础语法的主体就齐了，下一篇开始进入进阶主题。
