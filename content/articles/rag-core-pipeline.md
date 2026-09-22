---
title: RAG 核心链路：从一次提问到带引用的答案
slug: rag-core-pipeline
summary: 大多数 RAG 教程停在「检索 + 拼提示词」，但那套东西上不了生产。这篇拆解一条真正跑得起来的八阶段链路：查询路由、意图识别、追问改写、FAQ 与文档双层检索、上下文构建、Prompt 档位路由、流式生成、引用补强，每个阶段讲清「为什么必须这么做」。
tags: [RAG, 大模型, 检索增强, 系统架构]
section: 学习笔记
topic: LLM 应用
subtopic: RAG
published: 2026-09-07
---

很多 RAG 教程讲的链路是这样的：切分文档 → 向量化 → 存向量库 → 用户提问 → 检索 top-k → 拼进提示词 → 让模型回答。

这套流程跑 demo 没问题，上生产会暴露一堆问题：用户问"你好"也要走一遍向量检索和 LLM 生成；标准问题（"报销流程是什么"）每次都要花两秒和几十倍成本让模型重新组织语言；检索出的文档其实都不相关，模型还是硬着头皮编了个答案。

**真正的生产链路，大部分代码不是在做"检索"，而是在做"什么时候不检索"和"检索结果能不能用"。**

下面这条链路来自一个实际跑通的企业级 RAG 项目，八个阶段。我会逐段讲清每步做什么、以及**为什么必须这么做**。

### 先划清边界：本文只讲在线链路

一个完整的 RAG 系统其实是两条链路：

| | 离线链路（建库） | 在线链路（服务） |
| --- | --- | --- |
| 触发时机 | 文档入库时 | 用户提问时 |
| 做的事 | 解析 → 切分 → 向量化 → 写库 | 路由 → 检索 → 构建 → 生成 |
| 延迟要求 | 分钟级，可以慢慢跑 | **秒级，用户等在屏幕前** |
| 失败代价 | 重跑一遍即可 | 用户直接看到错误 |

本文聚焦**在线链路**——也就是从"用户按下回车"到"答案带着引用流回来"这一条。离线部分（怎么切分、怎么治理）分别见 [RAG 分块策略](article.html?slug=rag-chunking-strategies) 和 [RAG 知识库治理](article.html?slug=rag-knowledge-governance)。

之所以要分开看，是因为两者的优化方向完全不同：离线链路追求**入库质量和吞吐**，在线链路追求**延迟、准确率和成本**。拿离线思路做在线（比如每次提问都重新算embedding），或者反过来，都会出问题。

## 一、全景：八个阶段

```text
用户提问
  │
  ├─ Stage 0  上下文创建      解析场景、数据域、会话、知识库版本
  ├─ Stage 1  查询路由        低成本拦截：直答 / 边界 / FAQ 精确命中
  ├─ Stage 2  检索准备        历史、意图、source、改写、检索计划、查询变体、Prompt 档位
  ├─ Stage 3  FAQ 检索        标准问答检索，命中则直出（不调 LLM）
  ├─ Stage 4  文档检索        混合检索 + 重排
  ├─ Stage 5  上下文构建      筛选、去重、截断、来源排序
  ├─ Stage 6  流式生成        LLM 逐 token 输出
  └─ Stage 7  引用与收口      引用补强、写历史、写 trace
```

关键设计：**链路中有四个"提前退出"的出口**。不是每个问题都要走到 LLM——这既是成本考虑，更是准确性考虑。

### 先亮一组真实配置

后面会反复提到这些参数，先给出来有个整体印象（来自一个实际在跑的系统）：

| 参数 | 取值 | 含义 |
| --- | --- | --- |
| `doc_top_k` | 20 | 文档混合检索召回条数 |
| `faq_top_k` | 20 | FAQ 检索召回条数 |
| `rerank_top_n` | 5 | 重排后保留条数 |
| `faq_direct_score_threshold` | 0.72 | FAQ 直出的分数阈值 |
| `rag_min_score_threshold` | 0.2 | 进入上下文的最低分数 |
| `doc_complex_query_top_k` | 24 | 复杂查询的文档召回数 |

