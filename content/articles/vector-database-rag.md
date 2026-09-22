---
title: 向量数据库入门：Embedding、HNSW 索引与 RAG 选型
slug: vector-database-rag
summary: 为什么关键词检索救不了 RAG？这篇讲清 Embedding 与语义检索的原理、HNSW/IVF 索引的取舍、Chroma/pgvector/Qdrant/Milvus 的选型边界，并给出可直接跑通的代码。
tags: [向量数据库, RAG, Embedding, HNSW, 大模型应用]
section: 学习笔记
topic: 数据与存储
subtopic: 向量数据库
published: true
---

做 RAG（检索增强生成）时，第一步就会撞上一个问题：用户问「员工年假怎么算」，而知识库文档里写的是「司龄满一年者可享受带薪休假」。关键词检索一个字都匹配不上，检索结果为空，大模型只能开始编。

向量数据库就是为了解决这个：**让用户用语义找到内容，而不是靠字面匹配**。它是 RAG 系统的数据心脏，检索质量直接决定大模型会不会产生幻觉。

## 为什么关键词检索不够用

传统数据库（MySQL、Elasticsearch 的基础检索）本质是**字面匹配**：把查询词分词，去倒排索引里找包含这些词的文档。

向量数据库做的是**语义匹配**：把文本通过一个 Embedding 模型转成高维向量（比如 768 维或 1536 维的浮点数数组），语义相近的文本在这个向量空间里距离也近。「员工年假」和「带薪休假」虽然字面不同，但向量距离很近，于是能被检索到。

| 维度 | 关键词检索 | 向量检索 |
|---|---|---|
| 匹配依据 | 字面是否出现 | 语义是否相近 |
| 同义词 | 无法处理 | 天然支持 |
| 精确术语/ID | 极准 | 可能漏掉 |
| 典型实现 | 倒排索引 + BM25 | HNSW / IVF |

注意最后一行：**向量检索不是万能的**。当用户搜一个精确的产品型号 `XJ-2088B` 时，向量检索可能返回一堆相似但不对的型号，而关键词检索一击命中。这就是为什么生产环境的 RAG 几乎都要做**混合检索**——两套一起上。

## Embedding：文本怎么变成向量

Embedding 模型（如 `text-embedding-3-small`、开源的 `bge-base-zh`）接收一段文本，输出一个固定长度的数值数组。

```python
from openai import OpenAI

client = OpenAI()

def embed(text: str) -> list[float]:
    """把一段文本转成 1536 维向量。"""
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return resp.data[0].embedding

vec = embed("员工年假规定")
print(len(vec), vec[:5])
# 1536 [0.0198, -0.0341, 0.0072, -0.0155, 0.0293]
```

几个工程上必须知道的细节：

**维度是固定的，且查询和文档必须用同一个模型**。用 `text-embedding-3-small` 建的库，就不能用 `bge-base-zh` 去查，两个向量空间完全对不上。

**中文场景优先选中文模型**。通用英文模型处理中文的效果会明显打折，开源可选 `bge-base-zh-v1.5`、`m3e-base`。

**长文本要切片**。Embedding 模型有输入长度上限（通常 512 或 8192 token）。一篇长文档必须切成若干 chunk，每个 chunk 单独向量化。切片策略（多大、重叠多少）直接决定检索质量，这是 RAG 调优里性价比最高的一环。

**成本可以降**。OpenAI 的 `text-embedding-3-*` 支持 `dimensions` 参数缩短向量维度（如从 1536 降到 512），存储成本和检索延迟都能降下来，精度损失很小。

## 相似度怎么算

有了向量，怎么判断两个向量「像不像」？三种常见度量：

**余弦相似度**：看两个向量的夹角，忽略长度。范围 [-1, 1]，越大越相似。文本检索的事实标准。

**欧氏距离**：看两个点的直线距离，越小越相似。

**内积（点积）**：兼顾夹角和长度。

