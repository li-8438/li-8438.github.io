---
title: 迁移学习与 BERT 微调实战
slug: nlp-transfer-learning-bert
summary: 为什么微调比从头训练划算？预训练-微调范式是怎么工作的？这篇讲清迁移学习的两种用法、BERT 的输入格式与预训练任务，并用 HuggingFace 跑通一个完整的文本分类微调流程。
tags: [NLP, BERT, 迁移学习, 微调, HuggingFace]
section: 学习笔记
topic: 模型基础
subtopic: NLP
published: true
---

训练一个大模型需要几千万美元的算力和几万亿 token 的数据——这对绝大多数团队都不现实。好在有个办法能用上这些能力：**迁移学习**。

简单说就是：别人花巨资训好的模型，你拿过来，用自己几千条数据稍微调一调，就能在你的任务上达到很好的效果。这是过去几年 NLP 领域**最重要的工程范式**。

## 什么是迁移学习

迁移学习的思路是**把一个领域学到的知识，迁移到另一个相关领域**。

类比：一个读过海量中文书籍的人，去学法律文书审核，比一个只认识几千字的人快得多——因为语言理解能力是通用的，不需要从头学。

在 NLP 里的具体形式：

```
预训练（Pre-training）：在大规模通用语料上训练，学通用的语言理解能力
                              ↓
微调（Fine-tuning）：在你的小数据集上继续训练，适配具体任务
```

**预训练**阶段模型学会了语法、语义、世界知识；**微调**阶段只是教会它"把这些能力用在你的任务上"。

## 两种用法

### 用法一：特征提取（冻结）

把预训练模型当成**固定的特征提取器**：输入文本，拿到向量表示，然后接一个简单的分类器。

```python
from transformers import AutoTokenizer, AutoModel
import torch

tokenizer = AutoTokenizer.from_pretrained('bert-base-chinese')
model = AutoModel.from_pretrained('bert-base-chinese')

# 冻结所有参数，不参与训练
for param in model.parameters():
    param.requires_grad = False

inputs = tokenizer('这段文本要分类', return_tensors='pt')
with torch.no_grad():
    outputs = model(**inputs)
    # last_hidden_state: (batch, seq_len, 768)
    embeddings = outputs.last_hidden_state
    # 取 [CLS] 位置的向量作为整句表示
    sentence_vector = embeddings[:, 0, :]
```

优点：**训练极快**（只训分类器）、显存占用小、不会破坏预训练权重。缺点：效果通常略差于微调。

### 用法二：微调（端到端）

**不冻结任何参数**，让整个模型在你的数据上继续训练：

```python
from transformers import AutoModelForSequenceClassification

model = AutoModelForSequenceClassification.from_pretrained(
    'bert-base-chinese', num_labels=2
)
# 所有参数都可训练，会跟着你的数据更新
```

优点：效果更好，模型能真正适配你的领域。缺点：**需要 GPU**、有灾难性遗忘风险、要小心调参。

**实践中绝大多数场景用微调**，因为效果差距明显，而现在的 GPU 资源（哪怕是 Colab 免费版）都够用。

## BERT 的输入格式

理解 BERT 的输入构造，是正确使用它的前提。

### 特殊 token

```
[CLS]  我  爱  自然  语言  [SEP]  它  很  有  趣  [SEP]
  ↑                          ↑                      ↑
句首标记                  句子分隔符              句尾
```

- **`[CLS]`** —— 放在最开头，它对应的输出向量被当作**整个句子的表示**。做分类时就是用这个向量
- **`[SEP]`** —— 分隔两个句子，或标记单句结束

### 三个输入张量

Tokenizer 会输出三个东西：

```python
inputs = tokenizer('我爱自然语言处理', return_tensors='pt')
print(inputs.keys())
# dict_keys(['input_ids', 'token_type_ids', 'attention_mask'])
```

**`input_ids`** —— token 对应的整数 ID：

```
[101, 2769, 4263, 5632, 6427, 6427, ...]   # 101 是 [CLS]
```

**`attention_mask`** —— 标记哪些位置是真实 token（1）哪些是填充（0）：

```
[1, 1, 1, 1, 1, 1, 0, 0, 0, 0]   # 后面 4 个是 padding
```

**`token_type_ids`** —— 区分第一句（0）和第二句（1）：

```
[0, 0, 0, 0, 0, 1, 1, 1, 1, 0]   # [SEP] 之后变成 1
```

