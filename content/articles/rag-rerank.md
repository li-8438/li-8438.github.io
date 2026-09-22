---
title: RAG 重排序：为什么 Rerank 是性价比最高的一步
slug: rag-rerank
summary: 检索出的前几条往往不是最相关的。这篇讲清双塔检索的信息损失从哪来、CrossEncoder 为什么更准却不能全库扫描、两阶段架构的数量配比，以及候选去重与本地模型部署的实践细节。
tags: [RAG, Rerank, CrossEncoder, 重排序]
section: 学习笔记
topic: LLM 应用
subtopic: RAG
published: 2026-09-07
---

如果你只能给 RAG 系统加一个优化项，加 Rerank。

理由是投入产出比：它不需要改数据、不需要重新训练、不需要动检索架构，只要在召回之后插一层，检索质量就能有明显提升。

## 一、问题：双塔检索的信息损失

向量检索（以及 BM25）都属于**双塔结构**（bi-encoder）：

```text
Query  ──► [编码器 A] ──► 向量 q  ──┐
                                     ├──► 余弦相似度
Document ─► [编码器 B] ──► 向量 d ──┘
```

Query 和 Document **各自独立编码**，最后只算一个相似度。

问题就出在"各自独立"上：编码 query 的时候，模型完全没看过文档；编码文档的时候，也完全不知道会被什么 query 检索。**两者之间没有信息交互**。

这带来两个后果：

**1. 语义被压缩成固定维度向量，必然有损。** 一段 500 字的文档，无论内容多复杂，都被压成一个 1024 维的向量。细节丢了。

**2. 无法捕捉 query 与文档之间的细粒度匹配。** 比如 query 问"2024 年的报销标准是多少"，文档 A 讲 2024 年标准，文档 B 讲 2023 年标准。两者的整体语义非常接近，向量相似度差距可能只有 0.02——但正确答案只有一个。

## 二、CrossEncoder：把 query 和文档拼在一起看

Rerank 用的是**交叉编码器**（CrossEncoder）：

```text
[Query, Document] 一起输入 ──► [Transformer] ──► 相关性分数（0-1）
```

关键区别：**query 和文档同时进入同一个模型**，自注意力机制让每个 token 都能看到对方的所有 token。模型能捕捉到"这个数字和 query 里的年份对上了""这个词是 query 里的关键词"这类细粒度交互。

结果就是：相关性判断准得多。业界实测里，rerank 通常能把 nDCG@10 从 0.65 左右提到 0.82 上下，而 context precision 从 0.61（纯向量）→ 0.71（混合）→ 0.79（混合 + rerank）。

### 代价：不能全库扫描

CrossEncoder 的准确率来自"每次都要把 query 和文档拼起来跑一遍完整 Transformer"。这意味着：

- 它**无法预先计算文档表示**（每次组合都要重新算）
- 如果有 100 万篇文档，每个 query 要跑 100 万次前向推理——完全不可行

所以 rerank **只能作为第二阶段**：先用向量检索快速捞出少量候选，再对候选精细排序。

## 三、两阶段架构

```text
全库（百万级）
    │
    │  第一阶段：向量 + BM25 混合检索（毫秒级，召回优先）
    ▼
候选 20-100 条
    │
    │  第二阶段：CrossEncoder 精排（50-200ms，准确优先）
    ▼
精排后 3-5 条
    │
    ▼
送进 Prompt
```

这个架构的原则是：**用便宜的方法保证召回率，用昂贵的方法保证准确率**。

### 数量配比

一个实际在跑的配置：

```python
doc_top_k: int = 20        # 混合检索召回 20 条
rerank_top_n: int = 5      # 精排后保留 5 条
```

为什么是这两个数：

**召回 20 条**：足够 reranker 有选择空间。召回 5 条就太少了——漏掉的正确答案后面再也找不回来。

**精排保留 5 条**：上下文条数不是越多越好。塞 20 条进 prompt，模型注意力被稀释（lost in the middle），反而可能忽略真正关键的那条。3-5 条是实践中的甜点区。

### 延迟账

Rerank 不是免费的。轻量 reranker 处理 20 条候选大约增加 80-120ms，本地 GPU 部署的 BGE-reranker-large 处理 top-20 通常在 100-200ms 量级。

如果延迟敏感，有几个选项：

- **减少候选数**：20 → 10，延迟减半，质量下降有限
- **用更小的模型**：FlashRank 的量化 MiniLM 模型在 CPU 上能做到 55ms
- **异步/流式**：先返回第一阶段结果，rerank 完成后再更新（适合搜索类场景）

**超过 100 条候选基本不划算**——延迟线性增长，质量收益递减。

## 四、工程实现

### 基本调用

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-large")

def rerank(query: str, candidates: list[str], top_n: int = 5):
    """对候选文档做精排，返回前 top_n 条。"""
    pairs = [(query, doc) for doc in candidates]
    scores = reranker.predict(pairs)

    ranked = sorted(zip(candidates, scores), key=lambda x: -x[1])
    return ranked[:top_n]
