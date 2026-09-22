---
title: Prompt Chaining 与 ReAct：让模型分步骤完成任务
slug: prompt-chaining-react
summary: 一个提示词搞不定的任务怎么办？这篇讲两种多步执行方案：把任务拆成提示词链的 Prompt Chaining，以及让模型自主「思考-行动-观察」循环的 ReAct 框架，附完整可运行代码。
tags: [提示词工程, ReAct, Agent, Prompt Chaining]
section: 学习笔记
topic: LLM 应用
subtopic: 提示词工程
published: 2026-09-07
---

当任务复杂到一定程度，无论怎么优化单个提示词，模型都做不好。原因很直接：一次性生成几千字还要同时满足十几个约束，任何模型都会顾此失彼。

解决办法是把任务**拆开**，分多次调用模型完成。这一篇讲两种拆分范式：Prompt Chaining（你来编排）和 ReAct（模型自己编排）。

## 一、Prompt Chaining：把任务拆成流水线

### 核心思路

把复杂任务拆成若干子任务，每个子任务一个提示词，**前一个的输出作为后一个的输入**。

```
输入 → [提示词 1] → 中间结果 1 → [提示词 2] → 中间结果 2 → [提示词 3] → 最终输出
```

和上一篇讲的"原则三：复杂任务拆成子任务"看起来像，但有个关键区别：

- **原则三**是在**一个提示词内**列出多个步骤，一次调用全部完成
- **Prompt Chaining** 是把每个步骤拆成**独立的模型调用**，中间结果由你的代码接管

### 为什么值得多花几次调用

1. **效果更好**：每步只做一件事，模型注意力集中，单步准确率高
2. **可控可查**：中间结果你能看到、能校验、能修正。某一步跑偏了，重跑那一步就行，不用全部重来
3. **便于定位问题**：线上出 bad case，你能快速定位是哪一步出错，而不是面对一个黑盒

### 实例：三步生成论文摘要

假设要从一段文本生成学术摘要。一次性让模型生成也能做，但用链式效果更好。

**Step 1：抽取关键信息**

```
你是一个信息抽取专家。请从下面的文本中提取出关键要点，包括：研究背景、研究方法、研究结果、结论。

'''
近年来，深度学习在自然语言处理中的应用取得了突破性进展。本文提出了一种基于注意力机制的改进模型，
并在文本分类任务中进行实验。实验结果表明，该方法相比传统方法提高了 5% 的准确率。
研究结论显示，注意力机制能够显著提升模型的表达能力。
'''
```

输出：

```
- 背景：深度学习在 NLP 中的应用快速发展
- 方法：提出基于注意力机制的改进模型
- 结果：文本分类任务准确率提高 5%
- 结论：注意力机制提升了模型的表达能力
```

**Step 2：组织成摘要草稿**

```
你是一个学术写作助手。请根据以下要点，生成一段逻辑清晰的学术摘要草稿。

'''
- 背景：深度学习在 NLP 中的应用快速发展
- 方法：提出基于注意力机制的改进模型
- 结果：文本分类任务准确率提高 5%
- 结论：注意力机制提升了模型的表达能力
'''
```

输出：

```
本文研究了深度学习在自然语言处理中的应用，并提出了一种基于注意力机制的改进模型。
实验结果表明，该模型在文本分类任务中的准确率相比传统方法提升了 5%。
研究进一步证明了注意力机制能够有效增强模型的表达能力。
```

**Step 3：优化语言风格**

```
你是一个学术语言优化专家。请将以下摘要优化，使其更加简洁、正式且符合学术论文摘要的风格。

'''
本文研究了深度学习在自然语言处理中的应用...
'''
```

最终输出：

```
本文提出了一种基于注意力机制的改进模型，并在自然语言处理的文本分类任务中进行了验证。
实验结果显示，该模型较传统方法提升了 5% 的准确率，证明了注意力机制在增强模型表达能力方面的有效性。
```

每一步的职责单一，输出质量比一次性生成明显更高。而且第二步拿到的是**结构化的要点**而不是原始长文本，模型不容易丢失信息。

代码骨架：

