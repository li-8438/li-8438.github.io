---
title: Python 生成器与协程
slug: python-generator-coroutine
summary: 生成器用 yield 实现惰性计算、省内存，协程在它的基础上用 async/await 处理大量 IO 等待，把并发做得轻量。
tags: [Python, 生成器, 协程, asyncio]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

处理大批量数据时，有个常见的痛点：一次性把结果全算出来、全塞进内存，太浪费。生成器和协程正是为「按需、省资源」而生的两个工具——生成器解决「懒计算」，协程解决「大量 IO 等待」。

## 推导式回顾

推导式是「一次性算完、立刻拿到结果」，结果直接占内存：

```python
l1 = [i * 2 for i in range(10)]   # 列表：立刻算完
s1 = {i * 2 for i in range(10)}   # 集合
d1 = {i: i * 2 for i in range(10)}  # 字典
```

## 迭代器

生成器的底层，是一个叫「迭代器（Iterator）」的协议。理解它，生成器和协程里的 `next()`、`for` 循环就都通了。

迭代器协议很简单，一个对象只要实现两个方法，它就是迭代器：

- `__iter__()`：返回迭代器自身
- `__next__()`：返回下一个元素，没有更多元素时抛出 `StopIteration`

```python
class Countdown:
    """从 n 倒数到 1 的迭代器。"""
    def __init__(self, n):
        self.n = n

    def __iter__(self):
        return self               # 迭代器返回自身

    def __next__(self):
        if self.n <= 0:
            raise StopIteration   # 取完了，抛出这个异常
        self.n -= 1
        return self.n + 1

for i in Countdown(3):
    print(i)                      # 3 / 2 / 1
```

`for` 循环的本质就是不断调用 `next()`，直到遇到 `StopIteration` 停下来。

**可迭代对象 vs 迭代器**，这两个词常被混用，区别在于：

- **可迭代对象（Iterable）**：能放进 `for` 循环，实现了 `__iter__`，但未必实现了 `__next__`，比如列表、字符串、字典
- **迭代器（Iterator）**：同时实现了 `__iter__` 和 `__next__`，是「懒」的，用 `next()` 一个个取

```python
lst = [1, 2, 3]
next(lst)          # ❌ 报错：list 不是迭代器，不能直接 next
it = iter(lst)     # ✅ 通过 iter() 把可迭代对象转成迭代器
next(it)           # 1
```

内存占用是迭代器最大的价值：列表要把所有元素同时放进内存，而迭代器每次只产出一个，处理海量数据时能省下大量内存。这正是下一节生成器的核心动机。

## 生成器

生成器的核心是**惰性求值**：不立即算结果，用到哪算到哪，不占内存。

### 生成器表达式

把列表推导式的方括号换成圆括号，就得到了生成器：

```python
gen = (i * 2 for i in range(10))
next(gen)   # 0
next(gen)   # 2
```

`next()` 每次「挤」出一个值。也可以放进 for 循环，让它自动取完：

```python
for i in gen:
    print(i)
```

### 函数生成器：yield

函数里一旦用了 `yield` 关键字，这个函数就变成了生成器。`yield` 会暂停函数、返回一个值，下次 `next` 时从暂停处继续：

```python
def fn():
    print("开始")
    yield 1          # 第一次 next 走到这里，返回 1 并暂停
    print("继续")
    yield 2          # 第二次 next 从这里继续，返回 2
    print("结束")

gen = fn()
next(gen)   # 开始 / 1
next(gen)   # 继续 / 2
```

关键价值：**可以把一个函数拆成多次执行**，中间状态被保留。对比 `return`，`yield` 能「暂停再继续」，这是它和普通函数最本质的区别。

## 协程

协程的原理就是基于生成器，但目标更明确：**处理大量「不需要占 CPU、只是在等待」的任务**，比如网络请求、文件 IO。

核心语法是两个关键字搭配使用：

```python
import asyncio

async def task(name):        # async 标记为异步函数
    print(f"{name} 开始")
    await asyncio.sleep(1)   # await 标记可等待的操作（模拟 IO）
    print(f"{name} 结束")

async def main():
    t1 = asyncio.create_task(task("A"))   # 把协程包装成任务
    t2 = asyncio.create_task(task("B"))
    await t1           # 并发等待多个任务
    await t2

asyncio.run(main())    # 统一入口启动
```

几个要点：

- `async` 标记异步函数，`await` 标记可等待的操作，两者必须搭配。
- `asyncio.create_task` 把协程包装成可并发的任务。
- `asyncio.run` 是统一入口，负责启动事件循环。
- 协程适合「IO 密集」任务——等待时不占 CPU，让别的任务先跑。

## 协程 + httpx

`httpx` 是一个支持异步的网络请求库，和协程搭配能并发发多个请求：

```python
import asyncio
import httpx

async def fetch(url):
    async with httpx.AsyncClient() as client:
        res = await client.get(url)
        return res.text

async def main():
    tasks = [fetch(f"https://example.com/{i}") for i in range(5)]
    results = await asyncio.gather(*tasks)   # 并发等待全部完成

asyncio.run(main())
```

对比串行请求，这种写法把「一个等完再等下一个」变成了「一起等」，IO 密集场景下提速明显。

## 流式输出：yield 的大模型落地

生成器最出彩的应用场景，是大模型的「流式输出」——让回答像打字机一样逐字蹦出来，而不是等整段生成完。开启 `stream=True` 后，返回的就是一个生成器，用 `async for` 逐个取出 token：

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI()

async def stream_response(prompt: str):
    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta   # token 一到就 yield，不攒整段
```

这正是 `yield` 的价值：**函数能暂停、产出一个值、再继续**。完整的异步与流式调用，见《大模型 API 的异步与流式调用》一文。

## 小结

生成器和协程是一条线上的两步进化：**生成器用 yield 做到「暂停 + 惰性」**，**协程在它之上用 async/await 把「等待」变成并发**。判断用不用协程，就看你卡的是 CPU 还是 IO——CPU 密集要靠多进程/多线程，IO 密集才是协程的主场。下一篇讲多进程、多线程和 GIL，正好回答「什么时候该用哪个」。
