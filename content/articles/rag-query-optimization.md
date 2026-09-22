---
title: RAG 查询优化：改写、变体与 HyDE
slug: rag-query-optimization
summary: 用户的问题往往不是好的检索词。这篇讲三种查询优化手段：追问改写消除指代、查询变体扩展同义表达、HyDE 用假设答案反向检索，以及各自的成本、风险和开关条件。
tags: [RAG, 查询改写, HyDE, Query Expansion]
section: 学习笔记
topic: LLM 应用
subtopic: RAG
published: 2026-09-07
---

RAG 的检索质量取决于两件事：文档侧的表示，和用户问题侧的表示。大多数团队把精力全放在前者（分块、embedding 模型、索引），却忽略了后者——**用户的原始提问往往不是一个好的检索词**。

三种典型情况：

- 追问里全是指代："那审批呢？"——单独看没有任何实体锚点
- 用词和文档不一致：用户说"怎么重置密码"，文档写"密码找回流程"
- 问题太短太模糊："报销"——向量化之后在语义空间里是一团模糊的云

对应的三个解法是：追问改写、查询变体、HyDE。

## 一、追问改写：把指代补全

### 问题

多轮对话里最常见的场景：

```
用户：报销流程是什么？
助手：需要提交申请、部门审批、财务复核三个步骤...
用户：那审批呢？        ← 这句话拿去检索
```

"那审批呢"单独向量化，得到的是一个没有任何有效信息的向量。检索系统要么返回一堆低分文档，要么什么都找不到。

### 解法

结合对话历史，把指代补全成**可独立检索的完整问题**：

```text
"那审批呢？"  →  "报销流程中的审批步骤是什么？"
```

这个任务必须用 LLM 做——中文指代消解（"它""那""这个"）需要理解上下文语义，正则规则覆盖不了多样化的表达。

```python
def rewrite_query_if_needed(query: str, history_messages, should_rewrite: bool) -> str:
    """将依赖上下文的追问改写为独立检索问题。"""
    # 门控：非追问或没有历史，直接返回原问题
    if not should_rewrite or not history_messages:
        return query

    # 只取最近 8 条历史——过长会稀释当前焦点
    history_text = format_messages(history_messages[-8:])

    # 非流式调用：改写需要完整句法
    llm = get_chat_model(streaming=False)
    response = llm.invoke([
        SystemMessage(content=REWRITE_SYSTEM_PROMPT),
        HumanMessage(content=f"对话历史：\n{history_text}\n\n当前问题：{query}\n\n改写后的检索问题："),
    ])

    rewritten = str(response.content).strip()
    if not rewritten:
        raise RuntimeError("查询改写返回空结果，无法生成独立检索问题。")
    return rewritten
```

### 四个设计细节

**门控：只改该改的。** `should_rewrite` 由意图识别决定，只有 `FOLLOW_UP` 类型才改写。`FAQ_QUERY` 和 `KNOWLEDGE_QUERY` 本身已经完整，改写反而引入噪声——把"报销需要什么材料"改成"报销流程需要提交哪些具体材料和单据？"，语义被稀释，检索效果下降。

**历史只取最近 8 条。** 过长的历史会稀释当前提问焦点，指代消解通常只需要最近一轮的信息。

**必须非流式。** 流式拼接片段可能导致句式断裂——"那审批呢"被改成"那审批呢步"这种半截话。而且改写结果的延迟直接叠加到链路里，用流式也没意义（用户不会逐字看改写结果）。

**空结果要硬失败。** 这一点最重要：

> 改写为空说明 LLM 没能理解上下文，此时如果静默回退到原始查询"它呢"，BM25/向量检索会拿到一个无实质语义的短查询，召回质量极差且极难排查。

抛错让调用方感知，比静默降级后给出一个莫名其妙的答案要好得多。

### 成本

改写需要一次额外 LLM 调用，约 200-500ms。在追问场景下这个投入产出比是可接受的——不改写的话，检索基本等于乱来。

## 二、查询变体：扩展同义表达

### 问题

用户的用词和文档的用词天然不一致：

| 用户说 | 文档写 |
| --- | --- |
| 怎么重置密码 | 密码找回流程 |
| Webhook 怎么配 | 回调地址配置 |
| 合同要审批吗 | 协议审核要求 |

纯向量检索能处理一部分语义等价，但对**专业术语、缩写、业务黑话**效果有限。

### 解法

为同一个检索意图生成多个同义表达，全部拿去检索，最后合并去重。

```text
"Webhook 怎么配置？"
    ├── "Webhook 怎么配置？"        （原问题）
    ├── "回调怎么配置？"             （规则变体：Webhook → 回调）
    └── "回调地址配置方法是什么？"    （LLM 变体）
```

### 两层策略：规则优先，LLM 兜底

这是一个很值得学习的成本设计：

**第一层：确定性规则（零延迟、零成本）**

```python
def _heuristic_variants(query: str, max_extra: int) -> list[str]:
    """用配置中的确定性规则为高频业务术语生成同义变体。"""
    # 纯字符串替换，零成本。
    # 规则覆盖：Webhook→回调、合同→协议、审批→审核 等高频一对一同义替换
```

规则由配置文件驱动（而不是硬编码在 Python 里），新增业务术语**不需要改代码**——非开发人员也能维护。

**第二层：LLM 扩展（200-500ms）**

规则没覆盖到的新词、罕见表达，才回退到 LLM。

```python
def generate_query_variants(query, *, enabled, allow_short_structured=False) -> list[str]:
    """为同一检索意图生成少量同义表达，第一条始终是原问题。"""
    if not enabled:
        return [query]

    # 第一层：规则变体（零成本）
    variants = _heuristic_variants(query, max_extra=2)
    if len(variants) >= TARGET_COUNT:
        return variants          # 规则够用就不调 LLM

    # 第二层：规则未覆盖，回退 LLM 扩展
    llm_variants = _llm_expand(query)
    return variants + llm_variants
```

