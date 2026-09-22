---
title: 用 Pydantic 做结构化输出：让大模型稳定返回 JSON
slug: llm-structured-output-pydantic
summary: 用 Pydantic 定义输出 schema，让大模型稳定返回可解析的 JSON，配合 OpenAI、LangChain、Instructor 三种方式落地，并避开字段描述不清等常见坑。
tags: [Pydantic, LLM, 结构化输出, JSON]
section: 学习笔记
topic: LLM 应用
subtopic: 提示词工程
published: true
---

大模型的输出是「自然语言」，天然不稳定；而下游程序要的是「确定的结构」——一个 JSON、一个对象。靠提示词里写一句「请返回 JSON」并不保险，模型可能漏字段、加废话、拼错格式。**结构化输出（Structured Outputs）** 就是为彻底解决这个问题：让模型每次都严格遵守你给定的 schema。在 Python 里，定义 schema 最优雅的工具是 **Pydantic**。

## 为什么需要结构化输出

传统做法是「提示词 + 解析 + 失败重试」，脆弱且难维护。结构化输出带来三个确定性：

- 输出严格符合你的 schema，不会漏必需字段、不会编造非法枚举值；
- 拿到的是类型安全的对象，直接 `字段.属性` 就能用，不用手写 `json.loads`；
- 提示词可以更简单，不再需要威逼利诱模型「一定要返回 JSON」。

## 用 Pydantic 定义 schema

Pydantic 用 Python 类定义数据结构，字段上的类型注解就是约束：

```python
from pydantic import BaseModel, Field

class CalendarEvent(BaseModel):
    name: str = Field(description="事件名称")
    date: str = Field(description="日期，格式 YYYY-MM-DD")
    participants: list[str] = Field(description="参与者名单")
```

几个关键点：

- `BaseModel` 是所有模型的基类；
- 类型注解（`str`、`list[str]`、`int`、`bool`）就是字段约束；
- `Field(description=...)` 是**写给模型看的字段说明**——它决定模型会不会填对，含糊的描述会导致模型返回错误类型。

`model_json_schema()` 能把这个模型转成 JSON Schema，也就是模型真正收到的格式要求：

```python
print(CalendarEvent.model_json_schema())
# 输出 {"type": "object", "properties": {...}, "required": [...]}
```

## 三种落地方式

### 方式一：OpenAI 原生 parse

OpenAI SDK 直接接受 Pydantic 模型，返回 `.parsed` 就是填好的实例：

```python
from openai import OpenAI
from pydantic import BaseModel

client = OpenAI()

class CalendarEvent(BaseModel):
    name: str
    date: str
    participants: list[str]

completion = client.beta.chat.completions.parse(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "Extract the event information."},
        {"role": "user", "content": "User A and User B are going to a science fair on Friday."},
    ],
    response_format=CalendarEvent,   # 直接把 Pydantic 模型传进去
)

event = completion.choices[0].message.parsed   # 已经是 CalendarEvent 实例
print(event.name)          # Science Fair
print(event.participants)  # ['User A', 'User B']
```

### 方式二：LangChain

LangChain 用 `with_structured_output` 跨厂商统一封装：

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")
structured_llm = llm.with_structured_output(CalendarEvent)
result = structured_llm.invoke("User A and User B are going to a science fair on Friday.")
# result 就是 CalendarEvent 实例
```

### 方式三：Instructor

Instructor 给客户端打补丁，校验失败时**自动把错误回传给模型重试**，让它自我纠正：

```python
import instructor
from openai import OpenAI

client = instructor.from_openai(OpenAI())
event = client.chat.completions.create(
    model="gpt-4o",
    response_model=CalendarEvent,   # 直接指定返回模型
    messages=[{"role": "user", "content": "..."}],
)
# event 是校验通过的 CalendarEvent 实例，失败会自动重试
```

## 加业务校验

类型对了，不代表值合理。比如价格不能是负数，可以用 `field_validator` 加业务规则：

```python
from pydantic import BaseModel, Field, field_validator

class MenuItem(BaseModel):
    name: str
    price_usd: float = Field(description="价格，纯数字，如 18.50，不要带 $ 符号")
    vegetarian: bool = Field(description="是否无肉")

    @field_validator("price_usd")
    @classmethod
    def price_must_be_positive(cls, v):
        if v < 0:
            raise ValueError("价格不能为负")
        return v
```

## 常见坑

- **字段描述不清**：模型返回 `"18.50 dollars"` 而不是数字 `18.50`。解决：`Field(description="纯数字，如 18.50")`，把格式写进描述里。
- **Optional 列表返回 None**：`participants: list[str] | None` 没给默认值，模型可能返回 `null`。解决：用 `Field(default_factory=list)` 或访问前判断。
- **嵌套过深**：超过 3 层嵌套或 20 个字段会显著增加 token 消耗、降低准确率。解决：拆成多次调用，或扁平化结构。
- **仍有小概率失败**：约 2–5% 的调用可能违反 schema，生产上要包一层重试，或者用 Instructor 的自动重试。

## 小结

结构化输出是「提示词工程」走向「工程化」的关键一步：**用 Pydantic 类描述你想要的数据形状，让模型填进去**。记住三件事——字段描述要具体（这是提示词的一部分）、拿到的是类型安全对象（不用手写解析）、生产上要包重试兜底。下一篇讲怎么用异步和流式让这些调用又快又流畅。
