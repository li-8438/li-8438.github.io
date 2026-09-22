---
title: Python 流程控制：分支与循环
slug: python-control-flow
summary: 用 if 做选择、用 while 和 for 做重复，理清分支的四种形态和循环的三要素，让程序不再只会从上往下跑。
tags: [Python, 流程控制, 入门]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

程序默认从上往下一行行执行，但真正的程序几乎都要「看情况走」和「反复做」。前者靠分支（if），后者靠循环（while / for）。本文把这两块的控制结构一次理清。

## 分支语句

分支解决的是「选择性执行」：满足条件才执行某段代码。

### 单分支

```python
age = int(input("请输入你的年龄："))
if age >= 18:
    print("已成年")   # 只有条件成立才执行
```

### 双分支

```python
if age >= 18:
    print("已成年")
else:
    print("未成年")   # 条件不成立时执行
```

### 多分支

多个条件从上到下依次判断，命中一个就停止，都不命中才走 `else`：

```python
score = int(input("请输入成绩："))
if score >= 90:
    print("优秀")
elif score >= 70:
    print("良好")
elif score >= 60:
    print("及格")
else:
    print("不及格")
```

### match-case（Python 3.10+）

Python 3.10 引入的模式匹配，可以理解为「加强版 switch」：

```python
match status:
    case 200:
        print("成功")
    case 404:
        print("页面不存在")
    case 500 | 502:        # | 表示「或」
        print("服务端出错")
    case _:                # 兜底，匹配一切
        print("未知状态码")
```

命中一个 `case` 就停止；`_` 放最后当兜底。

### 分支的嵌套

`if` 里面还能再套 `if`，用来表达更精细的判断：

```python
if age >= 18:
    if age >= 60:
        print("老年")
    else:
        print("成年")
else:
    print("未成年")
```

### 猜数字案例

一个综合运用分支的经典小游戏——随机生成一个数，让用户猜，提示大了还是小了：

```python
import random

num = random.randint(1, 10)
guess = int(input("猜一个 1~10 的数字："))
if guess == num:
    print("猜对了")
elif guess > num:      # 用 elif 替代嵌套，少一层缩进更清晰
    print("猜大了")
else:
    print("猜小了")
```

## while 循环

`while` 是「满足条件就反复执行」，最怕写不出结束条件变成死循环。一个可控的循环有三个要素：

```python
count = 1            # 1. 定义变量，记录循环次数
while count <= 10:   # 2. 结束条件
    print(count)
    count += 1       # 3. 修改变量，向结束条件靠拢
```

### 循环嵌套

循环套循环，就像多层点名：外层每走一步，内层完整跑一遍。九九乘法表是经典例子：

```python
row = 1
while row <= 9:
    col = 1
    while col <= row:
        print(f"{col}*{row}={col*row}", end=" ")
        col += 1
    print()          # 一行结束换行
    row += 1
```

## for 循环

`for` 是 Python 里更常用、更省心的循环：它挨个取出可迭代对象里的每一项，天然不会有「忘记修改变量」导致的死循环。

```python
for i in range(10):      # 0 到 9
    print(i)

for name in ["user_a", "user_b", "user_c"]:
    print(name)
```

`range(start, stop, step)` 生成一个数字序列，遵循「包头不包尾」：

```python
range(5)        # 0,1,2,3,4
range(2, 6)     # 2,3,4,5
range(1, 10, 2) # 1,3,5,7,9
```

一个直观的对比：`while` 适合「循环次数不确定」的场景，`for` 适合「遍历一个确定集合」的场景。`while` 能做的 `for` 基本都能做，除了死循环。

### enumerate 与 zip

遍历时想要「下标 + 值」，或同时遍历两个容器，别用 `range(len(...))` 去拼：

```python
for i, name in enumerate(["user_a", "user_b"], start=1):   # 产出 (下标, 值)
    print(i, name)          # 1 user_a / 2 user_b

for q, a in zip(questions, answers):   # 一一配对，短的走完就停
    print(q, a)
```

### 循环的 else

`for` 和 `while` 还能带 `else`——**循环正常跑完**（没被 `break` 打断）才执行。它在「找东西没找到」的场景特别顺手：

```python
for item in cart:
    if item == "apple":
        print("找到了")
        break
else:
    print("购物车里没有苹果")
```

省掉了「先设一个 found 标志位、循环外再判断」的临时变量。

## break 与 continue

两者都用在循环体里，作用完全不同：

```python
for i in range(1, 10):
    if i == 5:
        break      # 直接结束整个循环
    if i % 2 == 0:
        continue   # 跳过本次，进入下一轮
    print(i)       # 只打印 1、3
```

## 逻辑运算符的短路

前面提到 `and`、`or` 会返回参与运算的值本身，背后是「短路求值」——一旦结果确定就不再往下算。这可以直接用来做登录判断：

```python
account = input("账号：")
password = input("密码：")
if account == "admin" and password == "123456":
    print("登录成功")
else:
    print("账号或密码错误")
```

## 小结

分支和循环是程序的两条腿：分支让代码「会选」，循环让代码「能重复」。记住 while 的三要素、for 的遍历本质、break/continue 的差别，绝大多数流程控制就够用了。下一步把这些结构装进函数，代码才开始真正「可复用」。