注意 `doc_top_k = 20` 而 `rerank_top_n = 5`——**召回 20 条、最终只用 5 条**。这个 4:1 的比例不是随便定的，后面会解释。

## 二、Stage 0：上下文创建

在检索之前，先要把"这次请求属于哪个世界"确定下来：

- **场景（scenario）**：这个问题属于哪个业务域？企业内部知识库、SaaS 客服、设备运维……
- **数据域（data scope）**：tenant（租户）、dataset（数据集）、visibility（可见级别）、allowed_roles（允许的角色）
- **会话**：session_id，用于加载历史
- **知识库版本**：这次检索用哪个版本的知识库（active 版本）

这一步看着像配置解析，但它决定后面所有环节的**过滤条件**。数据隔离必须在检索层做，而不是等模型拿到文档后再筛——**模型拿不到的数据才是安全的**。

## 三、Stage 1：查询路由——先做低成本拦截

这是整条链路里性价比最高的一段。它的职责是：**用规则和精确匹配，把不需要走完整链路的问题提前挡掉**。

```python
def decide_route(context) -> RouteDecision:
    """Stage 1：低成本查询路由。返回 direct_answer / faq_exact / retrieval。"""
    # 1. 校验 source 过滤项是否合法
    validate_source_filter(context.source_filter, context.scenario.valid_sources)

    # 2. 确定性直答：问候、越界、过短
    direct_intent = classify_direct_intent(context.query, context.scenario)
    if direct_intent:
        return RouteDecision(route="direct_answer", answer=direct_intent.direct_answer, ...)

    # 3. 场景边界：问题明显属于别的场景，阻断并提示切换
    boundary_answer = detect_and_apply_boundary_answer(context)
    if boundary_answer:
        return RouteDecision(route="direct_answer", answer=boundary_answer, ...)

    # 4. FAQ 精确命中探测：短标准问句先看能否直出
    if should_try_faq_fast_path(context.query, context.scenario):
        answer, intent = try_fast_faq_direct_answer(context)
        if answer:
            return RouteDecision(route="faq_exact", answer=answer, ...)

    # 5. 都不命中，进入完整检索
    return RouteDecision(route="retrieval", reason="no_deterministic_route")
```

四类拦截各有各的必要性：

### 问候与无效输入

用户问"你好""谢谢"，走向量检索纯属浪费——检索出来的文档一定不相关，模型还得硬编一句回应。规则直接命中，零成本返回。

### 场景边界拦截

一个企业内部知识库应用，用户问"怎么用 Python 连 MySQL"。这个问题本身合理，但不属于这个知识库的覆盖范围。

如果不拦截，会发生什么？检索会返回一堆**低分但非零**的文档（比如某篇文档里提到了"数据库"），模型拿到这些似是而非的上下文，生成一个看起来像样但错误的答案。这比直接说"这个问题不在我的知识范围内"糟糕得多。

**边界拦截的本质是防止低分上下文污染答案。** 宁可拒答，不要错答。

### source 边界

用户手选了"财务制度"分类，但问的是 HR 的问题。如果不校验，系统会拿着错误的 source 过滤去检索，同样只能拿回低分文档。

正确做法是：判断问题明显属于其他分类时，阻断并提示用户切换。

### FAQ 精确命中

标准问题（比如"报销需要什么材料"）在 FAQ 库里有标准答案。与其让 LLM 基于检索结果重新组织一遍（有编造风险，还慢），不如**直接返回标准答案**。

这里有个精妙的设计：FAQ 直出分两种触发时机——

- **Stage 1 的快速路径**：短标准问句先做一次精确匹配探测，命中就直接返回，连意图识别都不用做
- **Stage 3 的分数直出**：完整检索后，如果 FAQ 检索分数超过阈值，同样直出

两道关口，覆盖了"明显是标准问题"和"检索后才发现是标准问题"两种情况。

## 四、Stage 2：检索准备——把"查什么"定义清楚

这一步不做检索，只生成**检索参数包**。但它决定了检索质量的上限。

