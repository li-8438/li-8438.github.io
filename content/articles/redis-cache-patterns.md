---
title: Redis 缓存设计：穿透、击穿、雪崩与分布式锁
slug: redis-cache-patterns
summary: 缓存三大经典问题逐个拆解，从缓存空值、布隆过滤器到分布式锁与 Redlock，给出可直接用的 Python 实现，并补上大模型场景下的响应缓存与限流打法。
tags: [Redis, 缓存, 分布式锁, 高并发]
section: 学习笔记
topic: 数据与存储
subtopic: Redis
published: true
---

把 Redis 接进系统只要半天，但让缓存「正确」地工作，要踩的坑远不止于此。缓存最麻烦的不是怎么用，而是这三个经典问题：**穿透**（查一个根本不存在的数据）、**击穿**（热点 key 过期的瞬间）、**雪崩**（大批 key 同时失效）。

再加两个工程上绕不开的：缓存与数据库怎么保持一致、分布式锁怎么实现才不会误删别人的锁。

## 缓存更新策略：先删缓存还是先更新数据库

在讲三大问题前，先定一个基调——**Cache Aside（旁路缓存）** 是最常用的模式，它的读写规则是：

**读**：先读缓存 → 命中直接返回 → 未命中读数据库 → 写入缓存后返回。

**写**：先更新数据库 → 再删除缓存。

```python
def get_user(user_id: int) -> dict | None:
    """读：命中缓存直接返回，未命中回源并回填。"""
    key = f"user:{user_id}"
    data = r.get(key)
    if data:
        return json.loads(data)          # 缓存命中

    row = db.query("SELECT * FROM users WHERE id = %s", user_id)
    if not row:
        return None
    r.setex(key, 3600, json.dumps(row))  # 回填，带过期时间
    return row


def update_user(user_id: int, name: str) -> None:
    """写：先更数据库，再删缓存（而不是更新缓存）。"""
    db.execute("UPDATE users SET name = %s WHERE id = %s", name, user_id)
    r.delete(f"user:{user_id}")          # 删除，不是 set
```

为什么是「删缓存」而不是「更新缓存」？因为更新缓存的代价高且容易出错：一个用户对象被 10 个地方引用，更新时要找出所有相关缓存；而且两个并发写操作可能因为时序问题，把旧值写回缓存。删除更简单——下次读的时候自然会从数据库加载新值。

为什么「先更数据库，再删缓存」而不是反过来？反过来的话：线程 A 删缓存 → 线程 B 读缓存未命中、查到旧值、写入缓存 → 线程 A 更新数据库。结果缓存里是旧值，数据库里是新值，不一致会一直持续到缓存过期。

## 缓存穿透：查一个根本不存在的数据

**现象**：请求查询一个数据库中根本不存在的数据（比如 id = -1，或者恶意随机生成的 ID）。缓存不会命中，每次都打到数据库。攻击者用海量随机 ID 轰炸，数据库直接被打垮。

**方案一：缓存空值**。最简单直接——数据库查不到，也在缓存里放个空标记，设一个较短的过期时间。

```python
def get_user_safe(user_id: int) -> dict | None:
    key = f"user:{user_id}"
    cached = r.get(key)
    if cached is not None:
        # 空值标记：查过一次，确认数据库里没有
        if cached == "__NULL__":
            return None
        return json.loads(cached)

    row = db.query("SELECT * FROM users WHERE id = %s", user_id)
    if not row:
        r.setex(key, 300, "__NULL__")    # 空值只缓存 5 分钟
        return None

    r.setex(key, 3600, json.dumps(row))
    return row
```

优点是简单，缺点是如果攻击者的 ID 每次都不同，会缓存大量无用的空 key，浪费内存。

**方案二：布隆过滤器**。在缓存之前再加一层拦截。布隆过滤器是一个概率型数据结构，能确定「某个 key 一定不存在」或「可能存在」——注意它有微小的误判率（说存在但实际不存在），但绝不会漏判（说不存在就一定不存在）。