```

### 候选合并去重：多查询变体的必要步骤

如果用了查询变体（多个同义问法分别检索），同一个文档可能被多个变体召回。这时候必须**合并去重**，否则召回列表膨胀，浪费 rerank 的候选配额。

```python
def document_key(document) -> str:
    """返回用于合并重复命中的稳定标识。"""
    metadata = document.metadata
    # chunk_id 优先，faq_id 备用，都没有则用内容前 120 字符兜底
    return str(metadata.get("chunk_id") or metadata.get("faq_id") or document.page_content[:120])


def merge_hits_by_document(merged: dict, hits: list) -> None:
    """同一文档被多个查询变体命中时，只保留最高分。"""
    for hit in hits:
        key = document_key(hit.document)
        previous = merged.get(key)
        if previous is None or hit.score > previous.score:
            merged[key] = hit
```

注意去重 key 的选取：**优先用稳定的 chunk_id**，而不是内容哈希或全文。这样即使文档内容有微小改动（比如错别字修正），也能正确识别为同一块。

### 候选池要随变体数量放大

用查询变体时，每个变体都会召回一批结果。如果简单地每个变体取 top-20 再合并，合并后的总数可能远超预期，也可能因为去重后不足。

合理的做法是**按变体数量放大候选上限**：

```python
candidate_limit = max(settings.rerank_top_n * len(query_variants), settings.rerank_top_n)
```

保证 reranker 总能从足够大的池子里选。

### 本地部署的坑

自托管 reranker 模型时，最容易踩的是**文件不完整**：

```python
def get_reranker():
    """返回已缓存的 CrossEncoder 重排模型。"""
    settings = get_settings()
    model_path = Path(settings.reranker_model_path)

    # 必须同时校验权重文件和 vocab 文件
    if not (model_path / "model.safetensors").exists():
        raise RuntimeError(f"reranker 权重缺失：{model_path}")
    if not (model_path / "sentencepiece.bpe.model").exists():
        # vocab 缺失时即使权重在也无法运行，且报错信息极不直观
        raise RuntimeError(f"reranker vocab 缺失：{model_path}")

    return CrossEncoder(str(model_path))
```

**权重文件存在但 vocab 文件缺失**是最坑的情况——模型加载会以一个和真实原因毫不相干的报错失败。启动阶段就校验，别等到线上检索时才炸。

另外用 `lru_cache` 保证模型只加载一次。reranker 模型几百 MB，每次请求重新加载是灾难。

## 五、模型怎么选

2026 年的主流选项：

| 模型 | 特点 | 适用 |
| --- | --- | --- |
| BGE-Reranker-v2-m3 | MIT 协议，多语言，中文效果好 | 自托管首选 |
| Cohere Rerank 3.5 | 100+ 语言，128k 上下文，托管 | 预算充足、要求最高质量 |
| Voyage Rerank 2.5 | MTEB 重排榜前列，价格较低 | 成本敏感的托管方案 |
| Jina Reranker v3 | 开源友好，延迟适中 | 200ms 延迟预算内 |
| FlashRank MiniLM-L-12 | 量化模型，CPU 上 ~55ms | CPU 环境、极严延迟要求 |

选型要看三件事：

**语言支持。** 中文场景必须选中文效果好的。BGE-Reranker-v2-m3 在多语言上表现均衡，是自托管的常见选择。

**上下文长度。** reranker 也有 token 上限。如果文档块较长（比如 1024 token），要确认模型能容纳 query + 文档的组合长度。

**部署方式。** 数据不能出内网的场景只能自托管；能接受 API 调用的话，托管服务省去运维但增加网络往返（Voyage 的 API 延迟可能到 500ms+）。

## 六、一个重要提醒：Rerank 不能救召回

这是最常被误解的一点。

**检索器决定天花板，reranker 只能在天花板内优化。**

如果正确答案根本不在召回的 20 条里，reranker 再强也变不出来。它只负责把"已经在池子里的"排得更准。

所以排查 RAG 质量问题的顺序永远是：

1. **先看召回**：正确答案在不在 top-20 里？
2. **不在** → 问题在分块、embedding 模型、或者需要混合检索补关键词召回
3. **在但排得靠后** → 这才是 reranker 该解决的问题

跳过第 1 步直接加 reranker，是很多团队花了钱却没效果的原因。

## 小结

Rerank 解决的是双塔检索"query 和文档没有信息交互"的根本缺陷。CrossEncoder 把两者拼在一起编码，判断准得多，但代价是无法预计算、不能全库扫描——**因此它只能是第二阶段**。

两阶段架构的要点：混合检索召回 20 条 → CrossEncoder 精排保留 3-5 条。多查询变体场景要先按文档去重合并，候选池要随变体数量放大。

选型看语言、上下文长度、部署方式三个维度。自托管记得在启动阶段校验模型文件完整性。

最后记住那条铁律：**reranker 不能救召回**。先用 Recall@K 确认正确答案在池子里，再谈排序优化。

如何提高召回率？除了混合检索，另一个方向是把问题本身改写得更"可检索"，见 [RAG 查询优化：改写、变体与 HyDE](article.html?slug=rag-query-optimization)。