```python
def chain_summarize(text, llm_call):
    """三步链式摘要：抽取 → 起草 → 润色。"""
    keypoints = llm_call(EXTRACT_PROMPT.format(text=text))
    draft = llm_call(DRAFT_PROMPT.format(keypoints=keypoints))
    final = llm_call(POLISH_PROMPT.format(draft=draft))
    return {"keypoints": keypoints, "draft": draft, "final": final}
```

### 适用场景

Prompt Chaining 适合**流程固定、步骤明确**的任务：文档处理流水线、多阶段内容生成、结构化信息抽取。

它的局限是：流程要你**提前写死**。如果任务的下一步取决于上一步的结果（比如"查完才知道还缺什么信息"），固定流水线就应付不了——这就是 ReAct 要解决的问题。

## 二、ReAct：让模型自己决定下一步

### 什么是 ReAct

ReAct 全称是 *Synergizing Reasoning and Acting in Language Models*（在语言模型中协同推理与行动），2022 年提出。

它的灵感来自人类解决问题的方式：先想、再做、看看结果、再调整。

ReAct 把模型的输出组织成三步循环：

- **Thought（思考）**：分析当前状况——我需要什么？还缺什么？下一步做什么？
- **Act（行动）**：执行一个具体动作，通常是调用一个外部工具
- **Observation（观察）**：接收动作返回的结果，作为下一轮思考的依据

这个循环一直持续，直到模型认为信息足够，输出最终答案。

```
        ┌──────────────────────────────┐
        │                              │
        ▼                              │
   Thought ──► Act ──► Observation ────┘
        │
        └──► Final Answer（信息足够时退出）
```

### 完整实现

下面是一个可直接运行的 ReAct 循环。场景是查询当月节假日，模型需要自己判断"先查日期，再查节假日"：

```python
import re
import time
from datetime import datetime

# ── 工具定义 ──────────────────────────────────
def get_current_date():
    """返回当前日期，格式：2026年9月7日"""
    now = datetime.now()
    return f"{now.year}年{now.month}月{now.day}日"


def search_holidays(month: str) -> str:
    """查询指定月份的法定节假日。month 形如 "9月" """
    holidays = {
        "1月": ["元旦：1月1日"],
        "2月": ["春节：农历除夕至正月初六"],
        "4月": ["清明节：4月4日-6日"],
        "5月": ["劳动节：5月1日-5日"],
        "10月": ["国庆节：10月1日-7日"],
    }
    items = holidays.get(month, [])
    if items:
        return f"{month}有以下法定节假日：\n" + "\n".join(items)
    return f"{month}没有法定节假日。"


TOOLS = {"get_current_date": get_current_date, "search_holidays": search_holidays}

# ── ReAct 主循环 ──────────────────────────────
def react_solve(question: str, llm_call, max_iterations: int = 5) -> str:
    steps: list[str] = []

    for i in range(max_iterations):
        context = "\n".join(steps)
        prompt = f"""你是一个使用 ReAct 范式的智能代理，必须严格按以下格式输出：

Thought: <你的思考>
Action: <要执行的动作，从 [{', '.join(TOOLS)}] 中选择，或 Final Answer>
Action Input: <动作输入>

当前上下文：
{context}

问题：{question}
"""
        output = llm_call(prompt)

        thought = re.search(r"Thought:\s*(.*)", output)
        action = re.search(r"Action:\s*(.*)", output)
        action_input = re.search(r"Action Input:\s*(.*)", output)

        if not thought or not action:
            steps.append(f"Error: 无法解析输出格式，请严格按格式输出。")
            continue

        thought_text = thought.group(1).strip()
        action_text = action.group(1).strip()
        input_text = action_input.group(1).strip() if action_input else ""

        steps.append(f"Thought: {thought_text}")
        steps.append(f"Action: {action_text}")

        # 退出条件：模型认为信息已足够
        if action_text == "Final Answer":
            return input_text

        # 执行工具，把结果作为 Observation 追加到上下文
        if action_text in TOOLS:
            try:
                if action_text == "search_holidays":
                    m = re.search(r"(\d+)月", input_text)
                    input_text = f"{m.group(1)}月" if m else f"{datetime.now().month}月"
                    result = TOOLS[action_text](input_text)
                else:
                    result = TOOLS[action_text]()
            except Exception as e:
                result = f"工具执行错误: {e}"
        else:
            result = f"无效动作: {action_text}"

        steps.append(f"Action Input: {input_text}")
        steps.append(f"Observation: {result}")
        time.sleep(0.3)  # 避免频繁调用

    return "无法在限定步数内完成任务。"
```