```python
def prepare_retrieval(context) -> RetrievalPreparation:
    # 1. 加载历史：摘要 + 最近消息
    history_messages = context.history.get_context_messages(context.session_id)

    # 2. 意图识别：规则优先 + 模型兜底
    intent = classify_intent(context.query, history_messages, context.scenario)

    # 3. 确定 source 过滤：前端选择 > 意图推断 > 不过滤
    effective_source_filter = resolve_effective_source_filter(
        context.source_filter, intent.suggested_source, context.scenario
    )

    # 4. 追问改写（仅追问类型启用）
    context.rewritten_query = rewrite_query_if_needed(
        context.query, history_messages, intent.requires_rewrite
    )

    # 5. 构建检索计划：top_k、阈值、是否重排
    plan = build_retrieval_plan(context.rewritten_query, intent)

    # 6. 生成查询变体
    query_variants = generate_query_variants(
        context.rewritten_query,
        enabled=plan.use_query_variants,
        allow_short_structured=intent.intent == "FOLLOW_UP",
    )

    # 7. 选择 Prompt 档位
    prompt_profile = build_answer_prompt_profile(intent.intent, context.scenario, context.rewritten_query)
    ...
```

### 意图识别：规则优先，模型兜底

意图分两大类：

**直答类**（不走检索）：GREETING（问候）、OUT_OF_SCOPE（越界）、过短输入。

**检索类**（走检索）：

- `FAQ_QUERY`：标准问答，能直接复用标准答案
- `KNOWLEDGE_QUERY`：业务知识咨询，需要整合文档
- `FOLLOW_UP`：追问，依赖上下文

为什么规则优先？因为**高频简单意图用规则判断又快又准**，没必要为"你好"这种输入付一次模型调用的钱和延迟。模型只用来处理规则判断不了的模糊情况。

还有个细节：模型预测出 `FOLLOW_UP` 但**没有历史消息**时，要降级成 `KNOWLEDGE_QUERY`——第一轮对话不可能是追问。这类"合理性校验"能挡掉不少模型的误判。

### 追问改写：只在需要时做

多轮对话里最经典的坑：

```
用户：报销流程是什么？
助手：需要先提交申请，然后...
用户：那审批呢？        ← 这个 query 单独拿去检索，检索不到任何东西
```

"那审批呢"单独看没有任何有效信息，向量化之后在向量空间里就是一片噪声。

解决方法是**追问改写**：结合历史把指代补全成独立问题——"报销流程中的审批步骤是什么"。

但改写**不是所有情况都要做**，代码里的判断是 `intent.requires_rewrite`：

- `FAQ_QUERY` / `KNOWLEDGE_QUERY`：问题本身已经完整，改写反而引入噪声
- `FOLLOW_UP`：必须改写，否则检索不到东西

这个判断很重要。无差别改写会把"报销需要什么材料"改成"报销流程需要提交哪些具体材料和单据？"——语义被稀释，检索效果反而下降。

### 检索计划：按意图动态调整参数

不同意图需要不同的检索参数：

```python
# FAQ_QUERY：文档少召回一些，FAQ 直出阈值调低（更容易直出）
PlanPatch(
    doc_top_k=max(rules.strong_faq_doc_top_k_min, settings.doc_top_k // 2),
    direct_threshold=max(rules.faq_direct_threshold_floor,
                        settings.faq_direct_score_threshold - rules.faq_direct_discount),
)

# KNOWLEDGE_QUERY：需要更多文档证据支撑
PlanPatch(
    doc_top_k_min=max(settings.doc_top_k, settings.doc_complex_query_top_k),
)
```

逻辑很直观：FAQ 类问题答案集中，少召回、容易直出；知识咨询需要综合多份文档，多召回。

用固定的 `top_k=5` 处理所有问题，是很多 RAG 系统效果不好的原因之一。

### 查询变体：提升召回覆盖

同一个意思有多种说法。用户的问法和文档里的表述常常不一致——用户问"怎么重置密码"，文档写的是"密码找回流程"。

查询变体的做法是：生成 N 个同义表达，全部拿去检索，最后合并结果。