```python
from pybloom_live import BloomFilter

# 系统启动时，把所有合法 ID 灌进过滤器
bf = BloomFilter(capacity=1_000_000, error_rate=0.001)
for uid in db.query("SELECT id FROM users"):
    bf.add(uid)

def get_user_bf(user_id: int) -> dict | None:
    if user_id not in bf:
        return None          # 一定不存在，直接返回，连缓存都不用查
    # ... 后续走正常的缓存 + 数据库流程
```

Python 里可以用 `pybloom-live` 或 Redis 的 RedisBloom 模块。单机场景用前者，分布式场景用后者。

**方案三：参数校验**。最前置的防线：ID 必须是正整数、必须在合理范围内。能拦掉大部分低级攻击。

生产环境通常组合使用：**参数校验 + 布隆过滤器 + 缓存空值**。

## 缓存击穿：热点 key 过期的瞬间

**现象**：某个极热的 key（比如秒杀商品的详情）在过期的那一瞬间，成千上万的请求同时发现缓存没了，一起涌向数据库。数据库瞬间压力爆表。

和穿透的区别：穿透是「数据根本不存在」，击穿是「数据存在，只是缓存刚好过期了」。

**方案一：分布式锁**。只允许一个请求去数据库加载，其他请求等着。

```python
def get_hot_goods(goods_id: int, expire: int = 3600) -> dict | None:
    """互斥锁防击穿：同一时刻只有一个请求回源。"""
    key = f"goods:{goods_id}"
    lock_key = f"lock:goods:{goods_id}"

    data = r.get(key)
    if data:
        return json.loads(data)

    # set nx ex 是原子操作：不存在才设置，并带过期时间
    acquired = r.set(lock_key, "1", nx=True, ex=10)
    if not acquired:
        # 没抢到锁：短暂等待后重读缓存（此时别人已经回填好了）
        time.sleep(0.05)
        return get_hot_goods(goods_id, expire)

    try:
        # 双重检查：防止等待期间已有其他请求回填
        data = r.get(key)
        if data:
            return json.loads(data)

        row = db.query("SELECT * FROM goods WHERE id = %s", goods_id)
        if row:
            # 热点数据过期时间设长一些
            r.setex(key, expire, json.dumps(row))
        return row
    finally:
        r.delete(lock_key)    # 必须在 finally 里释放，避免异常导致死锁
```

注意 `SET key value NX EX 10` 必须是**一条原子命令**。如果分成 `SETNX` + `EXPIRE` 两步，中间进程崩溃，锁就永远不释放了。

**方案二：热点 key 永不过期**。对极少更新的数据（首页配置、活动商品），干脆不设过期时间，靠后台定时任务主动更新。性能最好，代价是可能短暂读到旧值。

**方案三：逻辑过期**。缓存物理上不过期，但在 value 里存一个过期时间戳。发现逻辑过期了，就抢锁去异步刷新，自己先把旧值返回给用户。这样没有任何请求会被阻塞，是高并发场景的最优解。

```python
import json, time, uuid

def get_with_logical_expire(key: str):
    """逻辑过期：过期时不阻塞请求，返回旧值并异步刷新。"""
    raw = r.get(key)
    if not raw:
        return rebuild(key)             # 冷启动，同步构建

    wrapper = json.loads(raw)
    if wrapper["expire_at"] > time.time():
        return wrapper["data"]          # 未过期，直接返回

    # 已逻辑过期：抢锁去刷新，抢不到就返回旧的
    if r.set(f"lock:{key}", "1", nx=True, ex=10):
        threading.Thread(target=rebuild_async, args=(key,)).start()
    return wrapper["data"]              # 先返回旧值，用户无感知
```

**方案四：缓存预热 + 随机过期时间**。系统启动时提前把热点数据加载进缓存；过期时间加随机偏移，避免同时失效。

## 缓存雪崩：大批 key 同时失效

**现象**：大量缓存 key 在同一时刻集中过期，或者 Redis 整体宕机，导致所有请求直接砸到数据库。数据库扛不住，整个系统雪崩。

和击穿的区别：击穿是**单个**热点 key，雪崩是**大批** key 或整个 Redis 不可用。

**核心方案：过期时间加随机值**，把集中过期打散。

