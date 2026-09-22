---
title: MySQL 事务与锁：隔离级别、MVCC 和死锁排查
slug: mysql-transaction-lock
summary: 事务加了 @Transactional 库存还是超卖？这篇从一次真实的扣库存事故出发，讲清四种隔离级别的行为差异、MVCC 快照读的底层原理、行锁与间隙锁的加锁规则，以及死锁的完整排查链路。
tags: [MySQL, 事务, MVCC, 锁, 并发]
section: 学习笔记
topic: 数据与存储
subtopic: MySQL
published: true
---

促销活动上线第一天，客服群里炸了——用户反馈「明明提示下单成功，库存却变成负数」。排查代码，扣库存的逻辑看起来毫无问题：

```python
# 看似没问题的扣库存
def deduct_stock(sku_code):
    stock = query("SELECT stock FROM products WHERE sku_code = %s", sku_code)
    if stock > 0:
        execute("UPDATE products SET stock = %s WHERE sku_code = %s", stock - 1, sku_code)
```

事务也开了，WHERE 条件也走了索引。问题出在哪？

出在一个关键认知上：**事务 ≠ 锁**。InnoDB 默认的可重复读隔离级别下，普通 `SELECT` 是快照读，不加任何锁。两个事务同时读到 stock=100，都判断「> 0」，都执行 `UPDATE stock = 99`，库存就变成了 -1。

要理解为什么会这样、以及怎么正确解决，需要掌握三样东西：隔离级别（怎么读）、MVCC（为什么这么读）、锁机制（怎么写不冲突）。

## 事务的 ACID

先快速对齐概念。ACID 里最容易糊弄过去的是「隔离性」，而它恰恰是并发 bug 的源头：

| 特性 | 含义 | 实现机制 |
|---|---|---|
| 原子性 Atomicity | 事务不可分割，要么全做要么全不做 | undo log |
| 一致性 Consistency | 事务前后数据完整性一致 | 由另外三个特性共同保证 |
| 隔离性 Isolation | 事务之间互相隔离的程度 | MVCC + 锁 |
| 持久性 Durability | 提交后数据永久保存 | redo log |

## 四种隔离级别实测

SQL 标准定义了四种隔离级别，区别就在于「能容忍多少并发副作用」。三种副作用是：脏读（读到别人未提交的数据）、不可重复读（同一事务内两次读同一行结果不同）、幻读（同一事务内两次范围查询行数不同）。

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | InnoDB 实现 |
|---|---|---|---|---|
| READ UNCOMMITTED | 会 | 会 | 会 | 直接读最新版本，几乎不加锁 |
| READ COMMITTED | 不会 | 会 | 会 | 每次 SELECT 新建 ReadView |
| REPEATABLE READ（默认） | 不会 | 不会 | 快照读可防，当前读防不住 | 事务首次 SELECT 建 ReadView + 间隙锁 |
| SERIALIZABLE | 不会 | 不会 | 不会 | 读加共享锁，并发极差 |

用两个终端能完整复现。开启两个会话：

```sql
-- 会话 A
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
START TRANSACTION;
SELECT balance FROM account WHERE id = 1;
```

此时会话 B 执行 `UPDATE account SET balance = 500 WHERE id = 1;` 但**不提交**。会话 A 再查一次，会读到 500——这就是脏读。随后 B 回滚，那 500 从未真正存在过。

换成 REPEATABLE READ，同样的流程：A 第一次读到 1000，B 改成 600 并提交，A 第二次读仍然是 1000。因为 A 在第一次 SELECT 时就建好了 ReadView 快照，整个事务都从这个快照读，B 提交了也没用——A 的「时光机」停在了事务开始那一刻。

查看和修改当前隔离级别：

```sql
SELECT @@transaction_isolation;                              -- 查看
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;      -- 改当前会话
```

## MVCC：为什么读不加锁

MVCC（Multi-Version Concurrency Control，多版本并发控制）的核心价值是：**读不加锁，读写不冲突**。它靠三样东西实现。

**隐藏字段**。InnoDB 给每行记录加了三个隐藏列：`DB_TRX_ID`（最后修改这行的事务 ID）、`DB_ROLL_PTR`（回滚指针，指向 undo log 里的旧版本）、`DB_ROW_ID`（无主键时自动生成的行 ID）。