```python
query_variants = generate_query_variants(
    rewritten_query,
    enabled=plan.use_query_variants,
    allow_short_structured=intent.intent == "FOLLOW_UP",
)
```

同样有开关：`allow_short_structured` 只对追问放开。因为追问已经过改写补全了，此时同义替换能弥补改写带来的用词偏移；普通短问题生成变体，容易跑偏。

### Prompt 档位路由

不同意图、不同风险类别，用不同的回答模板：

| 维度 | 档位 | 特点 |
| --- | --- | --- |
| 意图 | `faq_answer` | 短、准、直接复用标准答案 |
| 意图 | `knowledge_answer` | 允许按流程、规则、步骤结构化回答 |
| 意图 | `follow_up` | 结合历史理解指代，但焦点限定在当前问题 |
| 风险 | `pricing` | 费用类必须区分已确认/未确认信息 |
| 风险 | `compliance` | 合规类保守回答，明确标注依据 |
| 风险 | `troubleshooting` | 排障类按步骤引导 |
| 兜底 | `default` | 未知意图回退到通用安全模板 |

选择优先级是：**风险类别专用 > 意图专属 > 默认**。

这条规则很关键：即使意图识别为普通知识咨询，只要问题被判定为"合规类"，就必须走合规模板。业务口径的优先级高于交互形式。

档位对象是**不可变**的（frozen dataclass）——模板变更必须走代码审查，不允许运行时篡改。这是口径安全的保障。

## 五、Stage 3-4：双层检索

### FAQ 检索（Stage 3）

先查 FAQ 集合。查完判断是否满足直出条件：

```python
faq_result = search_faq(context, prepared)
direct_answer = get_faq_direct_answer(context, prepared, faq_result)

if direct_answer:
    context.hit_type = "faq_direct"
    ...
    yield from _finish_with_single_answer(context, history, query, direct_answer)
    return None  # 不进 LLM
```

**FAQ 直出的三重价值**：

1. **准确性**：标准答案经过人工确认，模型重新组织就有编造风险
2. **成本**：省一次 LLM 调用
3. **速度**：从 2 秒降到 200 毫秒

企业场景里 FAQ 直出能拦截掉相当比例的问题，这是实打实的成本优化。

### 文档检索（Stage 4）

FAQ 没命中，才查文档集合。这里用的是**混合检索**（dense 向量 + BM25 稀疏），具体原理单独一篇讲，这里只说它在链路中的位置：

```python
doc_result = search_doc(context, prepared)
```

检索时同时传入查询变体和过滤条件（场景、数据域、source、知识库版本）。

### 为什么召回 20 条却只用 5 条

回到开头那个 `doc_top_k=20` / `rerank_top_n=5` 的比例。它来自两种风险的平衡：

**召回太少的风险**：正确答案根本不在候选里。这是**不可逆**的——一旦漏召回，后面 rerank 再强、提示词再好都找不回来。

**召回太多的风险**：reranker 的计算量线性增长，延迟上升；而且更多低分候选意味着更多噪声可能混入上下文。这是**可缓解**的——多花的只是时间和算力。

两种风险不对称，所以宁可多召回一些。**召回阶段追求覆盖率，排序阶段才追求准确率。**

那为什么不召回 100 条？因为 rerank 的延迟会线性涨，而质量收益递减得很厉害。20-50 是实践中收益与成本的平衡点。

## 六、Stage 5：上下文构建——最容易被低估的一环

检索返回的是候选，不是上下文。这一步要把候选整理成真正能喂给模型的东西。

```python
def select_context_docs(faq_hits, doc_hits, plan) -> list[Document]:
    """按三重约束筛选上下文：去重、截断、计数。"""
```

三个约束缺一不可：

**分数阈值过滤**：低于 `min_context_score` 的候选直接丢弃。宁可上下文少，不要塞噪声。

**条数上限**：`final_context_top_n` 限制条数。上下文不是越多越好——塞太多无关内容会稀释注意力（lost in the middle）。

