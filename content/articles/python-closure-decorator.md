---
title: Python 闭包与装饰器
slug: python-closure-decorator
summary: 先搞懂闭包为什么能「留住」变量，再理解装饰器就是在闭包上再包一层，最终写出通用的计时、日志装饰器。
tags: [Python, 装饰器, 闭包]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

装饰器是 Python 进阶路上绕不开的一关。想真正理解它，得先回答一个问题：函数执行完，它内部的变量不就没了吗？——不一定，这就是闭包。装饰器，本质上就是一个「用来增强函数的闭包」。

## super 关键字

在讲闭包前，先补一个面向对象的收尾知识点。`super()` 用来找到当前类在 MRO（继承链）里的下一级，方便子类调用父类的 `__init__`：

```python
class A:
    def __init__(self):
        self.name = "user_a"
        self.age = 18

class B(A):
    def __init__(self):
        super().__init__()      # 先继承父类的 name、age
        self.money = 100000     # 再加自己的属性

b = B()
print(b.name)    # user_a
```

## 垃圾回收机制

Python 会自动回收「无法被访问到」的变量。一个变量一旦没有任何名字指向它，就被判定为垃圾，等待回收。

## 闭包

闭包是「绕开垃圾回收」的技巧。一个变量本来该在函数结束时被回收，但如果有另一个函数还在引用它，它就「活」了下来。

闭包要同时满足三个条件：

```python
def outer(age):
    name = "user_a"             # 外部函数的局部变量

    def inner():               # 1. 有嵌套：内部函数
        nonlocal age           # 允许修改外层变量
        age += 1
        print(name, age)       # 2. 有引用：访问了外层变量

    return inner               # 3. 有返回：返回内部函数

fn = outer(18)   # fn 就是闭包，它「记住」了 name 和 age
fn()             # user_a 19
fn()             # user_a 20  —— age 被留住了，没有被回收
```

关键理解：`return` 返回的是函数本身，`fn()` 调用才拿到结果。闭包的价值，就是让内部函数能持续访问外部函数的变量，即使外部函数已经执行完了。

## 装饰器的原理

装饰器 = 闭包 + 一层「增强逻辑」。它的本质是：**接收一个函数，返回一个增强了的新函数**。

```python
def check(fn):                 # 接收原函数
    def inner():
        print("前置逻辑")
        fn()                   # 调用原函数
        print("后置逻辑")
    return inner               # 返回增强后的函数

def work():
    print("干活")

new_fn = check(work)   # 手动包装
new_fn()

# 用 @ 语法糖，效果完全一样，更简洁
@check
def work():
    print("干活")

work()
```

`@check` 写在函数定义上面，等价于 `work = check(work)`——把下面的函数交给装饰器加工一遍，再用回原名字。

## 装饰器的四种形态

按「函数有没有参数、有没有返回值」，装饰器要配合不同的写法：

```python
# 无参无返回值
def check(fn):
    def inner():
        fn()
    return inner

# 有参无返回值
def check(fn):
    def inner(a, b):
        fn(a, b)
    return inner

# 无参有返回值
def check(fn):
    def inner():
        res = fn()
        return res          # 把返回值透传出去
    return inner

# 有参有返回值
def check(fn):
    def inner(a, b):
        res = fn(a, b)
        return res
    return inner
```

四种写法容易混，于是有了一个「万能」版本。

## 通用装饰器

用 `*args` 和 `**kwargs` 兜住任意参数，用 `return` 透传任意返回值，一个装饰器通吃所有函数：

```python
def check(fn):
    def inner(*args, **kwargs):
        res = fn(*args, **kwargs)
        return res
    return inner
```

实际项目里最常用的装饰器是「计时」和「日志」，都是在这个通用版上加几行：

```python
import time

def timer(fn):
    def inner(*args, **kwargs):
        start = time.time()
        res = fn(*args, **kwargs)
        cost = time.time() - start
        print(f"{fn.__name__} 耗时 {cost:.4f}s")
        return res
    return inner

@timer
def work(a, b):
    return a + b

print(work(1, 2))
```

## 实战：用装饰器做重试与限流

计时是装饰器最直观的用法，但大模型应用里更值钱的是「重试」和「限流」——这正好就是 `tenacity` 库干的事，它本身就是一堆现成的装饰器：

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
def call_llm(prompt):
    return client.chat.completions.create(...)
```

你手写的 `@timer` 和这里的 `@retry` 是同一套机制：都是「接收函数、返回增强了的新函数」。区别只是 `tenacity` 把「重试、退避、停止条件」这些增强逻辑帮你写好了。装饰器在 AI 工程里的完整落地（重试、超时、限流、降级），见《大模型 API 的重试、超时与限流》一文。

## 多装饰器与带参装饰器

多个装饰器可以叠用。执行顺序是「从下往上装饰，从上往下执行」：

```python
@login      # 先执行 login 的前置
@comment    # 再执行 comment 的前置
def like():
    print("点赞")
```

装饰器本身也可以带参数，这时要再包一层：

```python
def flag(symbol):
    def outer(fn):
        def inner(*args, **kwargs):
            if symbol == "+":
                print("执行加法")
            else:
                print("执行减法")
            return fn(*args, **kwargs)
        return inner
    return outer

@flag("+")
def calc(a, b):
    return a + b
```

## 小结

理清一条线就通了：**垃圾回收 → 闭包留住变量 → 装饰器用闭包包住函数做增强 → 通用版用 *args/**kwargs 通吃**。装饰器最经典的落地是计时、日志、权限校验——它把「横切逻辑」从业务代码里抽出来，让主函数保持干净。下一篇讲生成器和协程，那是「函数」的另一种玩法。