好消息是：**如果向量做过归一化（L2 normalize），余弦相似度、内积、欧氏距离的排序结果完全等价**。多数 Embedding 服务返回的向量已经归一化，所以选哪个差别不大。OpenAI 的向量就是归一化过的，用余弦相似度即可。

## ANN 索引：为什么不能暴力搜

暴力搜索（FLAT）要拿查询向量和库里每一个向量都比一遍，100% 准确，但复杂度是 O(n)。一百万条向量，每次查询就是一百万次距离计算——太慢。

所以向量数据库都用 **ANN（近似最近邻）** 索引：牺牲一点点召回率，换取几个数量级的速度提升。主流的三种：

**HNSW（分层可导航小世界图）**——目前的事实标准。

它把向量组织成一个多层的图结构：上层是稀疏的「高速公路」，下层是密集的「街道」。查询时从顶层入口出发，先粗定位，再逐层下探到精确位置。

优点：查询延迟极低（毫秒级）、召回率高。缺点：**内存占用大**——图结构本身要常驻内存。1000 万条 768 维向量的 HNSW 索引能吃掉几十 GB 内存。

**IVF（倒排文件索引）**——先把向量空间聚类成若干簇，查询时只搜最近的几个簇。

它分两档：`IVF_FLAT` 不压缩向量，精度几乎无损但速度慢于 HNSW；`IVF_PQ` 用乘积量化压缩向量，内存能砍掉一大半，代价是召回精度下降。

优点：内存可控，适合超大规模。缺点：召回率略低，且需要先训练聚类中心。

**FLAT（暴力搜索）**——100% 召回，O(n) 复杂度。数据量小（万级以内）时反而最快，因为没有索引维护开销。

**怎么选**：90% 的场景用 HNSW 就对了。内存吃紧或数据量上亿，才考虑 IVF_PQ 或磁盘索引（DiskANN）。

## 主流方案对比

| 方案 | 定位 | 索引 | 混合检索 | 数据规模上限 | 适合场景 |
|---|---|---|---|---|---|
| **Chroma** | 嵌入式，零配置 | HNSW | 支持 | 十万~百万 | 原型验证、个人项目 |
| **pgvector** | PostgreSQL 扩展 | HNSW + IVFFlat | 需配全文检索 | 千万级 | 已有 PG、要事务和 SQL |
| **FAISS** | 算法库（非数据库） | 全支持 | 无 | 内存决定 | 需要极致性能的底层封装 |
| **Qdrant** | 开源专用向量库 | HNSW + 强过滤 | 原生支持 | 千万~亿级 | 自建生产环境，性价比高 |
| **Milvus** | 分布式向量库 | IVF/HNSW/DiskANN/GPU | 支持 | 十亿级 | 超大规模、企业级 |
| **Weaviate** | 一体化平台 | HNSW | 原生 BM25 + 向量 | 千万级 | 想少折腾、要内置模块 |

几个关键判断：

**Chroma 是大多数人的第一站**。一行代码启动，不用装 Docker，本地持久化，和 LangChain/LlamaIndex 集成最深。缺点也明显：分布式能力弱，数据量接近百万时延迟和并发都会明显吃力。它是跑通 demo 的最佳选择，不是生产环境的最佳选择。

**pgvector 是被低估的方案**。如果你已经在用 PostgreSQL，装个扩展就能做向量检索，业务表和向量在同一个库里，**事务一致性、权限、备份全部复用现有设施**。千万级以内性能完全够用，还能用标准 SQL 做「向量检索 + 标量过滤」的混合查询。缺点是 PG 毕竟是关系库，超大规模不如专用方案。

**FAISS 是库不是数据库**。它没有增删改查、持久化、权限管理，需要自己封装。绝大多数向量数据库底层都用了它的算法。除非你要做极致的性能调优，否则直接用上层数据库更省心。

