---
title: RAG 分块策略：从固定切分到父子块
slug: rag-chunking-strategies
summary: 分块不是「按字数切」那么简单，它直接决定检索质量的上限。这篇对比固定切分、递归切分、语义切分、父子块四种策略的原理与适用边界，讲清中文分隔符、稳定 chunk id、表格特殊处理这些工程细节。
tags: [RAG, 分块, chunking, 向量检索]
section: 学习笔记
topic: LLM 应用
subtopic: RAG
published: 2026-09-07
---

RAG 的效果问题，八成出在检索；而检索问题，很大一部分根源在分块。

但分块又是最容易被轻视的一环——很多人觉得"切个 500 字不就行了"。这个认知会让你的 RAG 系统天花板很低。

## 一、为什么要分块

三个硬性原因：

**Embedding 模型有输入长度上限。** 常见的中文 embedding 模型上限在 512-1024 token，超出会被截断，后面的内容直接丢失。

**整篇一个向量会稀释语义。** 一篇讲十个主题的文档，压缩成一个向量，这个向量表达的是"十个主题的平均语义"。用户问其中任何一个具体主题，都匹配不准。

**检索出来的内容要塞进 prompt。** 上下文窗口有限，把整篇 500 页手册塞进去既不现实也不经济。

分块的本质是：**把长文档拆成一张张语义完整的"知识卡片"，问什么就找相关的卡片**。

## 二、四种策略对比

### 固定大小切分

按字符数或 token 数机械均分，配一个重叠区（overlap）。

```python
from langchain_text_splitters import CharacterTextSplitter

splitter = CharacterTextSplitter(chunk_size=500, chunk_overlap=100)
chunks = splitter.split_documents(docs)
```

**优点**：实现简单，速度快，能保证块大小绝对可控。
**缺点**：切分是"盲目"的，很可能把一句话、一个函数、一个条款从中间劈开。

被切坏的块，向量化之后就是语义噪声——用户问什么都匹配不上，或者匹配上了但信息残缺。

### 递归切分（工业界默认）

按**分隔符优先级**递归切分：先按段落切，太长就按句子切，再长就按词切，最后才按字符强制切。

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
)
```

**核心优势**：尽量沿自然语义边界切，不把一句话切断。

**中文场景必须自定义分隔符。** LangChain 默认分隔符是为英文设计的（按 `. ` `! ` `? ` 切），对中文无效——中文句子以`。`结尾，没有空格。直接用默认配置，中文文档会被切得七零八落。

一个针对中英文混排优化的分隔符配置：

```python
CHINESE_SEPARATORS = [
    "\n\n",                                  # 段落
    "\n",                                    # 换行
    "。", "！", "？", "；",                  # 中文句末标点
    ";", ".", "!", "?",                      # 英文句末标点
    "，", ",",                               # 逗号（兜底）
    " ",                                     # 空格
    "",                                      # 最后按字符强制切
]
```

### 语义切分

不按长度，按**语义相似度**判断边界：相邻句子相似度高就放一起，突然下降说明换话题了，在这里切开。

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_huggingface import HuggingFaceEmbeddings

embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-zh-v1.5")
splitter = SemanticChunker(embeddings, breakpoint_threshold_type="percentile")
chunks = splitter.split_documents(docs)
```

**优点**：语义连贯性最好，每个块是一个完整主题。
**缺点**：计算开销大（要先给所有句子做 embedding）；且**切出的块长度不可控**——一整节都在讲同一主题，就会切出一个超大的块。

实践中的做法是**语义切分 + 递归切分兜底**：先按语义切，再检查长度，超长的用递归切分二次处理。

### 父子块（生产环境首选）

这是解决"检索精度"和"上下文完整性"矛盾的方案。

矛盾在哪？

- 小块（100-200 token）语义集中，检索准，但信息不完整，喂给模型可能缺前因后果
- 大块（1000-2000 token）上下文完整，但语义稀释，检索不准

**父子块的解法**：小块负责检索，大块负责回答。

```text
源文档
  └── 父块（1024 字符，提供完整上下文）
        ├── 子块 1（256 字符，向量化，用于检索）
        ├── 子块 2（256 字符，向量化，用于检索）
        └── 子块 3（256 字符，向量化，用于检索）

检索时：子块命中 → 通过 parent_id 找到父块 → 把父块内容交给 LLM
```

实现要点：

```python
def split_documents(documents):
    """parent-child 双层切分：子块用于精确召回，父块上下文存入 metadata。"""
    # 1. Markdown 先按标题结构化切分
    # 2. 再对每块做递归切分，得到父块
    # 3. 每个父块二次切分成子块
    # 4. 子块的 metadata 里存 parent_content（父块全文）
    # 5. 用内容稳定哈希生成 parent_id / chunk_id
```

| 策略 | 检索精度 | 上下文完整性 | 实现复杂度 | 适用 |
| --- | --- | --- | --- | --- |
| 固定大小 | 低 | 中 | 低 | 结构化文档、日志 |
| 递归切分 | 中 | 中高 | 低 | 通用文档（默认首选） |
| 语义切分 | 高 | 高 | 中 | 高质量问答、知识库 |
| 父子块 | 高 | 高 | 中高 | 生产环境、长文档 |

