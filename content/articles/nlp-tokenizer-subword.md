---
title: 大模型分词器：BPE、WordPiece 与 SentencePiece
slug: nlp-tokenizer-subword
summary: 为什么中文比英文更费 token？为什么同一个词在不同模型里 token 数不一样？这篇讲清 BPE、WordPiece、SentencePiece 三种子词算法的原理与差异，以及分词器如何影响成本和上下文长度。
tags: [NLP, Tokenizer, BPE, WordPiece, 大模型]
section: 学习笔记
topic: 模型基础
subtopic: NLP
published: true
---

做大模型应用时，第一个撞上的实际问题往往是：**这段文本有多少 token？**

因为 token 数决定了两件事——**你要花多少钱**（API 按 token 计费）和**能不能塞进上下文**（模型有 token 上限）。而这个问题背后的答案，全在**分词器（Tokenizer）** 身上。

很多人有个误解，以为大模型是按"字"或"词"来读文本的。都不是。它读的是 **token**——一种介于字符和词之间的**子词（subword）**单位。

## 为什么不能按词切

最直觉的做法是按词切（空格分词），但这条路走不通：

**词表爆炸**。英文有几十万种词形变化（run / runs / ran / running），加上专有名词、新词、拼写变体，词表会无限膨胀。GPT 级别如果按词建表，词表得上千万，光 Embedding 层就几百 GB。

**未登录词（OOV）无解**。遇到训练时没见过的词（新出的网络用语、人名、专业术语），模型完全不知道怎么处理，只能给一个 `<UNK>`，信息全丢。

**复合词地狱**。德语这种语言，一个词可能由五六个单词拼成，按词切的话几乎每个词都是 OOV。

**无空格语言没法切**。中文、日文、泰文根本不用空格分词，按空格切就是一整句。

## 子词切分：折中方案

**子词（Subword）** 的思路是：

- **常见词**保留为完整 token（比如 "the"、"machine"）
- **罕见词**拆成有意义的片段（比如 "unhappiness" → ["un", "happi", "ness"]）

这样既避免了词表爆炸，又永远不会遇到完全不认识的 token——再生僻的词，大不了拆到字符级别，而字符表是固定的。

## BPE：反复合并最高频的相邻对

**BPE（Byte Pair Encoding，字节对编码）** 是目前最主流的算法，GPT 系列、LLaMA、Claude 都在用。

它原本是数据压缩算法，2016 年被引入 NLP。流程非常简单：

```
1. 把所有词拆成单个字符，作为初始词表
2. 统计语料中所有相邻字符对的出现频次
3. 把出现频次最高的那一对合并成新 token，加入词表
4. 重复 2、3，直到词表达到目标大小
```

用一个具体例子看。假设语料里有大量 "low"、"lower"、"lowest"：

```
初始:  l o w / l o w e r / l o w e s t
第1轮: l o w 中的 "lo" 频次最高 → 合并成 "lo"
      lo w / lo w e r / lo w e s t
第2轮: "low" 频次最高 → 合并
      low / low e r / low e s t
第3轮: "er" 频次高 → 合并
      low / low er / low e s t
...
最终:  low / low er / low est
```

最终结果："lowest" 被切成 `["low", "est"]`——两个都有意义的片段。

**BPE 的美妙之处在于它会自然学到语言规律**：`ing`、`tion`、`un`、`pre` 这些前后缀会自动浮现出来，因为它们的组合频次足够高。

### 谁在用 BPE

- **GPT 系列**（GPT-2/3/4）—— OpenAI 的 tiktoken
- **LLaMA / Mistral** —— 字节级 BPE
- **Claude** —— BPE 变体

OpenAI 的 **tiktoken** 是字节级 BPE，以 UTF-8 字节（256 个）为最基础单元，天然支持任何语言和特殊符号。它用 Rust 实现，速度比纯 Python 快数十倍。

```python
import tiktoken

enc = tiktoken.get_encoding("cl100k_base")   # GPT-4 用的编码
tokens = enc.encode("大模型应用开发")
print(tokens)              # 一串整数 ID
print(len(tokens))         # token 数量
print(enc.decode(tokens))  # 还原成文本
```