```python
import random

def set_with_jitter(key: str, value: str, base_ttl: int = 1800) -> None:
    """在基础过期时间上叠加 0~600 秒随机偏移，打散失效时刻。"""
    ttl = base_ttl + random.randint(0, 600)
    r.setex(key, ttl, value)
```

一个常见的事故来源：系统上线时用脚本批量预热缓存，所有 key 都设成 30 分钟，结果 30 分钟后一起失效。

**另外三层防护**：

1. **Redis 高可用**——主从 + 哨兵，或者 Redis Cluster，避免单点故障导致整体不可用
2. **多级缓存**——本地缓存（进程内）+ Redis 分布式缓存。Redis 挂了，本地缓存还能顶一阵
3. **熔断降级**——数据库压力过大时，直接返回兜底数据或友好提示，宁可部分功能不可用，也不要整个系统崩掉

## 分布式锁：别误删别人的锁

分布式锁最经典的错误实现，是「加锁 → 业务 → 删锁」三步走：

```python
# ❌ 错误示范
r.setnx("lock:order", "1")
try:
    do_something()
finally:
    r.delete("lock:order")      # 危险：可能删掉别人的锁
```

问题在哪？线程 A 拿到锁，但业务执行时间超过了锁的过期时间，锁自动释放了；线程 B 随后拿到锁；此时 A 执行完，把 B 的锁删了。

**正确的实现有两个要点**：锁的值必须是唯一标识，释放时要用 Lua 脚本做「校验 + 删除」的原子操作。

```python
import uuid

# Lua 脚本：只有 value 匹配才删除（GET 和 DEL 必须原子执行）
UNLOCK_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
"""

class RedisLock:
    """一个够用的 Redis 分布式锁。生产环境建议直接用 Redisson / redis-py 的 Lock。"""

    def __init__(self, redis_client, name: str, expire: int = 10):
        self.r = redis_client
        self.key = f"lock:{name}"
        self.token = str(uuid.uuid4())     # 唯一标识，防止误删别人的锁
        self.expire = expire
        self._unlock = None

    def acquire(self, timeout: float = 5.0) -> bool:
        """尝试获取锁，最多等 timeout 秒。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.r.set(self.key, self.token, nx=True, ex=self.expire):
                self._unlock = self.r.register_script(UNLOCK_SCRIPT)
                return True
            time.sleep(0.01)
        return False

    def release(self) -> None:
        if self._unlock:
            self._unlock(keys=[self.key], args=[self.token])
            self._unlock = None

    def __enter__(self):
        if not self.acquire():
            raise TimeoutError(f"获取锁失败: {self.key}")
        return self

    def __exit__(self, *exc):
        self.release()
```

用起来很清爽：

```python
with RedisLock(r, f"goods:{goods_id}", expire=10):
    # 临界区：同一时刻只有一个进程能进来
    stock = int(r.get(f"stock:{goods_id}"))
    if stock > 0:
        r.decr(f"stock:{goods_id}")
```

**为什么不自己造轮子**：上面的实现还有「业务没执行完锁就过期」的问题，需要看门狗机制定期续期——这正是 `Redisson`（Java）做的事。Python 里 `redis-py` 内置了 `redis.lock.Lock`，支持自动续期：

```python
lock = r.lock("my-lock", timeout=10, blocking_timeout=5)
with lock:
    do_something()
```

它内部会在锁快过期时自动延长，并且释放时校验 token。生产环境优先用它。

**Redis 单点故障怎么办**：如果主节点挂了、锁还没同步到从节点，另一个客户端就能从新的主节点拿到同一把锁。Redis 作者提出了 Redlock 算法——向 N 个独立节点申请锁，超过半数成功才算拿到。但 Redlock 在业界争议不小（时钟漂移、GC 暂停都可能破坏其正确性）。实践建议：**对一致性要求极高的场景，别用 Redis 锁，用数据库锁或 etcd/ZooKeeper**。

## 缓存与数据库的一致性

前面说的「先更数据库，再删缓存」在并发下仍可能出问题：

1. 缓存刚好过期
2. 线程 A 查数据库，读到旧值
3. 线程 B 更新数据库
4. 线程 B 删除缓存
5. 线程 A 把旧值写入缓存 ← 脏数据回来了

