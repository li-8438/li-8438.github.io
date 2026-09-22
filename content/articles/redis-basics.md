---
title: Redis 入门：数据结构、持久化与事务
slug: redis-basics
summary: 理解 Redis 为什么快（内存 + 空间换时间），掌握五大数据结构、持久化（RDB/AOF）与事务，以及发布订阅、管道等进阶特性。
tags: [Redis, 缓存, 数据库]
section: 学习笔记
topic: 数据与存储
subtopic: Redis
published: true
---

MySQL 把数据持久化在磁盘，安全但慢；Redis 把数据放在内存里，快但有容量限制。两者互补：MySQL 做「持久存储」，Redis 做「高速缓存」。Redis 默认端口 6379，核心思想是**用内存空间换访问时间**。

## 为什么用 Redis

内存的读写速度比磁盘快几个数量级。把热点数据（登录态、排行榜、计数器）放 Redis，能大幅降低数据库压力、加快响应。代价是内存贵、断电可能丢数据，所以 Redis 通常定位为「缓存」，而不是唯一数据源。

## 五大数据结构

Redis 不只是「键值对」，它的值可以是多种结构，这是它和普通缓存最大的区别。

### 字符串（String）

最基本的结构，存字符串、数字都靠它：

```bash
set name "user_a"        # 存
get name                # 取 → "user_a"
mset a 1 b 2            # 批量存
mget a b                # 批量取
setex code 60 "123456"  # 带过期时间（60 秒），常做验证码
```

### 数值操作

字符串里存的是数字时，可以直接做原子加减，天然适合计数器：

```bash
incr views              # 自增 1
decr views              # 自减 1
incrby views 10         # 加 10
decrby views 5          # 减 5
```

### 哈希（Hash）

哈希存的是「字段 → 值」的映射，适合存一个对象：

```bash
hset user:1 name "user_a"      # 存单个字段
hmset user:1 age 18 city "北京"  # 批量存
hget user:1 name              # 取单个字段
hgetall user:1                # 取全部字段
hkeys user:1                  # 所有字段名
hvals user:1                  # 所有值
hdel user:1 city              # 删除字段
```

### 列表（List）

有序的字符串列表，支持两端操作，适合消息队列：

```bash
lpush tasks "任务1"    # 从左边插入
rpush tasks "任务2"    # 从右边插入
lpop tasks             # 从左边弹出
rpop tasks             # 从右边弹出
llen tasks             # 长度
lrange tasks 0 -1      # 取整个列表
```

### 集合（Set）

无序、自动去重，适合做去重和集合运算：

```bash
sadd tags "python" "redis"    # 添加
srem tags "python"            # 删除
sismember tags "redis"        # 是否存在
smembers tags                 # 所有成员
scard tags                    # 元素个数
sinter set1 set2              # 交集（共同好友）
sunion set1 set2              # 并集
sdiff set1 set2               # 差集
```

### 有序集合（Sorted Set）

集合加一个「分数」，按分数排序，适合排行榜：

```bash
zadd rank 100 "user_a"        # 添加，100 是分数
zscore rank "user_a"          # 查分数
zrank rank "user_a"           # 查排名（从低到高）
zrangebyscore rank 90 100    # 按分数区间取
zrevrange rank 0 9           # 按分数从高到低取前 10
```

## 键的通用命令

操作键本身（不关心值是什么类型）的通用命令，先认识一批最常用的：

```bash
exists key            # 键是否存在
type key              # 键的类型（string/hash/list/set/zset）
del key               # 删除键
expire key 300        # 设置过期时间（秒）
ttl key               # 查剩余存活时间（-1 永不过期，-2 已不存在）
persist key           # 移除过期时间，转为永久
keys pattern          # 按模式匹配键（keys session:*）
```

一个约定：**键名用「冒号」分层**，如 `user:1001`、`order:20250101`，一眼能看出归属和层级。`keys *` 会遍历所有键，数据量大时很慢，生产环境禁用，改用 `scan` 增量遍历。

## 持久化：RDB 与 AOF

Redis 是内存数据库，断电数据就没了。要保住数据，得靠持久化——把内存数据写到磁盘。两种机制，各有取舍。

### RDB：快照

在某个时间点，把**整个内存数据**写成一份二进制快照文件 `dump.rdb`。

触发方式有三种：

```bash
save        # 同步执行，会阻塞 Redis 直到写完，生产禁用
bgsave      # 后台执行，fork 一个子进程去写，主进程继续服务
```

生产环境用配置自动触发，比如 `save 900 1` 表示「900 秒内只要有 1 次修改就存一次」：

```ini
save 900 1
save 300 10
save 60 10000
```

优点：文件紧凑、适合做全量备份；恢复时直接加载，速度极快。缺点：**两次快照之间宕机会丢失这部分数据**——RDB 是有间隔的，不是每时每刻都在存。

### AOF：追加日志

把每一条写命令追加记录到日志文件里，重启时「重放」日志来重建数据。

核心是刷盘策略，通过 `appendfsync` 控制：

| 策略 | 行为 | 安全性 | 性能 |
|---|---|---|---|
| always | 每条命令都刷盘 | 最高，几乎不丢 | 最慢 |
| everysec | 每秒刷一次 | 最多丢 1 秒数据 | 折中，**默认** |
| no | 交给操作系统决定 | 不可控 | 最快 |

优点：数据更安全（默认最多丢 1 秒）；日志是文本，可读、可手动修复。缺点：文件比 RDB 大；恢复速度比 RDB 慢（要逐条重放）。

### 怎么选