实际执行轨迹：

```
问题：这个月有几个法定节假日？分别是什么？

【第 1 步】
Thought: 要回答这个问题，我首先需要知道当前是几月。
Action: get_current_date
Observation: 2026年9月7日

【第 2 步】
Thought: 现在是 9 月，接下来需要查询 9 月的法定节假日。
Action: search_holidays
Action Input: 9月
Observation: 9月没有法定节假日。

【第 3 步】
Thought: 根据观察结果，9 月没有法定节假日。
Action: Final Answer
Action Input: 9月没有法定节假日，因此这个月的法定节假日数量为 0。
```

注意模型**自己想出了**"先查日期再查节假日"这个顺序——这不是我们硬编码的。这就是 ReAct 相对 Prompt Chaining 的核心价值：**流程由模型动态规划**。

## 三、ReAct 的三个工程要点

### 必须设置最大迭代次数

模型可能陷入死循环（反复调用同一个工具、或者一直"思考"不行动）。`max_iterations` 是必须的保险，通常设 5-10。超限时返回一个兜底答案，别让请求挂死。

### 输出格式要强约束 + 容错

要求模型严格按 `Thought:` / `Action:` / `Action Input:` 输出，但实际上模型经常不守规矩——多写几个字、换个大小写、加了 Markdown 符号。所以：

- 正则匹配要**宽松**（忽略大小写、允许前后空白）
- 解析失败时把错误信息作为 Observation 回传，让模型自我纠正（上面代码里的 `continue` 就是干这个的）
- 更稳妥的做法是用结构化输出（Pydantic + `response_format`）替代正则解析

### 工具描述决定调用质量

和 Function Calling 一样，模型靠描述判断何时调用哪个工具。`search_holidays` 的描述如果只写"查询节假日"，模型可能传 "2026年9月" 也可能传 "9月"——上面代码里那段正则提取就是在做**输入归一化**。实际项目里应该在工具函数内部做参数容错，而不是依赖模型传对。

## 四、两者怎么选

| 维度 | Prompt Chaining | ReAct |
| --- | --- | --- |
| 流程 | 你提前定死 | 模型动态规划 |
| 可预测性 | 高，每次走同样路径 | 低，不同问题走不同路径 |
| 延迟与成本 | 固定 N 次调用 | 不固定，可能更多 |
| 调试难度 | 低，逐步可查 | 高，需要看完整轨迹 |
| 适用 | 流程固定的批处理任务 | 开放式、需要探索的任务 |

实践建议：**能固定就固定，实在固定不了再上 ReAct**。

固定流程的好处是可预测、可测试、成本可控。只有当任务的路径真的依赖中间结果（比如"查了才知道要不要再查"）时，才值得引入 ReAct 的动态性。

很多生产系统其实是混合的：主干流程用 Chaining 保证稳定，其中某个需要探索的环节内嵌一个 ReAct 子循环。

## 小结

Prompt Chaining 是**你编排流程**，把任务拆成固定的提示词链，每步输出交给下一步；ReAct 是**模型编排流程**，通过"思考 → 行动 → 观察"的循环自主决定下一步。

ReAct 的三个工程要点：设最大迭代次数防死循环、输出解析要容错、工具描述要写清楚实现细节。

ReAct 已经属于 Agent 的范畴了——它给了模型调用工具的能力，让模型从"内容生成器"变成"动作执行者"。但能力越强，被滥用的风险也越大。下一篇讲提示词安全：用户可能怎么攻击你的应用，以及怎么防，见 [提示词安全：注入、越狱与数据泄露的防御](article.html?slug=prompt-security-defense)。