**Milvus 是重武器**。分布式架构、GPU 加速、冷热分离，能扛十亿级向量。但运维复杂度也最高——单机要 Docker Compose，分布式还要 etcd 和对象存储。如果你的语料只有两百万份内部文档，Milvus 是用数据中心的装备干工作室的活。

## 怎么选型

按数据规模走是最直接的判断路径：

| 向量规模 | 推荐方案 | 说明 |
|---|---|---|
| < 1 万 | 不需要数据库，Python 列表暴力算 | 上数据库纯属折腾 |
| 1 万 ~ 10 万 | Chroma / HNSWLib | 零运维，够用 |
| 10 万 ~ 100 万 | pgvector / Qdrant | 需要考虑生产化 |
| 100 万 ~ 1000 万 | Qdrant / Milvus 单机 | 性能和运维的平衡点 |
| > 1 亿 | Milvus 分布式集群 | 专用架构才有意义 |

除了规模，还要问自己三个问题：

1. **团队有没有运维能力**？没有就选云托管（Zilliz Cloud、Pinecone），别硬上自建集群
2. **是否已有 PostgreSQL**？有就优先 pgvector，能省掉一整套系统的运维
3. **有没有合规要求**？数据不出境的话，海外的 Pinecone 直接出局，选 Milvus 或国内云厂商

一个务实的演进路径：**Chroma 跑通原型 → pgvector 支撑中小规模生产 → 真到千万级再迁 Qdrant 或 Milvus**。API 都大同小异，迁移成本可控。

## 上手一：Chroma（5 分钟跑通）

```bash
pip install chromadb
```

```python
import chromadb

# 持久化到本地目录，重启数据还在
client = chromadb.PersistentClient(path="./chroma_db")

# 创建集合（类似表），指定距离函数
collection = client.get_or_create_collection(
    name="knowledge_base",
    metadata={"hnsw:space": "cosine"},     # 余弦相似度
)

# 写入：ids / documents / metadatas 三个列表一一对应
collection.add(
    ids=["doc1", "doc2", "doc3"],
    documents=[
        "司龄满一年的员工可享受 5 天带薪年假",
        "报销需在费用发生后 30 天内提交",
        "试用期员工不参与年终奖分配",
    ],
    metadatas=[
        {"category": "hr", "source": "handbook.pdf"},
        {"category": "finance", "source": "handbook.pdf"},
        {"category": "hr", "source": "policy.docx"},
    ],
)

# 查询：Chroma 会自动把 query_texts 转成向量
results = collection.query(
    query_texts=["员工放假有什么规定"],
    n_results=2,
    where={"category": "hr"},              # 元数据过滤
)

print(results["documents"])
# [['司龄满一年的员工可享受 5 天带薪年假', '试用期员工不参与年终奖分配']]
print(results["distances"])
```

注意到了吗——查询词是「员工放假有什么规定」，文档里一个「放假」都没有，但语义匹配上了。这就是向量检索的价值。

想自己控制 Embedding 模型，可以传入向量而不是文本：

```python
collection.add(
    ids=["doc1"],
    embeddings=[my_embed_func("...")],     # 用自己的模型算向量
    documents=["原文内容"],                 # 原文仍要存，检索后要给大模型看
)
```

## 上手二：pgvector（SQL 做混合查询）

如果你已经在用 PostgreSQL，装个扩展就行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id        BIGSERIAL PRIMARY KEY,
  content   TEXT NOT NULL,
  category  VARCHAR(50),
  embedding VECTOR(1536)      -- 维度必须和模型输出一致
);

-- HNSW 索引：m 和 ef_construction 是建索引时的参数
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

查询时用 `<=>` 表示余弦距离（越小越相似）：

```sql
SELECT id, content, 1 - (embedding <=> '[0.012,-0.034,...]'::vector) AS similarity
FROM documents
WHERE category = 'hr'
ORDER BY embedding <=> '[0.012,-0.034,...]'::vector
LIMIT 5;
```

`1 - 距离` 就是相似度，方便阅读。