**字符数上限**：`max_context_chars` 限制总字符数，`max_context_doc_chars` 限制单条字符数，超长截断。防止单篇长文档挤占整个 prompt 空间。

还有两个细节：

- **按文档去重**：同一个父块下的多个子块命中，只保留分数最高的
- **来源排序**：`prefer_table=True` 时文档优先，否则 FAQ 优先

### 上下文为空必须拒答

这一步最重要：

```python
if context.hit_type == "insufficient_context":
    answer = build_insufficient_context_answer(context)
    yield from _finish_with_single_answer(context, history, query, answer, ...)
    return None
```

**所有候选都低于阈值时，直接返回"信息不足"，绝不调用 LLM。**

这是防幻觉最硬的一道防线。如果这时候还让模型生成，它一定会基于自己的参数化知识编一个答案——而你完全无法判断这个答案里哪些来自知识库、哪些来自模型记忆。

用户对 RAG 应用的信任建立在"答案有据可查"上。一次编造，信任就没了。

## 七、Stage 6：流式生成

```python
with context.stage("llm_generation"):
    for chunk in stream_llm_answer(answer_prepared.system_prompt, answer_prepared.user_prompt):
        token = str(getattr(chunk, "content", "") or "")
        if not token:
            continue
        context.answer_parts.append(token)
        context.mark_first_token()   # 记录首 token 耗时
        yield build_token_event(token, context.session_id)
```

几个工程要点：

**流式是必需的。** RAG 链路本身有检索耗时，如果生成还要等完整响应，用户体验会非常差。逐 token 推送能让用户几百毫秒内看到第一个字。

**跳过空 chunk。** LangChain 流式输出会产生 `content` 为空的块（比如 finish_reason 块），不跳过会往前端推空字符串。

**记录首 token 耗时。** 这是最重要的性能指标之一，用于区分"检索慢"还是"生成慢"。

### 流式要传的不只是 token

这是 RAG 和纯聊天应用的关键差异。纯聊天只需要推 token，但 RAG 有很长的**前置处理**（路由、意图、检索、重排），用户如果只看到一片空白，会以为系统卡死了。

完整的事件协议要包含这几类：

| 事件 | 时机 | 前端行为 |
| --- | --- | --- |
| `start` | 请求接收 | 清空上轮、初始化 |
| `status` | 每个阶段开始 | 显示"正在检索…""正在生成…" |
| `token` | 每个生成片段 | 逐字追加 |
| `end` | 完成 | 渲染来源引用、显示耗时 |

**`status` 事件是 RAG 特有的。** 它把"黑盒等待"变成"可感知的进度"——同样是 3 秒响应，显示"正在检索业务资料…"和什么都不显示，用户的耐心完全不同。

`end` 事件里要带上来源引用、各阶段耗时、意图和检索诊断信息。这些数据前端可以用来展示"参考来源"，也是排查问题的第一手材料。

## 八、Stage 7：引用补强与收口

生成完还不算结束。最后一步做三件事：

### 引用补强

```python
answer = enforce_answer_citations(raw_answer, answer_prepared.context_docs)
```

要求模型输出引用编号，但模型经常漏写。所以这里做**程序化补强**：检查答案里的引用编号是否合法、是否覆盖了实际使用的来源，缺失时在末尾补上"参考来源"。

注意顺序：先补引用，再做生成后核验。因为**引用补强只修补展示文本，不等于事实核验**——这两件事必须分开，不能混为一谈。

### 写历史

```python
with context.stage("save_history"):
    history.add_turn(context.session_id, query, answer)
```

本轮问答写入 MySQL，供下一轮加载。

### 写 trace

记录完整的阶段耗时、检索诊断信息（路由、意图、变体、top_k、命中分数、Prompt 档位）、来源引用。**没有 trace，线上 bad case 就无法定位**——你不知道是检索没召回、还是召回了但上下文构建丢了、还是模型没按上下文说。

一条 trace 长这样（已脱敏）：

