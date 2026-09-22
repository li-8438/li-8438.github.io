---
title: 大模型 API 的重试、超时与限流
slug: llm-api-retry-timeout
summary: 用 tenacity 的 @retry 装饰器给大模型调用加指数退避重试，只重试该重试的错误，再补上超时和降级兜底。
tags: [Python, tenacity, 重试, LLM]
section: 学习笔记
topic: LLM 应用
subtopic: ""
published: true
---

调用大模型 API 不可能永远成功。三类错误最常见：**429 限流**（请求太频繁）、**5xx 服务端错误**（临时故障）、**网络超时**。直接裸调用，遇到就崩、整个流程中断。正确的做法是**有策略地重试**——而这正是前面「装饰器」那篇知识的最佳落地场景。

## 先区分：哪些错误值得重试

重试不是无脑再来一次。最忌讳「一视同仁」：

- **该重试的**：429 限流、超时、5xx、网络连接错误——这些都是「临时」问题，等一会儿大概率能好。
- **绝不重试的**：400（请求错误）、401（认证失败）、403（无权限）、404——重试一万次也没用，反而浪费时间。

Python 里处理重试，最顺手的库是 `tenacity`。

## 用 tenacity 加重试

`@retry` 装饰器三行搞定，自动实现指数退避：

```python
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from openai import OpenAI, RateLimitError, APITimeoutError, APIConnectionError

client = OpenAI(timeout=30)   # 请求超时 30 秒

@retry(
    stop=stop_after_attempt(5),               # 最多 5 次尝试（1 次初始 + 4 次重试）
    wait=wait_exponential(multiplier=2, min=2, max=60),  # 指数退避：2s→4s→8s→16s
    retry=retry_if_exception_type(
        (RateLimitError, APITimeoutError, APIConnectionError)
    ),
)
def call_llm(prompt: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content
```

三个参数的含义：

- `stop`：重试几次后放弃（不设会无限重试）；
- `wait`：每次重试等多久，指数退避让间隔逐次翻倍（2、4、8、16 秒），给服务端恢复时间；
- `retry`：只对指定的异常类型重试，其余异常立刻抛出。

## 为什么是「指数退避 + 抖动」

立即重试是最坏的选择：你和另外 100 个用户同时撞上 429，又同时立刻重试，只会把限流锤得更狠——这叫「惊群效应（thundering herd）」。指数退避让重试逐渐拉开间隔，再加上一点随机抖动，就能把重试时间打散。`tenacity` 的 `wait_exponential_jitter` 一步到位。

## 超时同样关键

没有超时的请求会一直挂到服务端响应为止。模型偶尔会非常慢（长文本生成、高峰时段），一个卡死的请求会占住一个线程/异步 worker。所以要显式设超时：

```python
client = OpenAI(timeout=30)   # 客户端级默认超时

# 或单次调用级
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[...],
    timeout=60,   # 长生成场景适当放宽
)
```

超时触发会抛 `APITimeoutError`，正好被上面的重试逻辑接住。注意：如果是长输出反复超时，该调大超时值，而不是干脆不设。

## 尊重 Retry-After 头

429 响应里常带一个 `Retry-After` 头，告诉你要等多少秒。生产级代码应该优先读它，而不是只靠自己的退避瞎猜：

```python
except RateLimitError as e:
    retry_after = e.response.headers.get("Retry-After")
    if retry_after:
        time.sleep(int(retry_after))
```

## 重试耗尽后的降级

重试都失败了怎么办？降级——换一个备用模型或返回缓存结果：

```python
from tenacity import RetryError

def safe_call(prompt: str) -> str:
    try:
        return call_llm(prompt, model="gpt-4o")
    except RetryError:
        # 主模型重试耗尽，降级到更便宜的备用模型
        return call_llm(prompt, model="gpt-4o-mini")
```

## 小结

把这篇和「装饰器」「异常处理」串起来，就是一条完整的工程化链路：**装饰器（tenacity）做重试、异常类型区分该不该重试、指数退避防止惊群、超时防止挂死、降级兜底**。这套组合是大模型 API 调用「从 demo 到生产」的分水岭。到这里，大模型应用开发里 Python 的核心技能就补齐了——语法基础之上，结构化输出管「准」，异步流式管「快」，重试容错管「稳」。