这个时序要求「读线程比写线程慢」，发生概率低但确实存在。工程上的解法是**延迟双删**：

```python
def update_with_double_delete(user_id: int, name: str) -> None:
    key = f"user:{user_id}"
    r.delete(key)                                  # 第一次删
    db.execute("UPDATE users SET name = %s WHERE id = %s", name, user_id)
    # 延迟几百毫秒再删一次，清掉期间可能被写入的旧值
    threading.Timer(0.5, lambda: r.delete(key)).start()
```

几种方案的取舍：

| 场景 | 方案 | 一致性 |
|---|---|---|
| 普通业务 | 先更 DB 再删缓存 | 最终一致，可接受极小概率脏数据 |
| 并发较高 | 延迟双删 | 较好 |
| 强一致要求 | 分布式事务 / 消息队列异步更新 | 强一致，复杂度高 |

**缓存设过期时间是兜底底线**。哪怕出现了脏数据，过期后也会自动纠正。不设过期时间的缓存是不一致问题的放大器。

## 大模型应用中的落地

Redis 在大模型应用里除了常规缓存，还有几个特有场景。

**LLM 响应缓存**。大模型调用又慢又贵，相同问题完全没必要重复调用。用问题文本的哈希做 key：

```python
import hashlib

def ask_with_cache(question: str, ttl: int = 86400) -> str:
    """相同问题直接返回缓存结果，省掉一次模型调用。"""
    qhash = hashlib.md5(question.strip().encode()).hexdigest()
    key = f"llm:cache:{qhash}"

    cached = r.get(key)
    if cached:
        return cached

    answer = call_llm(question)          # 真正的模型调用
    r.setex(key, ttl, answer)
    return answer
```

这一招在客服、FAQ 场景命中率惊人——用户问的问题高度重复。

**API 限流**。大模型 API 通常有 RPM/TPM 限制，超了就报错。用 Redis 做滑动窗口限流：

```python
def check_rate_limit(user_id: str, limit: int = 60, window: int = 60) -> bool:
    """滑动窗口限流：window 秒内最多 limit 次请求。"""
    key = f"ratelimit:{user_id}"
    now = time.time()

    pipe = r.pipeline()
    pipe.zremrangebyscore(key, 0, now - window)   # 清掉窗口外的记录
    pipe.zcard(key)                                # 统计窗口内请求数
    _, count = pipe.execute()

    if count >= limit:
        return False

    r.zadd(key, {str(now): now})                   # 记录本次请求
    r.expire(key, window)
    return True
```

用有序集合（Sorted Set）实现滑动窗口，比固定窗口计数更平滑，不会出现窗口边界处流量翻倍的问题。

**多轮对话历史**。用 List 存最近的 N 轮对话，天然有序、自动截断：

```python
def append_message(session_id: str, role: str, content: str, max_turns: int = 20):
    key = f"chat:{session_id}"
    r.rpush(key, json.dumps({"role": role, "content": content}))
    r.ltrim(key, -max_turns * 2, -1)     # 只保留最近 20 轮（40 条）
    r.expire(key, 604800)                # 7 天无活动自动清理
```

**流式输出的中间状态**。模型流式返回时，用 Redis 暂存已生成的部分，即使连接断开也能续传。

## 小结

三大问题的核心解法一句话总结：

| 问题 | 本质 | 解法 |
|---|---|---|
| 穿透 | 数据不存在 | 参数校验 + 布隆过滤器 + 缓存空值 |
| 击穿 | 单个热点 key 过期 | 互斥锁 / 逻辑过期 / 热点永不过期 |
| 雪崩 | 大批 key 同时失效 | 随机过期时间 + 多级缓存 + 熔断降级 |

几条铁律：

1. **写操作先更数据库，再删缓存**，而不是更新缓存
2. **缓存一定要设过期时间**，这是不一致问题的最后兜底
3. **分布式锁必须用 `SET NX EX` 原子加锁**，释放时用 Lua 脚本做「校验 + 删除」
4. **生产环境优先用成熟客户端**（Python 用 `redis-py` 的 `Lock`），别自己造轮子
5. **大模型调用结果值得缓存**——相同问题直接返回，省钱又提速
