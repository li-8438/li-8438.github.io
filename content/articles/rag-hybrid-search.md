---
title: RAG 混合检索：向量与关键词为什么要一起用
slug: rag-hybrid-search
summary: 纯向量检索有个致命盲区——遇到型号、错误码、人名这类「必须精确匹配」的词就失效。这篇讲清 BM25 与稠密检索各自的失效边界、RRF 融合为什么优于加权平均，以及 Milvus 内置 BM25 的落地配置。
tags: [RAG, 混合检索, BM25, RRF, 向量数据库]
section: 学习笔记
topic: LLM 应用
subtopic: RAG
published: 2026-09-07
---

RAG 系统最常听到的抱怨是："文档明明在知识库里，就是检索不出来。"

十次里有七八次，问题出在**只用了向量检索**。

## 一、纯向量检索的失效场景

向量检索（dense retrieval）把文本映射成高维向量，用余弦相似度找语义相近的内容。它擅长**语义匹配**：

> 用户问："怎么退回一个坏掉的东西？"
> 文档标题："缺陷产品退款政策"
>
> 向量检索：✅ 一个词都不重叠，但语义完全对上，能找到。

但它在另一类场景下会彻底失效：

> 用户问："错误码 E_AUTH_4031 是什么意思？"
> 文档里确实有且仅有一段讲这个错误码
>
> 向量检索：❌ 返回了一堆讲"认证失败"的通用文档，那段精确讲 E_AUTH_4031 的反而排在后面。

**为什么？** Embedding 模型编码的是"语义"，不是"字符串"。像 `E_AUTH_4031`、`SKU AZ-4471`、`TLS1.3` 这类稀有标识符，模型在训练时可能从没见过这个 token，它的向量会落在语义空间里一个很笼统的位置。结果就是：**精确匹配的文档被语义相近但错误的文档挤掉了**。

反过来，BM25 这类关键词检索也有对称的盲区：它只匹配字面，遇到同义改写（"汽车维修" vs "轿车保养"）就检索不到。

两类方法的失效模式是**互补的**——这正是混合检索成立的根据。

## 二、BM25：关键词检索的经典算法

BM25（Best Matching 25）是基于倒排索引的概率检索算法，从 1990 年代起就是搜索引擎的基础。

它有两个核心机制：

**词频饱和**：一个词在文档中出现 10 次，不是出现 1 次的 10 倍相关。分数会饱和，防止关键词堆砌霸榜。

**长度归一化**：长文档天然包含更多词，要惩罚。一篇 5000 字的文档提到"退款"两次，不该排在提到两次"退款"的 200 字文档前面。

两个可调参数：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `k1` | 1.2 | 词频饱和度。调高（接近 2.0）更看重重复词；调低（0.5-0.8）适合短结构化文档 |
| `b` | 0.75 | 长度归一化强度。1.0 完全惩罚长文档，0 不惩罚 |

### BM25 的适用边界

**擅长**：精确匹配查询（产品型号、错误码、版本号、人名、法规条款号）、训练时没见过的生僻词、高吞吐场景（纯 CPU 倒排索引，不需要神经网络推理）。

**不擅长**：同义词和改写（"汽车维修"匹配不到"轿车保养"）、概念性查询、跨语言匹配。

## 三、融合：为什么是 RRF 而不是加权平均

两路检索各自返回一个排序列表，怎么合并成最终结果？

### 加权平均的陷阱

最直觉的做法是把两路分数加权求和：

```python
score = 0.5 * bm25_score + 0.5 * cosine_score
```

**这个做法在生产环境是错的**，原因是**分数量纲不兼容**：

- BM25 分数是无界的正整数，可能几十上百
- 余弦相似度有界，在 [-1, 1] 之间

直接加权，BM25 会**默认碾压**向量检索，权重调参调了个寂寞。要做归一化，又得面对"用最大值归一化还是 min-max 归一化"这些新问题，而且分布随查询变化，归一化不稳定。

### RRF：只看排名，不看分数

Reciprocal Rank Fusion（倒数排名融合）绕开了整个问题：