**attention_mask 千万别忘**——批量推理时句子长度不同，短的要用 padding 补齐，但 padding 不能参与注意力计算。没有 mask 的话，填充符号会污染结果。

### 长度限制

BERT 的最大长度是 **512 token**，超出会被截断：

```python
tokenizer(text, truncation=True, max_length=512, padding='max_length')
```

处理长文档时要先切分，或者换用支持长上下文的模型（Longformer、BigBird 可达 4096+）。

## BERT 的两个预训练任务

BERT 之所以强大，是因为它在预训练时做了两个巧妙的任务：

### 掩码语言模型（MLM）

**随机遮住 15% 的 token，让模型预测被遮住的是什么**：

```
输入：  我  爱  [MASK]  语言  处理
目标：                自然
```

这迫使模型**必须同时看左右上下文**才能猜对被遮的词——这就是 BERT 叫"双向编码器"的原因（对比 GPT 只看左边）。

### 下一句预测（NSP）

**判断两句话是不是连续的**：

```
句A：我今天去了公园
句B：天气很好        → IsNext（连续）
句B：猫喜欢吃鱼      → NotNext（不连续）
```

这个任务让模型学会句子级别的关系，对问答、自然语言推理任务有帮助。（后来的 RoBERTa 发现 NSP 效果有限，去掉了它。）

## 实战：用 HuggingFace 微调文本分类

完整流程走一遍。以情感二分类为例。

### 第一步：加载数据和分词器

```python
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForSequenceClassification

dataset = load_dataset('imdb')   # 或用 load_dataset('csv', data_files='data.csv')

model_name = 'bert-base-uncased'
tokenizer = AutoTokenizer.from_pretrained(model_name)

def tokenize_function(examples):
    return tokenizer(
        examples['text'],
        padding='max_length',
        truncation=True,
        max_length=256     # 比 512 短，训练快很多
    )

tokenized = dataset.map(tokenize_function, batched=True)
```

### 第二步：加载模型

```python
model = AutoModelForSequenceClassification.from_pretrained(
    model_name,
    num_labels=2,
    id2label={0: 'negative', 1: 'positive'},
    label2id={'negative': 0, 'positive': 1}
)
```

加载时会看到一条警告，说某些权重没用上、某些是随机初始化的。**这是正常的**——模型的预训练分类头被丢掉了，换成了随机初始化的新分类头，等着用你的数据训练。

### 第三步：定义评估指标

```python
import numpy as np
from sklearn.metrics import accuracy_score, f1_score

def compute_metrics(eval_pred):
    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)
    return {
        'accuracy': accuracy_score(labels, predictions),
        'f1': f1_score(labels, predictions, average='weighted')
    }
```

### 第四步：配置训练参数

```python
from transformers import TrainingArguments, Trainer

training_args = TrainingArguments(
    output_dir='./bert-sentiment',
    num_train_epochs=3,
    per_device_train_batch_size=16,
    per_device_eval_batch_size=32,
    learning_rate=2e-5,          # 微调的经典学习率
    weight_decay=0.01,           # L2 正则化
    warmup_steps=500,            # 学习率预热
    evaluation_strategy='epoch',
    save_strategy='epoch',
    load_best_model_at_end=True, # 自动保留最佳 checkpoint
    metric_for_best_model='f1',
    logging_steps=100,
    fp16=True                    # 混合精度，显存减半（需 GPU）
)
```

### 第五步：训练

```python
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized['train'],
    eval_dataset=tokenized['test'],
    compute_metrics=compute_metrics
)

trainer.train()
results = trainer.evaluate()
print(f"准确率: {results['eval_accuracy']:.4f}")
print(f"F1: {results['eval_f1']:.4f}")
```

Trainer 帮你封装了所有工程细节：训练循环、梯度累积、混合精度、学习率调度、checkpoint 保存、日志记录。

### 第六步：保存和使用

```python
trainer.save_model('./my_model')
tokenizer.save_pretrained('./my_model')

# 推理
from transformers import pipeline
classifier = pipeline('text-classification', model='./my_model')
print(classifier('This movie was absolutely fantastic!'))
```

## 微调的关键经验

### 学习率要小

**微调的学习率通常是 1e-5 ~ 5e-5，比从零训练小 1~2 个数量级**。