## 三、参数怎么调

### chunk_size 的经验起点

没有普适的"最佳值"，但有经验起点：

- **事实性问答**（智能客服、FAQ）：256-512 token，检索精准
- **需要总结推理的任务**：1024-2048 token，需要足够语境
- **递归切分的通用起点**：512 + overlap 50-100

**两个典型的失败模式**：

- 切得太小（<50 token）：碎片化，丢失逻辑关系，准确率可能掉到 54%
- 切得太大（>2500 token）：出现"上下文悬崖"，语义稀释，质量断崖式下跌

### overlap 要不要设

10%-20% 是行业标配。它的作用是防止边界处语义断裂。

但要注意：**父子块方案下 overlap 的价值下降**——上下文完整性由父块保证，子块之间不需要大量重叠。这也是父子块能降低存储成本的原因之一。

### 调参的正确姿势

不要凭感觉调，用测试集说话：

1. 准备 50-100 条标注好的 query-document 对
2. 用 512 + overlap 50 跑基线，记录检索准确率
3. 分别测 256 / 768 / 1024，对比变化
4. 如果准确率仍不达标，换父子块方案

## 四、三个容易被忽略的工程细节

### 稳定 chunk id 支撑增量重建

如果每次重建都重新生成所有 chunk id，就没法做增量更新和版本对比。

正确做法是用**内容稳定哈希**——相同内容永远产生相同 id：

```python
def chunk_identity(page_content: str, metadata: dict) -> tuple[str, str]:
    """基于正文和标准元数据生成 parent_id 与 chunk_id。"""
    parent_content = str(metadata.get("parent_content") or page_content or "").strip()

    # 把版本维度纳入哈希，保证不同版本的同一内容 id 不同
    parent_id = stable_hash(
        metadata.get("scenario_id"),
        metadata.get("kb_version"),
        metadata.get("embedding_model_version"),
        metadata.get("chunk_schema_version"),
        metadata.get("doc_id"),
        parent_content,
    )
    # 子块 id 用子块自身内容参与哈希，保证同父块下不同子块 id 不同
    chunk_id = stable_hash(parent_id, page_content)
    return parent_id, chunk_id
```

注意把 **kb_version、embedding_model_version、chunk_schema_version** 都纳入哈希。这样换 embedding 模型后，旧的 chunk 不会和新 chunk 混在一起。

### 表格不能按文本切

把表格按字符切开会得到什么？一堆没有表头的数字行，完全没法用。

表格的正确处理是**行级语义化**：CSV/Excel 按表头、工作表、行号转换成行级 Document，每行是一条独立记录，并保留完整的元数据（table_id、sheet_name、row_number、表头信息）。

```python
# 表格行不参与父子切分，整行作为唯一块
if is_table_metadata(metadata):
    parent_id = stable_hash(
        ..., metadata.get("table_id"),
        metadata.get("sheet_name"), metadata.get("row_number"), parent_content,
    )
    return parent_id, stable_hash(parent_id, parent_content)
```

原因很直接：表格行本身已经是**治理后的完整证据单元**，再切就破坏了行列关系。

### 元数据是检索质量的一部分

一个 chunk 的内容如果只是"他签署了这项法案"，没有元数据，模型根本不知道"他"是谁、"法案"是什么。

必须注入的元数据：文档标题、来源文件路径、页码/行号、生效日期、业务分类（source）、权限标签。

元数据同时承担**过滤**职责——数据隔离（tenant、dataset、allowed_roles）就是在检索时用元数据过滤实现的。

## 五、怎么选

按文档特征选：

- **短文本、FAQ**：直接整条作为一个块，不用切
- **通用知识文档**：递归切分起步，效果不好再上语义切分
- **长文档、规章制度、手册**：上父子块，收益非常明显
- **表格、结构化数据**：行级语义化，不走文本切分
- **代码**：用专门的代码切分器（按 AST 切），不要按字符切

最重要的一条原则：**别一上来就追求最先进的方案**。先看你的文档长度、内容结构、检索目标是不是配得上它。很多系统用递归切分 + 合理参数就能达到 80 分，而为了最后的 10 分硬上复杂方案，带来的维护成本往往不划算。

## 小结

分块决定 RAG 检索质量的上限，但它不是"越复杂越好"。

四种策略的取舍很清晰：固定切分简单但破坏语义；递归切分是通用默认（中文记得自定义分隔符）；语义切分质量最高但要配递归兜底；父子块是生产环境的首选方案，用"小块检索、大块回答"解决精度与完整性的矛盾。

三个工程细节决定落地质量：**稳定 chunk id** 支撑增量重建和版本管理、**表格行级处理**而非文本切分、**元数据**既是上下文也是过滤条件。

切好块之后，下一步是检索。为什么单纯用向量检索不够、必须混合关键词检索，见 [RAG 混合检索：向量与关键词为什么要一起用](article.html?slug=rag-hybrid-search)。