## WordPiece：按似然而非频次合并

**WordPiece** 是 BERT 用的算法，流程和 BPE 几乎一样，**唯一区别在于合并标准**：

- **BPE** 合并**出现频次最高**的字符对
- **WordPiece** 合并**能让训练数据似然最大化**的字符对

差别在哪？WordPiece 倾向于合并那些**在多种不同上下文中都出现**的组合，而 BPE 只看总数。所以 WordPiece 会避免把两个高频但语义无关的字符强行粘在一起。

**另一个标志特征是 `##` 前缀**：非词首的子词用 `##` 标记。

```
"playing" → ["play", "##ing"]
"unhappiness" → ["un", "##happi", "##ness"]
```

这个前缀告诉模型："这个 token 是接着前面来的，不是新词的开头"。解码时看到 `##` 就知道不用加空格。

谁在用：**BERT、DistilBERT、ELECTRA**。

## SentencePiece：不依赖空格的语言无关方案

**SentencePiece**（Google）走了完全不同的路子：**它不假设空格是词的分界**。

前面两种算法都要先按空格预分词（pre-tokenization），遇到中文、日文这种没空格的语言就抓瞎了。SentencePiece 直接把输入当成**原始字符流**，空格本身被当作一个特殊字符 `▁`（Unicode 的下划线符号）编码进 token。

```
"Hello world" → ["▁He", "llo", "▁world"]
```

注意 `▁` 标记了词的开头。这样做的好处是：**分词结果可以无损还原成原文**（reversible），因为空格信息被完整保留了。

SentencePiece 是个框架，内部可以用两种算法：
- **BPE 模式** —— 自底向上合并
- **Unigram 模式** —— 自顶向下裁剪

**Unigram** 和 BPE 方向相反：先准备一个超大词表，然后**迭代删除那些对整体似然影响最小的 token**，直到词表缩到目标大小。它的优势是能为同一段文本给出**多种分词方案及各自概率**，训练时可以随机采样，起到正则化效果。

谁在用：**T5、Gemini、ALBERT、XLNet**（Unigram 模式）；**LLaMA 1/2**（BPE 模式）。

## 三种算法对比

| 算法 | 合并策略 | 词表大小 | 代表模型 | 特点 |
|---|---|---|---|---|
| **BPE** | 合并最高频对 | 30k~200k | GPT-4、LLaMA、Claude | 最主流，通用性强 |
| **WordPiece** | 合并最高似然对 | 30k 左右 | BERT、ELECTRA | `##` 标记续接子词 |
| **SentencePiece** | 原始字符流，可配 BPE/Unigram | 8k~32k | T5、Gemini、ALBERT | 语言无关，无损还原 |

## 词表大小的权衡

词表大小是个关键设计决策，两头都有代价：

**词表太小**（比如 8k）：
- 每个词被切得稀碎，序列长度暴涨
- 注意力计算量是长度的平方，成本飙升
- 语义单元不完整，模型学得吃力

**词表太大**（比如 500k）：
- Embedding 层和输出层参数量暴增
- 很多 token 训练数据极少，学不出好表示
- 显存占用大

**主流取值**：30k~50k（BERT、LLaMA）、100k（GPT-4 的 cl100k_base）、200k（GPT-4o 的 o200k_base）。

趋势是**词表越来越大**——GPT-4o 把词表从 10 万扩到 20 万，主要收益是**非英语语言和代码的编码效率显著提升**。同样的文本，GPT-4o 的 token 数比 GPT-4 少，等于变相降价。

## 实践中的关键认知

### 同一个模型，token 数才准

**不同模型的分词器词表不同，同一段文本的 token 数完全不一样**。所以：

- **绝对不能用"字数 × 系数"估算成本**，必须用目标模型的分词器实算
- 也**不能跨模型比较上下文长度**——128K token 在 GPT-4 和 Gemini 里能装的文本量不同