原因：预训练权重已经很好了，大学习率会把它们冲坏，导致**灾难性遗忘**（模型忘了预训练学到的知识，在你的小数据集上过拟合）。

### 训练轮数要少

**通常 2~4 个 epoch 就够了**。轮数多了必然过拟合。用 `load_best_model_at_end=True` 自动保留验证集上最好的那个 checkpoint。

### 数据量要够但不用太多

经验参考：

- **几百条** —— 可以微调，但效果依赖数据质量
- **几千条** —— 大多数任务能达到不错效果
- **上万条** —— 接近上限，再加收益递减

**数据质量远比数量重要**。1000 条标注准确的样本，效果好于 10000 条噪声很大的样本。

### 显存不够怎么办

```python
# 1. 减小 batch_size
per_device_train_batch_size=8

# 2. 开启混合精度（显存减半）
fp16=True

# 3. 梯度累积（模拟大 batch）
gradient_accumulation_steps=4   # 实际 batch = 8 × 4 = 32

# 4. 缩短序列长度
max_length=128
```

## 大模型时代的选型判断

有了 GPT-4 这类强大模型后，还要不要微调？这是个现实问题。

**优先用提示词 + RAG 的场景**：

- 数据量少（几百条以内）
- 任务变化频繁，需要快速迭代
- 没有 GPU 资源或工程能力
- 需要生成能力而不只是分类

**应该微调的场景**：

- 有几千条以上高质量标注数据
- 任务固定，长期运行
- 对**延迟和成本**敏感（微调后的小模型推理快、便宜几个数量级）
- 有领域专有知识或术语，通用模型理解不好
- 数据隐私要求，不能调外部 API

**一个实用的判断流程**：

```
1. 先用提示词（零样本/少样本）跑基线
2. 效果不够 → 加 RAG 补知识
3. 还不够 → 收集标注数据，微调小模型
4. 对比：微调模型的准确率 vs 大模型的成本×调用量
```

很多团队跳过了第 1、2 步直接微调，结果发现提示词工程做好就够了，**白花了大量标注成本**。

## 大模型应用开发中的落地

**第一，微调不是万能药，先做基线对比**。最常见的错误是一上来就说"我们要微调一个模型"。正确顺序永远是：提示词 → RAG → 微调。前面两步往往能解决 80% 的问题，而且成本几乎为零。

**第二，Embedding 模型微调是 RAG 的高阶优化手段**。通用 Embedding 模型在垂直领域（医疗、法律、金融）表现往往一般，因为领域术语的语义和通用语境不同。用自己的文档对（query, 相关文档）微调 Embedding 模型，检索准确率能有显著提升——**这是 RAG 优化里收益最高的手段之一**。

**第三，LoRA 让微调变得平民化**。全量微调一个 7B 模型需要多张 A100，而 **LoRA** 只训练少量低秩矩阵（通常只占总参数的 0.1%），单张消费级显卡就能跑，效果接近全量微调。

```python
from peft import LoraConfig, get_peft_model

config = LoraConfig(
    r=8,                      # 低秩维度
    lora_alpha=32,
    target_modules=['q_proj', 'v_proj'],   # 只调注意力的 Q、V 投影
    lora_dropout=0.05
)
model = get_peft_model(model, config)
```

**第四，灾难性遗忘是微调的头号风险**。用小学习率、少轮数、保留部分通用数据混合训练，都是有效的缓解手段。微调后**一定要在通用能力上抽测**，确认模型没有"变傻"。

**第五，微调后的模型部署成本远低于 API**。一个微调好的 BERT-base 只有 110M 参数，单张 CPU 就能跑到毫秒级延迟，成本是调 GPT-4 API 的万分之一。**高并发场景下，微调小模型是唯一的 economically viable 方案**。

## 小结

迁移学习的核心是**预训练学通用能力 + 微调适配具体任务**。BERT 通过掩码语言模型实现双向理解，输入需要 `[CLS]`/`[SEP]` 标记和 attention_mask，最大长度 512。微调的关键参数是**学习率 2e-5 量级、2~4 个 epoch、配合 warmup 和权重衰减**。

在大模型时代，**微调不是第一选择**——应该先试提示词和 RAG，确认不够再微调。但在高并发、低成本、数据隐私的场景下，微调小模型依然是不可替代的方案。

到这里，从机器学习到深度学习再到 NLP 的完整链路就走通了，接下来可以进入 LLM 应用层——提示词工程、RAG、Agent。