```python
def rrf(rank: int, k: int = 60) -> float:
    return 1.0 / (k + rank)

def rrf_fusion(ranked_lists: list[list[str]], k: int = 60):
    """把多个排序列表融合成一个。k 是排名常数，默认 60。"""
    scores: dict[str, float] = {}
    for results in ranked_lists:
        for rank, doc_id in enumerate(results, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + rrf(rank, k)
    return sorted(scores.items(), key=lambda x: -x[1])
```

公式就一行：`1 / (k + rank)`。这个设计有三个好处：

1. **不需要归一化**：只用排名位置，分数量纲问题自动消失
2. **对高分不敏感**：第 1 名和第 2 名的贡献差距（1/61 vs 1/62）远小于 BM25 分数可能差几十倍的情况，避免单路检索霸榜
3. **无需调参**：`k=60` 是业界默认（Elasticsearch 的生产默认值），换数据集基本不用动

关于 `k` 的作用：它控制"降低排名惩罚的强度"。`k` 越大，排名靠后的文档贡献被压得越平，融合结果越接近"并集"；`k` 越小，头部排名权重越大。

### 效果数据

在 WANDS 电商数据集上的实测（NDCG 指标）：

| 方案 | NDCG |
| --- | --- |
| 纯 BM25 | 0.6983 |
| 纯向量 | 0.6953 |
| 混合（RRF） | 0.7068 |
| 混合 + 字段加权调优 | 0.7497 |

注意前两行：**纯 BM25 和纯向量的分数几乎一样**（0.6983 vs 0.6953）， statistically  indistinguishable。这说明不存在"哪个更好"，只有"各自的盲区不同"。融合后才有实质提升。

## 四、落地：Milvus 内置 BM25 混合检索

如果自己维护两套索引（向量库 + Elasticsearch），要处理数据同步、两套过滤逻辑、结果融合，运维成本高。

Milvus 2.5+ 提供了**服务端内置 BM25**：在 collection schema 里声明一个 BM25 函数，它会自动把文本字段转成稀疏向量。dense、sparse、版本过滤、数据隔离全在一个查询里完成。

```python
from pymilvus import MilvusClient, DataType, Function, FunctionType

client = MilvusClient(uri="http://localhost:19530")

schema = client.create_schema(auto_id=False, enable_dynamic_field=True)
schema.add_field("pk", DataType.VARCHAR, max_length=64, is_primary=True)
schema.add_field("text", DataType.VARCHAR, max_length=65535,
                 analyzer_params={"type": "chinese"})   # ← 中文分词器
schema.add_field("dense", DataType.FLOAT_VECTOR, dim=1024)
schema.add_field("sparse", DataType.SPARSE_FLOAT_VECTOR)  # ← 由 BM25 函数自动填充

# 声明 BM25 函数：输入 text 字段，输出 sparse 字段
bm25 = Function(
    name="bm25_fn",
    function_type=FunctionType.BM25,
    input_field_names=["text"],
    output_field_names=["sparse"],
)
schema.add_function(bm25)

index_params = client.prepare_index_params()
index_params.add_index("dense", index_type="HNSW",
                       metric_type="COSINE", params={"M": 16, "efConstruction": 200})
index_params.add_index("sparse", index_type="SPARSE_INVERTED_INDEX",
                       metric_type="BM25", params={"k1": 1.2, "b": 0.75})

client.create_collection("kb_docs", schema=schema, index_params=index_params)
```

查询时两路一起发：

```python
results = client.hybrid_search(
    collection_name="kb_docs",
    reqs=[
        {"search_param": {"metric_type": "COSINE"}, "data": [query_dense_vector]},
        {"search_param": {"metric_type": "BM25"}, "data": ["查询文本"]},
    ],
    ranker={"strategy": "rrf", "params": {"k": 60}},   # ← 服务端 RRF 融合
    limit=20,
    filter='kb_version == "v3" and tenant_id == "t01"',  # 过滤统一在这里做
)
```

### 三个必踩的坑

**中文必须配 analyzer。** text 字段不加 `analyzer_params={"type": "chinese"}`，Milvus 会按空格分词——中文整句变成一个 token，BM25 完全失效，而且**不报错**，只是检索结果差。这是最隐蔽的坑。