**Undo Log 版本链**。每次 UPDATE，旧版本就被写入 undo log，通过回滚指针串成一条链：

```
当前版本 (DB_TRX_ID=200)
    ↑ DB_ROLL_PTR
旧版本 (DB_TRX_ID=150)
    ↑ DB_ROLL_PTR
更旧版本 (DB_TRX_ID=100)
```

**ReadView 可见性判断**。事务做快照读时生成一个 ReadView，记录「当前有哪些事务还没提交」。顺着版本链往上找，跳过看不见的版本，找到第一个对自己可见的版本就返回。

关键区别在这里：

| 隔离级别 | ReadView 生成时机 | 效果 |
|---|---|---|
| READ COMMITTED | 每次快照读都新建 | 每次都能看到最新已提交的数据 |
| REPEATABLE READ | 事务首次快照读时建，之后复用 | 事务内多次读取结果始终一致 |

这就是为什么 RC 下会出现不可重复读、RR 下不会。

## 快照读 vs 当前读

这是全文最容易混淆、也最容易出 bug 的地方。

**快照读**：普通 SELECT，走 MVCC，不加锁，读的是历史版本。

```sql
SELECT * FROM products WHERE sku_code = 'A001';   -- 快照读，无锁
```

**当前读**：读最新版本并加锁。

```sql
SELECT * FROM products WHERE sku_code = 'A001' FOR UPDATE;   -- 加排他锁
UPDATE products SET stock = stock - 1 WHERE sku_code = 'A001';  -- UPDATE 本身就是当前读
```

回到开头那个超卖案例：两次操作都是 `SELECT`（快照读）+ `UPDATE`（当前读）的组合。两个事务的 SELECT 都读到 100，UPDATE 又各自基于自己读到的值计算，于是互相覆盖。

**正确写法**有两种。第一种，把判断和扣减合并成一条原子 SQL：

```sql
UPDATE products SET stock = stock - 1
WHERE sku_code = 'A001' AND stock > 0;
-- 检查 affected_rows，为 0 说明库存不足
```

第二种，显式加排他锁，锁住读到的行直到事务结束：

```sql
START TRANSACTION;
SELECT stock FROM products WHERE sku_code = 'A001' FOR UPDATE;  -- 当前读，加 X 锁
-- 应用层判断库存，再 UPDATE
UPDATE products SET stock = stock - 1 WHERE sku_code = 'A001';
COMMIT;
```

第一种更推荐：一条 SQL 搞定，锁持有时间最短，并发度最高。

## InnoDB 的锁

**锁是加在索引上的**，这是理解所有锁规则的前提。InnoDB 是索引组织表，如果 SQL 没命中任何索引，它无法定位具体行，只能把所有记录都锁上——直接退化成表锁。一个无索引的 UPDATE 就能锁死整张表，这是线上最常见的性能事故之一。

按兼容性分两类：

**共享锁（S 锁）**：读锁，多个事务可同时持有，互相不阻塞。用 `SELECT ... LOCK IN SHARE MODE` 加。

**排他锁（X 锁）**：写锁，独占，与所有锁互斥。所有 INSERT/UPDATE/DELETE 自动加 X 锁，`SELECT ... FOR UPDATE` 手动加。

X 锁**持续到事务提交或回滚才释放**，不是 SQL 执行完就释放。

### 间隙锁与临键锁

RR 隔离级别独有的机制，也是防幻读的关键，同时是线上隐蔽死锁的头号元凶。

**记录锁（Record Lock）**：锁住索引上的一条具体记录。

**间隙锁（Gap Lock）**：锁住两条索引记录之间的空隙，防止别的事务往里插数据。

**临键锁（Next-Key Lock）** = 记录锁 + 间隙锁，锁住一个左开右闭的区间，是 RR 下的默认加锁单位。

三条核心加锁规则（假设主键有记录 1、2、3）：

| 场景 | 加锁行为 |
|---|---|
| 等值查询命中唯一索引，记录存在 | 退化为记录锁，不加间隙锁 |
| 等值查询命中唯一索引，记录不存在 | 加间隙锁，锁住该值所在的间隙 |
| 等值查询命中普通二级索引 | 加完整临键锁，不退化 |

第一条是优化：唯一索引的等值查询能唯一确定一行，不存在幻读风险，所以 InnoDB 主动缩小锁范围提升并发。

