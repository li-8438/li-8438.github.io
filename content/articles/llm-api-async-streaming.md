---
title: 大模型 API 的异步与流式调用
slug: llm-api-async-streaming
summary: 用 asyncio 并发调用大模型 API，把「等待」变成「同时进行」，再用 async generator 加 yield 实现 token 级流式输出。
tags: [Python, asyncio, 流式输出, LLM]
section: 学习笔记
topic: LLM 应用
subtopic: ""
published: true
---

大模型应用有一个残酷的真相：**你的代码绝大部分时间都在等**——等模型生成、等 embedding 接口、等向量库返回。如果串行地「一个等完再等下一个」，一次服务一个用户，资源全浪费在等待上。异步（asyncio）和流式输出，就是为「等待」而生的两个解法。

## await 到底是什么

当你写 `await` 时，Python 会**暂停当前协程，把控制权交还给事件循环**。事件循环去处理其他「已就绪」的任务，等被等待的结果回来，再回到你的协程继续。没有多线程、没有系统级切换，纯协作式调度。

这意味着：一个线程就能同时「挂起」上千个等待中的请求，等待期间不占 CPU。

## 异步客户端

主流 SDK 都提供异步客户端，方法名带 `a` 前缀，配合 `await` 使用：

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI()   # 注意是 AsyncOpenAI，不是 OpenAI

async def ask(prompt: str) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content

asyncio.run(ask("你好"))
```

## 批量并发：asyncio.gather

真正拉开差距的是「同时发多个请求」。串行调 100 个文档、每个 3 秒，就是 5 分钟；用 `asyncio.gather` 并发，全部同时发出，总耗时约等于最慢的那一个（几秒），**提速几十倍，零额外硬件**：

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI()

async def summarize(doc: str) -> str:
    res = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"用一句话总结：{doc}"}],
    )
    return res.choices[0].message.content

async def main():
    docs = ["文档1", "文档2", "文档3", "..."]   # 假设有 100 个
    results = await asyncio.gather(*[summarize(d) for d in docs])
    return results

asyncio.run(main())
```

两个生产细节：

- `asyncio.gather` 默认某个任务失败会抛异常并取消其余任务。批量处理时用 `asyncio.gather(*tasks, return_exceptions=True)` 把成功结果和异常一起收回来，避免一个失败拖垮整批。
- 请求量很大时，别一次性发上千个，用**信号量（Semaphore）** 限制并发数，平衡吞吐和限流。

## 流式输出：async generator + yield

ChatGPT 那种「一个字一个字蹦出来」的效果，靠的是流式输出。开启 `stream=True` 后，返回的是一个生成器，逐个 yield 出 token：

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI()

async def stream_response(prompt: str):
    """异步生成器：token 一到就 yield 出去，不攒整段"""
    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta

async def main():
    full = ""
    async for token in stream_response("解释一下什么是 RAG"):
        print(token, end="", flush=True)   # 实时打印
        full += token

asyncio.run(main())
```

这里正好接上了前面「生成器与协程」那篇的知识：`yield` 让函数能「暂停、产出一个值、再继续」，流式输出就是它最典型的应用——不等整段生成完，来一段吐一段。

## 关注「首 token 延迟」

流式输出的价值不只是「看得爽」，更在于**首 token 延迟（Time to First Token, TTFT）**——从发出请求到第一个字出现的耗时。研究显示用户觉得应用「快」的阈值在 200–300 毫秒内出现第一个字，即使总时长不变。所以衡量流式体验，先看首字延迟，再看整体生成速度。

## 小结

异步和流式是一对搭档：**异步（asyncio + gather）解决「多请求并发」**，**流式（stream + yield）解决「单请求体验」**。判断要不要上异步，就看你卡的是不是「等待」——大模型应用里几乎全是等待，所以这几乎必用。下一篇讲这些调用失败时怎么办：重试、超时和限流。