```json
{
  "session_id": "sess_9f2a...",
  "query": "差旅报销的审批流程是什么",
  "intent": "KNOWLEDGE_QUERY",
  "route": "retrieval",
  "rewritten": false,
  "variants_used": 2,
  "prompt_profile": "knowledge_answer",
  "stages_ms": {
    "context_init": 3,
    "route": 11,
    "prepare": 96,
    "faq_search": 42,
    "doc_search": 138,
    "rerank": 71,
    "context_build": 8,
    "first_token": 640,
    "generate": 2140,
    "save_history": 24
  },
  "retrieval": {
    "doc_top_k": 20,
    "rerank_top_n": 5,
    "final_context_n": 4,
    "top_score": 0.83,
    "min_score_threshold": 0.2,
    "hit_type": "doc"
  },
  "citations": ["doc_0231#chunk_3", "doc_0231#chunk_5", "doc_0455#chunk_1"]
}
```

看这条 trace 能立刻回答几个关键问题：

**慢在哪？** `first_token: 640ms`，其中检索相关加起来约 380ms，剩下是模型自身的排队和预填充。**先分清是检索慢还是生成慢，再决定优化哪头**——很多人一上来就换 embedding 模型，其实瓶颈在 LLM 侧。

**召回质量如何？** `top_score: 0.83` 远高于阈值 0.2，说明这条查询检索是有效的。如果看到 `top_score` 只有 0.25 勉强过线，那答案大概率不靠谱，即使模型说得头头是道。

**上下文有没有被浪费？** `doc_top_k: 20` 召回了 20 条，`final_context_n: 4` 最终只用 4 条。这个漏斗是设计使然（见上文 20:5 的解释）。但如果出现"召回 20 条、最终 0 条进上下文"，那就是全部低于阈值被丢了，此时应该走拒答——这个信号值得单独监控。

**引用能不能回溯？** `citations` 里的 `doc_0231#chunk_3` 能直接定位到源文档的具体块。用户质疑答案时，你能在一分钟内找出处，而不是去翻日志猜。

把 trace 存成结构化数据（而不是打日志字符串），才能按 `intent`、`hit_type`、`top_score` 这些维度聚合分析，找出系统的系统性短板。

## 九、这套链路的核心设计思想

回过头看，真正让这条链路"能上生产"的不是检索算法有多先进，而是六个设计决策：

**1. 尽可能不调用 LLM。** 四个提前退出出口：直答、边界、FAQ 精确命中、信息不足。LLM 是最后手段，不是默认路径。省成本是副产品，主要是减少编造机会。

**2. 边界拦截优先于检索。** 问题超出范围就明确拒答，而不是检索一堆低分文档喂给模型。低分上下文比没有上下文更危险——它会让模型生成"看起来有依据"的错误答案。

**3. 参数按意图动态调整。** `top_k`、阈值、是否改写、是否生成变体、用哪个 Prompt 模板，都跟着意图走。固定参数处理所有问题，是效果差的主因。

**4. 上下文构建比检索更重要。** 检索到的候选要经过阈值、条数、字符数三重约束。宁缺毋滥——上下文质量直接决定答案质量。

**5. 全链路可观测。** 每个阶段计时、检索诊断全量记录。RAG 系统的问题定位，八成靠 trace。

**6. 任何旁支都能降级。** 向量库挂了降 BM25，Rerank 超时就跳过，意图识别失败用默认值继续。只有检索和生成是主干，其余环节的失败都不该变成用户看到的错误页。

## 十、出错了怎么办：异常与降级

前面讲的都是正常路径。但生产系统真正考验人的，是**某个环节挂掉的时候还能不能给用户一个交代**。

在线链路的每一环都可能失败，处理方式不该一刀切：

| 环节 | 典型故障 | 该怎么做 | 不该怎么做 |
| --- | --- | --- | --- |
| 向量库 | 超时 / 连接失败 | 降级为纯 BM25 检索，答案可用 | 直接 500 |
| Rerank 服务 | 超时 | 跳过重排，用召回原始序 | 整个请求失败 |
| 意图识别（模型） | 超时 / 返回非法值 | 回退默认意图继续检索 | 卡住等待 |
| 追问改写（模型） | 失败 | 用原始 query 继续 | 中断链路 |
| LLM 生成 | 中途断流 / 超时 | 返回已生成部分 + 提示 | 静默吞掉 |
| 写历史 / 写 trace | 失败 | 记错误日志，不影响答案 | 让主流程失败 |