生产环境通常**两者都开**：RDB 做定期全量备份，AOF 做实时增量保护。Redis 4.0+ 还支持混合持久化——AOF 重写时用 RDB 格式打底，兼顾恢复速度和数据安全。

一句判断：**能接受几分钟数据丢失、要恢复快，选 RDB；数据不能丢、能接受慢一点，选 AOF；都要就都开。**

## 事务、发布订阅与管道

### 事务：命令打包，不是回滚

Redis 事务用 `MULTI` 开始、`EXEC` 执行，中间的多个命令会排队，到 EXEC 时一起执行：

```bash
multi                  # 开始事务
set name "user_a"       # 入队
incr views             # 入队
exec                   # 一起执行
```

**最大的坑：Redis 事务不保证原子性**。这和 MySQL 完全不同——某条命令执行失败，前面的不回滚、后面的照常执行。Redis 事务本质是「批量执行脚本」，不是「要么全成要么全败」。

`WATCH` 能实现**乐观锁**：监视某个 key，如果在 EXEC 之前这个 key 被别的客户端改了，整个事务就中断不执行。典型用途是防止并发超卖：

```bash
watch stock:1001       # 监视库存
multi
decr stock:1001        # 扣库存
exec                   # 如果期间 stock:1001 被改过，exec 返回 nil，事务没执行
```

### 发布订阅 Pub/Sub

发布者往频道发消息，所有订阅了该频道的客户端实时收到。适合聊天室、实时推送：

```bash
subscribe news         # 订阅 news 频道（阻塞等待）
publish news "突发新闻" # 另一个客户端发布消息
```

注意：**消息不持久化**。订阅者没在线的那一刻，消息就错过了，不会补发。要可靠投递还得上专业的消息队列（如 RabbitMQ、Kafka），Pub/Sub 只适合「丢了也没关系」的实时通知场景。

### 管道 Pipeline

一次网络往返只执行一条命令，网络延迟（RTT）就成了瓶颈。Pipeline 把一批命令打包一起发，一次往返全执行完：

```python
pipe = r.pipeline()
for i in range(1000):
    pipe.set(f"key:{i}", i)     # 命令先攒着，不发
pipe.execute()                   # 一次性发出去
```

1000 次 `set` 从 1000 次 RTT 降到 1 次，提速非常可观。批量导入、批量写缓存时用它。这和 MySQL 的 `executemany` 是同一个思路。

## 大模型应用中的落地

Redis 在大模型应用里的用法，比传统 Web 场景还要多几个。

**多轮对话历史**。List 天然有序，正好存最近 N 轮对话：

```python
import json

r.rpush("chat:s123", json.dumps({"role": "user", "content": "你好"}))
r.rpush("chat:s123", json.dumps({"role": "assistant", "content": "你好，有什么可以帮你？"}))
r.ltrim("chat:s123", -40, -1)     # 只保留最近 20 轮（40 条）
r.expire("chat:s123", 604800)     # 7 天无活动自动清理
```

`ltrim` 是自动截断的关键，避免对话列表无限增长撑爆内存。

**大模型响应缓存**。相同问题没必要重复调用，用问题文本的哈希做 key：

```python
import hashlib

qhash = hashlib.md5(question.strip().encode()).hexdigest()
key = f"llm:cache:{qhash}"

cached = r.get(key)
if cached:
    return cached                  # 直接返回，省掉一次调用

answer = call_llm(question)
r.setex(key, 86400, answer)        # 缓存一天
return answer
```

这一招在客服、FAQ 场景命中率惊人——用户问的问题高度重复，省钱又提速。

**API 限流**。大模型 API 有 RPM/TPM 限制，用 Sorted Set 做滑动窗口限流：

```python
import time

key = f"ratelimit:{user_id}"
now = time.time()
r.zremrangebyscore(key, 0, now - 60)     # 清掉 60 秒前的记录
if r.zcard(key) >= 60:                   # 一分钟内超过 60 次
    raise TooManyRequests()
r.zadd(key, {str(now): now})
r.expire(key, 60)
```

**调用计数与配额**。String 的原子自增，天生适合计数：

```python
r.incrby(f"quota:used:{user_id}", tokens_used)     # 累加消耗的 token
r.ttl(f"quota:used:{user_id}")                     # 查剩余有效期
```

**分布式锁**。抢到锁才去回源或执行关键逻辑，`set nx ex` 一步到位。完整实现见 [Redis 缓存设计](article.html?slug=redis-cache-patterns)。

顺带一提：Redis 装了 RedisSearch 模块后，本身也能当向量数据库用。但功能完备度和生态不如专用方案，见 [向量数据库入门](article.html?slug=vector-database-rag)。

## 小结

选 Redis 结构就看你存什么：**单个值用 String，计数器用数字操作，对象用 Hash，队列用 List，去重/集合运算用 Set，排行榜用 Sorted Set**。

除了数据结构，还有三样核心能力要掌握：

1. **持久化**——RDB 快照做备份，AOF 日志做实时保护，生产环境两者都开
2. **事务**——`MULTI/EXEC` 只是命令打包，**不会回滚**；`WATCH` 做乐观锁防并发
3. **管道**——Pipeline 一次往返执行多条命令，批量操作提速神器

核心记住一点：Redis 是内存缓存、空间换时间，值是「结构化」的。会用数据结构只是第一步，接进系统后马上会遇到缓存穿透、击穿、雪崩这三个经典问题，接着看 [Redis 缓存设计：穿透、击穿、雪崩与分布式锁](article.html?slug=redis-cache-patterns)。