这个分层把高频场景的成本压到零，只让长尾场景付 LLM 的钱。

### 变体不是越多越好

变体会稀释精度。每个变体都会召回一批结果，如果变体本身跑偏了，就会引入噪声。

所以要有克制：

- 变体总数控制在 2-4 个
- **普通短问题不生成变体**（`allow_short_structured=False`）——短问题本身信息量就少，扩展容易跑偏
- **追问放宽限制**——因为追问已经过改写补全了，此时同义替换能弥补改写带来的用词偏移

```python
query_variants = generate_query_variants(
    rewritten_query,
    enabled=plan.use_query_variants,
    allow_short_structured=intent.intent == "FOLLOW_UP",   # 只对追问放开
)
```

### 合并去重

多变体检索后必须合并——同一个文档被多个变体召回，只保留最高分：

```python
candidate_limit = max(settings.rerank_top_n * len(query_variants), settings.rerank_top_n)
```

候选池上限要随变体数量放大，否则去重之后池子太小，reranker 没得选。

## 三、HyDE：用假设答案反向检索

### 问题

短查询（"报销标准"）向量化后语义模糊；而文档块通常是完整的陈述句。两者的向量分布不匹配——**用短问题去检索长答案，天然吃亏**。

### 解法

HyDE（Hypothetical Document Embeddings）的思路很反直觉：**先让 LLM 编一个答案，再拿这个假设答案去检索**。

```text
用户问题："报销标准是什么？"
    │
    ├─ LLM 生成假设答案："员工报销标准如下：市内交通费凭票据实报实销，
    │                    住宿费按城市级别分为每晚上限 400/600/800 元..."
    │
    ├─ 假设答案向量化
    │
    └─ 用这个向量去检索真实文档
```

为什么有效？因为**假设答案和真实文档都是"陈述句"，向量空间分布接近**。虽然假设答案的内容可能是编的，但它的"形状"和真实文档很像，能检索到表述相近的段落。

```python
def hyde_search(query: str, vector_db, llm, embedding_model):
    """HyDE：用假设答案的向量检索真实文档。"""
    hypothetical = llm.invoke(
        f"请针对以下问题写一段 3-5 句的假设性回答，直接给出内容，不要说'根据文档'：\n{query}"
    )
    combined = f"{query} {hypothetical}"        # Query2Doc 变体：拼接而非替换
    embed = embedding_model.encode(combined)
    return vector_db.search(embed, k=20)
```

### Query2Doc：更稳的变体

纯 HyDE 有个风险：假设答案里如果编错了实体（比如编了个不存在的文件名），检索会被带偏。

**Query2Doc** 的做法是**把原问题和假设答案拼接**后再向量化，而不是只用假设答案：

```python
combined = query + " " + hypothetical
```

这样原问题的语义仍然占有一席之地，实测比纯 HyDE 更稳定。

### 什么时候用

HyDE 的代价是**一次额外 LLM 调用 + 更长的编码文本**，延迟明显增加。它适合：

- 查询极短且模糊的场景
- 零 Recall（完全检索不到）的 bad case
- 已经试过混合检索和变体仍然不够

**不建议默认开启**。行业共识是：先做混合检索和 rerank，只有当 plain hybrid 不够时才考虑 HyDE 这类"额外延迟和成本"的手段。

## 四、三者怎么配合

| 手段 | 解决什么 | 成本 | 默认开启？ |
| --- | --- | --- | --- |
| 追问改写 | 多轮对话的指代缺失 | 1 次 LLM，200-500ms | 是（仅追问） |
| 查询变体 | 用词与文档不一致 | 规则层 0，LLM 层可选 | 是（有克制条件） |
| HyDE | 短查询语义模糊 | 1 次 LLM + 长文本编码 | 否（按需） |

推荐的启用顺序：

1. **先上追问改写**——这个没得选，多轮对话不做改写检索基本失效
2. **再上查询变体**——规则层零成本，收益明显
3. **混合检索 + rerank**——见前面两篇
4. **最后才考虑 HyDE**——它是解决长尾 bad case 的手段，不是标配

## 五、一个反模式：无差别改写

最常见的错误是**把所有查询都过一遍 LLM 改写**。

后果：

- 每次提问多 200-500ms 延迟
- 改写把精确查询改模糊了（"报销需要什么材料" → "请问报销流程中需要提交哪些具体的材料和单据文件？"）
- 引入改写失败的风险，还要处理降级

正确的做法是**按需改写**：

```python
# 只在追问时改写
if intent.requires_rewrite:
    query = rewrite_query_if_needed(query, history, should_rewrite=True)
# 其他情况直接用原问题
```

同理，变体也要有克制条件。这两处的"不做"和"做"同样重要。

## 小结

用户提问不等于好的检索词。三种优化手段对应三个问题：**追问改写**解决指代缺失、**查询变体**解决用词不一致、**HyDE** 解决短查询语义模糊。

工程上最有价值的设计是**分层成本控制**：变体生成用"规则优先 + LLM 兜底"，把高频场景成本压到零；改写用门控条件只对追问生效。

两个必须记住的细节：改写**空结果要硬失败**而不是静默降级；多变体检索后**必须按文档去重**，候选池上限随变体数量放大。

检索到正确文档之后，还有一步决定答案质量——怎么把这些文档组织成 prompt。见 [RAG 上下文构建：三重约束与 Prompt 档位路由](article.html?slug=rag-context-prompt)。