间隙锁之间互相兼容——多个事务可以同时持有同一间隙的间隙锁。但间隙锁与插入意向锁互斥，会阻塞插入。这正是死锁的常见来源。

**RC 级别没有间隙锁**，锁范围更小、并发更高、死锁更少，代价是可能出现幻读。互联网业务很多主动选 RC，就是图这个。

## 死锁：产生与排查

死锁的四个必要条件：互斥、请求与保持、不可剥夺、循环等待。经典的循环等待场景：

```sql
-- 事务 A
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 1;  -- 锁住 id=1
UPDATE account SET balance = balance + 100 WHERE id = 2;  -- 等 B 释放 id=2

-- 事务 B（同时）
BEGIN;
UPDATE account SET balance = balance - 200 WHERE id = 2;  -- 锁住 id=2
UPDATE account SET balance = balance + 200 WHERE id = 1;  -- 等 A 释放 id=1
-- 死锁！
```

InnoDB 会主动检测死锁（维护等待图），发现环就回滚 undo log 量最小的那个事务，应用层会收到：

```
ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction
```

排查手段：

```sql
SHOW ENGINE INNODB STATUS\G   -- 看 LATEST DETECTED DEADLOCK 段
```

MySQL 8.0 推荐查 `performance_schema`，能直接看到谁在等谁：

```sql
SELECT
  r.trx_id    AS waiting_id,
  b.trx_id    AS blocking_id,
  r.trx_query AS waiting_query,
  b.trx_query AS blocking_query
FROM performance_schema.data_lock_waits w
JOIN information_schema.INNODB_TRX r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
JOIN information_schema.INNODB_TRX b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID;
```

**四个预防策略**：

1. **固定访问顺序**——所有事务都按 id 升序访问资源，从根上消灭循环等待
2. **缩短事务**——事务越短，持锁时间越短。绝对不要在事务里调外部 API（比如大模型接口，一次几秒，锁就白占几秒）
3. **用对隔离级别**——不需要防幻读就用 RC，少一层间隙锁少一堆死锁
4. **建好索引**——避免无索引更新退化成表锁

最后一条在大模型应用里特别容易踩：**在数据库事务里调用 LLM API**。一个事务持锁几秒钟等模型返回，并发一上来就是大面积锁等待甚至死锁。正确做法是事务里只做数据库操作，AI 调用挪到事务外。

## 大模型应用中的落地

**对话记录写入**。多轮对话要保证「用户消息 + 助手回复」要么都写入要么都不写入，否则上下文就残缺了。这里必须用事务：

```python
conn.begin()
try:
    cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (%s,%s,%s)",
                   (session_id, "user", question))
    cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (%s,%s,%s)",
                   (session_id, "assistant", answer))
    conn.commit()
except Exception:
    conn.rollback()
    raise
```

但注意：**LLM 调用必须放在事务外**。先调模型拿到 answer，再开事务写两条记录，事务窗口只有几毫秒。

**配额扣减**。按调用次数计费的功能，配额扣减和超卖是同一个问题，用原子 UPDATE 而不是「先查后改」：

```sql
UPDATE user_quota SET remaining = remaining - 1
WHERE user_id = %s AND remaining > 0;
```

**文档入库的幂等性**。RAG 知识库重复导入同一文档会产生重复切片。用唯一索引让数据库来保证幂等，比应用层判断可靠：

```sql
ALTER TABLE documents ADD UNIQUE KEY uk_kb_hash (kb_id, content_hash);
-- 配合 INSERT ... ON DUPLICATE KEY UPDATE 或 INSERT IGNORE
INSERT IGNORE INTO documents (kb_id, content_hash, content) VALUES (%s, %s, %s);
```

## 小结

1. **事务不等于锁**。普通 SELECT 是快照读不加锁，涉及「读后写」的逻辑必须用 `FOR UPDATE` 或原子 UPDATE
2. **MVCC 靠 undo log 版本链 + ReadView 实现读不加锁**。RC 每次读建新 ReadView，RR 事务内复用同一个
3. **锁加在索引上**。没命中索引的 UPDATE 会锁全表
4. **间隙锁是 RR 防幻读的关键，也是死锁的主要来源**。不需要防幻读就用 RC
5. **死锁预防**：固定访问顺序、缩短事务、避免在事务里调外部服务