**pgvector 最大的优势是混合查询**：结构化过滤、全文检索、向量检索可以在一条 SQL 里完成，而且享受事务保证。比如「在 hr 分类下，找和这个问题语义最相近、且 2025 年之后更新的文档」——用 SQL 表达非常自然，用专用向量库反而要绕一圈。

Python 里配合 SQLAlchemy 或 psycopg 使用，把向量转成字符串传进去即可。

## 混合检索：向量 + 关键词一起上

前面说过，向量检索对精确术语不敏感。生产级 RAG 的标准做法是**混合检索**：

1. 向量检索召回语义相近的 top-N
2. BM25 关键词检索召回字面匹配的 top-N
3. 用 RRF（Reciprocal Rank Fusion，倒数排名融合）把两路结果合并排序

```python
def reciprocal_rank_fusion(rankings: list[list[str]], k: int = 60) -> list[str]:
    """RRF 融合多路召回结果。rankings 里每路是一个按相关性排序的 id 列表。"""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda x: scores[x], reverse=True)
```

RRF 的好处是不需要归一化两路的分数（BM25 分数和余弦相似度完全不在一个量纲上），只看排名，简单且鲁棒。

融合之后，通常再加一步 **Rerank**（用 cross-encoder 模型对候选结果重新精排）。这是提升 RAG 精度最有效的一招——召回阶段求快，精排阶段求准。

## 元数据过滤：别让权限成为漏网之鱼

企业级 RAG 里，检索必须带过滤条件：「只在这个用户有权限的文档里检索」。

**要注意 pre-filter 和 post-filter 的区别**。糟糕的实现是 post-filter——先向量检索出 top-100，再过滤掉没权限的，结果可能只剩 3 条，召回率暴跌。好的实现是 pre-filter，在遍历索引图的过程中就跳过不合规的节点。

Qdrant 的过滤能力是业界标杆，pgvector 靠 SQL 天然支持，Chroma 也能做但大规模下性能会退化。这是选型时要重点评估的点。

## 常见坑

**索引参数没调，召回率上不去**。HNSW 有两个关键参数：建索引时的 `ef_construction` 和查询时的 `ef_search`。后者直接决定「搜索时考察多少个候选节点」——值越大召回率越高、速度越慢。默认值通常偏保守，实际业务要压测调整。

**数据量大到内存装不下**。HNSW 索引必须常驻内存才能发挥性能。1000 万条 768 维向量，光原始向量就是 1000万 × 768 × 4 字节 ≈ 30 GB，加上图结构轻松翻倍。内存不够就别硬撑，换 IVF_PQ 或 DiskANN。

**批量写入比逐条快得多**。和关系数据库一样，一条条 `add` 会慢到怀疑人生，务必批量提交。

**维度不匹配**。换了 Embedding 模型，所有历史向量全部作废，必须重建索引。所以模型选型要在项目早期就定下来，后期更换代价极高。

**忘了存原文**。只存向量不存原文，检索到 id 之后还得回数据库捞内容，多一次查询。多数向量库支持把原文作为 payload 一起存，直接用。

## 小结

1. **向量检索解决的是语义匹配**，关键词匹配不上但语义相关的场景全靠它
2. **HNSW 是默认选择**——查询快、召回高，代价是内存占用大；数据上亿再考虑 IVF_PQ
3. **选型先看数据规模**：万级 Chroma，百万级 pgvector/Qdrant，亿级才上 Milvus
4. **已有 PostgreSQL 就优先 pgvector**，能省掉一整套系统的运维
5. **生产级 RAG 一定要做混合检索 + Rerank**，纯向量检索对精确术语会漏召回
6. **元数据过滤要确认是 pre-filter**，post-filter 会严重损害召回率

回到本文开头：RAG 的质量天花板，往往不在大模型本身，而在检索能不能把正确的文档找出来。向量数据库用得对不对，决定了这个天花板有多高。