**复用了旧 collection 会静默失败。** 如果线上复用了没有 BM25 函数的旧 collection（只有 sparse 字段但没有函数定义），Milvus 会收到空的 sparse 请求，报一个很难定位的错。所以要做**schema 校验**：

```python
def validate_hybrid_schema(collection) -> list[str]:
    """校验 collection 是否符合 Dense + BM25 Sparse 混合索引契约。"""
    problems = []
    fields = {f.name: f for f in collection.schema.fields}

    if not _truthy(getattr(fields.get("text"), "analyzer_params", None)):
        problems.append("text 字段未启用 analyzer，BM25 无法分析中文 query")

    if "dense" not in fields:
        problems.append("缺少 dense 向量字段")
    elif fields["dense"].dtype != DataType.FLOAT_VECTOR:
        problems.append(f"dense 字段类型应为 FLOAT_VECTOR，实际为 {fields['dense'].dtype}")

    if "sparse" not in fields:
        problems.append("缺少 sparse 向量字段")
    elif fields["sparse"].dtype != DataType.SPARSE_FLOAT_VECTOR:
        problems.append(f"sparse 字段类型应为 SPARSE_FLOAT_VECTOR")
    elif not is_function_output(fields["sparse"]):
        problems.append("sparse 字段不是 BM25 函数的输出，无法生成稀疏向量")

    return problems
```

在检索准备阶段跑一次这个校验，能把"配置错了但系统还能跑"变成"启动就报错"。**宁可启动失败，不要静默降级。**

**ranker 参数名各版本不同。** 有的版本用 `{"strategy": "rrf", "params": {"k": 60}}`，有的用 `RRFRanker()` 对象。以你用的 Milvus 版本文档为准。

## 五、召回数量怎么定

两阶段的数量关系很关键：

```text
混合检索召回 20 条  →  Rerank 重排保留 5 条  →  送进 prompt
    (doc_top_k)           (rerank_top_n)
```

这个 20 → 5 的比例不是随便定的：

- **召回太少**（比如 5）：reranker 没有选择空间，而且漏召回的东西后面再怎么排也找不回来
- **召回太多**（比如 200）：reranker 耗时会线性增长，收益递减

经验值：**召回 20-100，重排后保留 3-5**。超过 100 的召回，rerank 的延迟成本基本换不来质量提升。

还有一个原则要记住：**检索器决定了天花板，reranker 只能在天花板内优化**。如果召回的 20 条里根本没有正确答案，reranker 再强也没用。所以质量问题的排查顺序永远是**先看召回，再看排序**。

## 六、什么时候可以只用向量检索

不是所有场景都要上混合检索。可以只用的情况：

- 知识库内容全是**自然语言叙述**，没有型号、代码、编号这类标识符
- 用户的提问方式**高度口语化**，几乎不会照抄文档里的专有名词
- 项目早期验证阶段，先把链路跑通

但如果有下面任何一个信号，就该上混合检索：

- 文档里有产品型号、错误码、法条编号、人名
- 用户会直接搜索这些标识符
- 线上出现过"文档在库里但检索不出来"的反馈

**加 BM25 是投入产出比最高的一次检索升级**——它不需要重新训练任何模型，只需要多维护一个索引。

## 小结

向量检索和 BM25 的失效模式互补：**向量懂语义不懂字符串，BM25 懂字符串不懂语义**。混合检索不是"两个都要"的堆砌，而是精确填补彼此的盲区。

融合要用 **RRF 而不是加权平均**——关键在于 BM25 分数无界、余弦相似度有界，量纲不兼容会让加权失去意义，而 RRF 只用排名、不碰分数，天然规避这个问题且几乎不用调参。

落地 Milvus 内置 BM25 时记住三个坑：**中文必须配 analyzer**、**复用旧 collection 要校验 schema**、**召回 20 重排 5 是合理起点**。

混合检索把候选捞出来了，但顺序还比较粗糙——BM25 和向量都是"各自独立打分"，没有看过 query 和文档的组合。下一篇讲怎么用 CrossEncoder 做精细重排，见 [RAG 重排序：为什么 Rerank 是性价比最高的一步](article.html?slug=rag-rerank)。
