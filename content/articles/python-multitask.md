---
title: Python 多进程、多线程与 GIL
slug: python-multitask
summary: 区分进程与线程的隔离/共享、守护与互斥锁，再讲清 GIL 这个 Python 特有的限制，以及什么时候该用哪种并发。
tags: [Python, 多线程, 多进程, GIL]
section: 学习笔记
topic: Python
subtopic: ""
published: true
---

一个程序串行地「做完一件再做下一件」太慢，多任务就是让几件事同时推进。Python 提供了进程、线程、协程三套并发方案，它们的取舍关键在两点：**内存是否共享**、**到底在等什么**。

## 为什么需要多任务

假设「吃饭」和「喝水」各要 5 秒，串行执行要 10 秒；如果并行，理论上只要 5 秒。多任务就是为「省时间」服务的。

## 多进程

进程是 CPU 分配资源的最小单位，一个程序至少有一个主进程。多进程的关键特性是**内存隔离**——子进程创建时会复制主进程的变量，各进程改各的，互不影响：

```python
import multiprocessing
import time

def eat(food):
    for i in range(5):
        print(f"吃东西 {food}")
        time.sleep(0.5)

if __name__ == "__main__":
    p1 = multiprocessing.Process(target=eat, args=("苹果",))
    p2 = multiprocessing.Process(target=eat, args=("香蕉",))
    p1.start()   # 开启子进程
    p2.start()
    p1.join()    # 等待子进程结束
    p2.join()
```

进程之间不能直接共享全局变量（各有一份拷贝），但可以通过队列、管道等方式传递数据。进程还能「单个守护」——主进程结束时，守护子进程跟着退出，适合「游戏结束，画面和音频一起停」这类场景。

## 多线程

线程是 CPU 调度的最小单位，一个进程至少有一个主线程。和多进程相反，多线程的关键特性是**共享全局变量**：

```python
import threading
import time

def eat(food):
    for i in range(5):
        print(f"吃东西 {food}")
        time.sleep(0.5)

t1 = threading.Thread(target=eat, args=("苹果",))
t2 = threading.Thread(target=eat, args=("香蕉",))
t1.start()
t2.start()
t1.join()
t2.join()
```

### 共享变量的问题与互斥锁

线程共享全局变量带来一个隐患：多个线程同时改同一个变量，可能「读旧值」导致数据错乱。经典的抢票例子：

```python
import threading
import time

tickets = 3
lock = threading.Lock()   # 一把互斥锁

def buy():
    global tickets
    with lock:            # 上锁，同一时刻只有一个线程能进
        if tickets > 0:
            time.sleep(0.5)   # 模拟支付耗时
            tickets -= 1
            print(f"{threading.current_thread().name} 抢到一张，剩余 {tickets} 张")

threads = [threading.Thread(target=buy, name=f"线程{i}") for i in range(5)]
for t in threads:
    t.start()
for t in threads:
    t.join()
print(f"抢票结束，剩余 {tickets} 张")
```

锁的作用：`with lock` 保证同一时刻只有一个线程执行这段代码，避免「都读到 3 张，结果卖出 5 张」的乌龙。代价是**上锁会降低执行效率**——要并发就必然有等待。

## GIL：进程与线程的真正区别

GIL（全局解释器锁）是 CPython 特有的机制，一句话概括：**同一时刻，一个进程里只有一个线程能执行 Python 字节码**。

打个比方：CPU 是员工，进程是任务，线程是任务里的分支。进程可以被分配给不同 CPU 并行处理；但一个进程内部，GIL 像一把锁，确保同一时刻只有一个线程在跑，其他线程即使 CPU 有空闲也得排队——所以 Python 多线程是「并发」而不是「并行」。

这带来一个实用结论：

- **CPU 密集**（计算量大，如矩阵运算）：多线程受 GIL 限制提速有限，用**多进程**才能真正并行。
- **IO 密集**（大量等待，如网络请求、文件读写）：等待时 GIL 会释放，多线程或协程都能有效提速，这也是「百分之九十场景用多线程」的原因。
- **协程**：比线程更轻量，适合超大量 IO 并发，前面那篇已经讲过。

## 大模型应用：批量调用选协程

大模型应用是典型的 IO 密集场景——大部分时间在等 API 返回。处理批量任务时（比如给 100 篇文档生成摘要），多线程也能做，但更轻量、更主流的是协程 + `asyncio.gather`：

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI()

async def summarize(doc: str) -> str:
    res = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"总结：{doc}"}],
    )
    return res.choices[0].message.content

async def main():
    docs = ["文档1", "文档2", "..."]   # 假设 100 个
    results = await asyncio.gather(*[summarize(d) for d in docs])
    return results

asyncio.run(main())
```

串行 100 篇 × 3 秒 = 5 分钟，`gather` 并发后只要几秒。完整的异步与流式调用，见《大模型 API 的异步与流式调用》一文。

## 小结

三套方案各司其职：**进程**内存隔离、能真并行、开销大，适合 CPU 密集；**线程**共享内存、开销小、受 GIL 限制，适合 IO 密集；**协程**最轻量，适合海量 IO。判断顺序永远是：先看卡在 CPU 还是 IO，再看要不要共享数据。下一篇讲网络编程，那是多任务最典型的应用场景。