```python
from transformers import AutoTokenizer

text = "大模型应用开发需要掌握 RAG 技术"
for name in ["gpt2", "bert-base-chinese"]:
    tok = AutoTokenizer.from_pretrained(name)
    print(name, len(tok.encode(text)), tok.tokenize(text))
```

### 中文通常更"费" token

这是个扎心但重要的事实：**同样的语义内容，中文消耗的 token 通常比英文多**。

原因是主流分词器（尤其是 OpenAI 的）主要用英文语料训练，常见英文单词往往整体是一个 token，而中文字常被切成 1~2 个 token，甚至按 UTF-8 字节拆成 3 个。

**这对做中文应用的直接影响**：同样的对话轮数，中文的 API 成本更高、更容易触达上下文上限。应对策略是**精简提示词、及时压缩历史对话、合理设置 max_tokens**。

### 数字和代码是重灾区

分词器对数字的处理很反直觉：

```
"1234" 可能切成 ["123", "4"] 或 ["12", "34"]
```

这解释了一个著名现象：**大模型做不好算术**。因为它看到的数字不是完整的数值，而是几个 token 的拼接，就像让人用拼音字母做加减法。

同理，代码里的缩进、特殊符号也会消耗大量 token。处理代码时，选择带代码优化词表的模型（如 Codex、DeepSeek-Coder）会更经济。

## 大模型应用开发中的落地

**第一，上线前必须实测 token 消耗**。这是成本控制的基石：

```python
import tiktoken

def count_tokens(text, model="gpt-4"):
    enc = tiktoken.encoding_for_model(model)
    return len(enc.encode(text))

# 估算一轮对话的成本
prompt_tokens = count_tokens(system_prompt + user_input)
estimated_output = 500
total = prompt_tokens + estimated_output
```

**按实测数据而不是估算做预算**，能避免上线后账单翻倍的尴尬。

**第二，提示词压缩的收益可以直接量化**。删掉一段 100 token 的冗余说明，在每天 10 万次调用的场景下，一年能省下的钱是笔实打实的数字。这也是为什么提示词优化不仅是为了效果，也是为了成本。

**第三，上下文窗口管理要基于 token 而非字数**。多轮对话系统必须在每轮之后累计 token 数，接近上限时触发策略：丢弃最早的几轮、对历史做摘要、或者用滑动窗口保留最近 N 轮。**按字数判断会在中文场景下严重失准**。

**第四，微调时分词器必须和模型配套**。用 BERT 的分词器去处理要给 GPT 微调的数据，会得到完全错误的 input_ids。**铁律：模型和分词器必须成对加载**，用 `AutoTokenizer.from_pretrained(同一个模型名)`。

**第五，切分位置会影响模型表现**。有些任务对切分敏感，比如让模型数某个单词里有几个字母——如果这个词被切成多个 token，模型很难数对。遇到这类任务，可以在词之间加分隔符（如 `"a-p-p-l-e"`）强制按字符切分，准确率会明显提升。这是个很实用的技巧。

**第六，Embedding 和 Rerank 模型的分词器可能不同**。做 RAG 时，向量模型和重排模型往往来自不同厂商，各自有独立分词器和长度限制。**分块（chunk）大小要按更严格的那个来定**，否则会出现检索时被截断的文档。

## 小结

分词器是大模型看不见的地基：**BPE 按频次合并（GPT/LLaMA 主流）、WordPiece 按似然合并（BERT 专用，`##` 标记续接）、SentencePiece 不依赖空格（T5/Gemini，对中文友好）**。子词方案同时解决了词表爆炸和未登录词两个问题。

三个必须记住的实践要点：**token 数只能用目标模型的分词器实算**、**中文比英文更费 token**、**模型和分词器必须成对使用**。

词变成了 token，token 变成了向量，接下来该让模型处理序列了。传统方案是 RNN，它的设计直接影响了后来所有序列模型，接着看 [RNN 及其变体：LSTM 与 GRU 的门控机制](article.html?slug=nlp-rnn-lstm-gru)。