原则只有一条：**检索和生成是主干，其余都是可降级的旁支。**

注意表格里两个"辅助模型调用"（意图识别、追问改写）的处理——它们失败时**不应该中断链路**，因为它们的输出只是优化项，不是必需品。原始 query 拿去检索，效果可能差一点，但至少能出答案。

这个设计有个前提：辅助调用必须设**独立的短超时**（比如意图识别给 800ms，改写给 1.5s），不能用和主 LLM 一样的长超时。否则一个卡死的辅助调用会拖垮整个请求。

还有个容易忽略的点：**降级也要写进 trace**。否则你会看到系统"效果莫名变差"，却不知道那批请求其实走了降级路径。在 trace 里加一个 `degraded: ["rerank_timeout"]` 字段，事后分析才有的放矢。

## 十一、如果要从零搭一条，先做什么

八个阶段不可能一次做完。按投入产出比排，我建议这个顺序：

**第一批（不做就会出事故）**

1. **拒答机制**——上下文不足时明确说"信息不足"，绝不硬生成。这是防幻觉的底线，也是用户对系统建立信任的前提
2. **数据隔离过滤**——检索层硬过滤，不能靠提示词软约束
3. **全链路 trace**——没有它，后面所有优化都是盲调

**第二批（决定效果）**

4. **混合检索**——加 BM25 是投入产出比最高的一次升级，不需要训练任何模型
5. **合理的分块**——父子块 + 中文分隔符，这是检索质量的地基
6. **Rerank**——在召回之上再提一档准确率

**第三批（决定体验与成本）**

7. **查询路由**——直答、边界拦截、FAQ 直出，降低延迟和成本
8. **意图识别 + 动态参数**——让不同问题走不同的检索配置和 Prompt 模板
9. **追问改写**——多轮对话必备
10. **查询变体**——规则层零成本，收益明显

这个排序的原则是：**先保证不犯错，再追求效果好，最后优化成本和体验**。很多团队倒过来做——一上来就调 embedding 模型、上复杂的 Agent 框架，结果基础的拒答和隔离没做，出了一个事故整个项目被叫停。

## 小结

一条能上生产的 RAG 链路，和教程里的 demo 最大的区别在于：**大部分逻辑在处理"异常情况"和"提前退出"**，而不是在优化检索本身。

八个阶段里，真正做检索的只有 Stage 3-4 两个阶段。其余六个阶段在做上下文解析、路由拦截、参数准备、上下文筛选、生成控制和收口——这些"周边"工作，恰恰决定了系统是"能跑"还是"能用"。

如果说有一个最重要的建议，那就是：**给模型留一条"我不知道"的退路**。上下文不足时明确拒答、问题越界时明确拦截，比让它硬着头皮生成要可靠得多。

还有一条同样重要：**检索器决定天花板，后面的优化只能在天花板内做事**。所以排查效果问题时，永远先问"正确的文档有没有被召回来"，再问"召回来之后排得对不对、用得好不好"。

最后回到开头那个区分——在线链路和离线链路是两种完全不同的工程。离线可以慢慢打磨切分和入库质量，在线必须在秒级内完成路由、检索、构建、生成，还要在任一环节出问题时体面降级。**把这两条链路分开设计、分开优化、分开监控**，是 RAG 系统从 demo 走到生产的第一步。

这条链路上的每一段都值得单独展开：文档怎么切分见 [RAG 分块策略：从固定切分到父子块](article.html?slug=rag-chunking-strategies)，混合检索的原理见 [RAG 混合检索：向量与关键词为什么要一起用](article.html?slug=rag-hybrid-search)，检索结果怎么变成 prompt 见 [RAG 上下文构建：三重约束与 Prompt 档位路由](article.html?slug=rag-context-prompt)，效果怎么量化见 [RAG 评测：从 Recall@K 到 Bad Case 闭环](article.html?slug=rag-evaluation)。
