---
title: MySQL 索引与慢查询优化：从 EXPLAIN 到索引设计
slug: mysql-index-optimization
summary: 建了索引却还是全表扫描？这篇讲透 EXPLAIN 的五个关键字段、联合索引最左前缀、覆盖索引消灭回表、九种索引失效写法，以及慢查询日志的完整排查链路。
tags: [MySQL, 索引, EXPLAIN, 性能优化]
section: 学习笔记
topic: 数据与存储
subtopic: MySQL
published: true
---

线上接口变慢，八成是慢 SQL 闹的。而慢 SQL 的头号原因不是「没建索引」，而是**索引建了却没生效**——优化器算了一笔账，觉得走索引比全表扫描还贵，于是直接放弃了你的索引。

这篇讲三件事：怎么用 EXPLAIN 看清优化器在想什么；怎么设计一个真正匹配查询的索引；哪些写法会让索引瞬间失效。

## 索引到底是什么

InnoDB 的索引是 **B+ 树**。可以理解成一本书的目录：没有目录就得从头翻到尾（全表扫描），有目录就能按拼音直接跳到某一页。

这里有个关键认知，后面所有内容都建立在它之上：**索引里存的是字段的原始值，并且按顺序排好**。一旦你对索引列做了运算、套了函数，它就不再是「有序的原始值」，优化器没法在树上定位，只能全表扫一遍再逐行计算。

先看一张贯穿全文的订单表：

```sql
CREATE TABLE orders (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_no    VARCHAR(32) NOT NULL COMMENT '订单号',
  user_id     BIGINT NOT NULL COMMENT '用户ID',
  status      TINYINT NOT NULL DEFAULT 0 COMMENT '0待支付 1已支付 2已取消',
  amount      DECIMAL(10,2) NOT NULL COMMENT '订单金额',
  create_time DATETIME NOT NULL COMMENT '创建时间',
  remark      VARCHAR(200) DEFAULT NULL COMMENT '备注',
  KEY idx_user_id (user_id),
  KEY idx_create_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## EXPLAIN：看清优化器在想什么

在 SQL 前面加一个 `EXPLAIN`，MySQL 就会把执行计划吐出来，告诉你它打算怎么查。

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 8888;
```

输出有十几个字段，但真正需要盯的只有五个：

| 字段 | 含义 | 判断标准 |
|---|---|---|
| type | 访问方式 | 优劣顺序：const > eq_ref > ref > range > index > ALL |
| key | 实际用的索引 | 为 NULL 就是没走索引 |
| key_len | 用到的索引字节数 | 越大说明联合索引里用上的列越多 |
| rows | 预估扫描行数 | 越小越好 |
| Extra | 额外信息 | 见下文三种关键值 |

**type 是核心**。看到 `ALL` 就是全表扫描，必须优化；目标是至少到 `range`，核心业务尽量到 `ref`。

**Extra 里藏着三个关键信号**：

`Using index` 是好事——覆盖索引，要查的列都在索引里，不用回表。`Using filesort` 是坏事——MySQL 没法用索引完成排序，只能把数据读出来在内存里排一遍。`Using temporary` 更糟——建了临时表，常见于 GROUP BY 用了非索引列。

一个典型的不良执行计划长这样：type 是 ALL，key 是 NULL，rows 接近全表行数，Extra 里 `Using where; Using filesort`。这个组合意味着：全表扫一遍，把行捞出来再过滤，过滤完还要排序。

## 联合索引与最左前缀

单列索引只能解决一个条件的查询。真实业务往往是「按用户查、按时间排序」，这就需要联合索引。

```sql
ALTER TABLE orders ADD INDEX idx_user_time (user_id, create_time);
```

这个索引在磁盘上是**先按 user_id 排，user_id 相同的再按 create_time 排**。理解这点，下面的规则就都是自然推论了。

**最左前缀原则**：联合索引像一列火车，必须从车头开始连续匹配。

对于 `(user_id, create_time)`：

- `WHERE user_id = ?` 能用上（匹配了第一列）
- `WHERE user_id = ? AND create_time >= ?` 能用上（两列都用）
- `WHERE create_time >= ?` 用不上（跳过了车头）

有个常见误区：以为把列建在一起就等于建了多个索引。实际上 `(user_id, create_time)` 对单独查 `create_time` 毫无帮助，得单独再建一个。

**列顺序怎么排**：等值条件放前面，范围条件放后面，排序字段跟在最后。因为范围查询之后的有序列就失去有序性了——`user_id = 1 AND create_time > ?` 能用两列，但 `create_time > ? AND amount = ?` 里 amount 就白搭了。

实测一下联合索引的威力。给 `SELECT * FROM orders WHERE user_id = 8888 ORDER BY create_time DESC LIMIT 20` 建索引前后对比：

| 索引 | type | key | rows | Extra |
|---|---|---|---|---|
| 无 | ALL | NULL | 496483 | Using where; Using filesort |
| 只有 idx_user_id | ref | idx_user_id | 8 | Using filesort |
| idx_user_time | ref | idx_user_time | 8 | Backward index scan |

第三行的 `Backward index scan` 是 MySQL 8.0 的降序扫描优化：索引默认升序，但 `ORDER BY ... DESC` 时它可以从索引末尾倒着扫，仍然利用索引的有序性，不用额外排序。注意多列混合方向（一个 ASC 一个 DESC）时这个优化会失效。

## 覆盖索引：把回表也省掉

二级索引的叶子节点存的是主键值。所以走二级索引查 `SELECT *` 时，流程是：在索引树找到主键 → 拿着主键回聚簇索引取整行数据。这个「回表」是随机 IO，行数一多就很贵。

如果把查询需要的列都放进索引，就不用回表了：

```sql
ALTER TABLE orders ADD INDEX idx_user_time_amount (user_id, create_time, amount);

EXPLAIN SELECT user_id, SUM(amount)
FROM orders
WHERE user_id = 8888 AND create_time >= '2025-01-01'
GROUP BY user_id;
-- Extra: Using where; Using index   ← Using index 就是覆盖索引的标志
```

但覆盖索引不是白嫖的。**MySQL 没有 INCLUDE 列的概念**，二级索引里每一列都是索引结构的一部分，会让索引变大、写入变慢。所以只给真正高频的查询建，别往里塞大文本字段。

## 九种索引失效的写法

原理讲完，看实际踩坑。下面每种都是「索引明明在，却走全表扫描」。

**1. 对索引列用函数**

```sql
-- 失效：DATE() 改变了原始值，B+ 树没法定位
SELECT * FROM orders WHERE DATE(create_time) = '2025-01-01';

-- 优化：把函数挪到右边，改成范围查询
SELECT * FROM orders WHERE create_time >= '2025-01-01' AND create_time < '2025-01-02';
```

**2. 对索引列做算术运算**

```sql
-- 失效
SELECT * FROM orders WHERE amount + 100 > 500;
-- 优化
SELECT * FROM orders WHERE amount > 400;
```

**3. 字符串不加引号（隐式类型转换）**

`order_no` 是 VARCHAR，但你写成了数字，MySQL 会对索引列做 CAST，等价于套函数，索引直接废掉：

```sql
-- 失效
SELECT * FROM orders WHERE order_no = 20250101001;
-- 优化：类型保持一致
SELECT * FROM orders WHERE order_no = '20250101001';
```

注意反过来是安全的：索引列是 int，你传字符串 `'10086'`，MySQL 会把字符串转成数字，索引仍然有效。但这种写法不值得依赖。

**4. 前缀模糊查询**

```sql
-- 失效：% 开头，无法确定 B+ 树的搜索起点
SELECT * FROM orders WHERE remark LIKE '%退货%';
-- 能走索引：后缀模糊
SELECT * FROM orders WHERE remark LIKE '退货%';
```

真要做全文模糊搜索，别为难 MySQL，上 Elasticsearch。

**5. OR 连接了无索引的列**

```sql
-- 失效：status 没索引，优化器觉得全表扫更划算
SELECT * FROM orders WHERE user_id = 1 OR status = 2;
-- 优化：用 UNION ALL 拆分，无需去重用 UNION ALL 效率更高
SELECT * FROM orders WHERE user_id = 1
UNION ALL
SELECT * FROM orders WHERE status = 2;
```

**6. 违反最左前缀**——前面说过，跳过联合索引的第一列。

**7. 范围条件右边的列失效**——`WHERE a = 1 AND b > 2 AND c = 3`，如果索引是 `(a, b, c)`，那 c 用不上。

**8. 数据分布导致优化器放弃索引**——查 `status = 1` 命中了 90% 的行，优化器判断回表成本比全表扫描还高，会主动放弃索引。这不是 bug，是优化器在替你省钱。

**9. 统计信息不准**——表刚做完大批量导入，统计信息还是旧的，rows 估算离谱，优化器就选错索引。执行 `ANALYZE TABLE orders;` 重新采样即可。

顺带澄清一个流传很广的误解：**`IS NULL` 会走索引**，`IS NOT NULL` 才可能失效（取决于 NULL 值占比）。所以「NULL 导致索引失效」这个说法是错的。

## 慢查询日志：怎么把慢 SQL 捞出来

优化的前提是定位。生产环境这样配：

```sql
-- 临时开启，重启失效，适合排查现网问题
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;              -- 阈值 1 秒，核心场景可设 0.5
SET GLOBAL min_examined_row_limit = 1000;    -- 只记扫描超 1000 行的，过滤小表噪声
```

永久配置写进配置文件：

```ini
[mysqld]
slow_query_log = ON
slow_query_log_file = /var/lib/mysql/mysql-slow.log
long_query_time = 1
log_output = FILE
```

有个坑要避开：`log_queries_not_using_indexes` 不要长期开着，它会把所有没走索引的 SQL 全记下来（哪怕只跑了 3 毫秒），很快就能把磁盘写满。只在全量索引排查时临时开。

日志拿到手，用 MySQL 自带的工具聚合，别肉眼看：

```bash
# 耗时最长的 10 条
mysqldumpslow -s t -t 10 /var/lib/mysql/mysql-slow.log
# 执行次数最多的 5 条
mysqldumpslow -s c -t 5 /var/lib/mysql/mysql-slow.log
```

除了慢查询日志，MySQL 8.0 的 `sys` 库也很实用，不用开日志就能看：

```sql
-- 找出从未被使用过的索引（可以放心删掉，减少写入负担）
SELECT * FROM sys.schema_unused_indexes;
-- 全量 SQL 的耗时、扫描行数聚合分析
SELECT * FROM sys.statement_analysis ORDER BY avg_latency DESC LIMIT 10;
```

完整的排查链路是：**慢查询日志定位到具体 SQL → EXPLAIN 看执行计划 → 按 type / key / Extra 三字段判断瓶颈 → 改 SQL 或改索引 → 再 EXPLAIN 对比验证**。

## 大模型应用中的落地

做 RAG 或对话系统时，MySQL 通常存业务元数据和对话记录，几张表很容易长到百万行。几个典型场景：

**对话历史分页查询**。用户翻聊天记录是高频操作，典型查询是「按会话 ID 取最近 20 条」：

```sql
-- messages 表：(session_id, created_at) 联合索引正好匹配
CREATE INDEX idx_session_time ON messages (session_id, created_at);

SELECT role, content FROM messages
WHERE session_id = ? ORDER BY created_at DESC LIMIT 20;
```

注意这里千万别用 `OFFSET` 深翻页——`LIMIT 100000, 20` 会让 MySQL 先扫 10 万行再丢弃。改用**游标分页**：记住上一页最后一条的 `created_at` 和 `id`，下一页用 `WHERE created_at < ? LIMIT 20`。

**文档切片元数据表**。RAG 里一张 `documents` 表存切片，查询模式是「按知识库 ID + 状态过滤」：

```sql
CREATE INDEX idx_kb_status ON documents (kb_id, status, updated_at);
```

向量本身不要存 MySQL 的普通字段里——要用向量类型或专门的向量库，见向量数据库那篇。

**批量写入要合并**。文档入库时逐条 INSERT，一万条就是一万次网络往返加事务提交。改成批量：

```sql
INSERT INTO documents (kb_id, content, embedding_id) VALUES
  (?, ?, ?), (?, ?, ?), (?, ?, ?);
```

PyMySQL 里对应 `executemany()`，通常能把耗时压缩一个数量级。

## 小结

索引优化不是「建得越多越好」——索引会拖慢写入、占用空间，还可能让优化器选错。核心心法是：

1. **先看执行计划再动手**。EXPLAIN 的 type、key、Extra 三个字段就能定位八成问题
2. **索引要匹配查询形状**。等值在前、范围在后、排序跟最后
3. **覆盖索引能消灭回表**，但索引列不是免费的，别贪多
4. **让索引列「裸奔」**。函数、运算、类型转换都会让索引失效
5. **定期清理无用索引**，`sys.schema_unused_indexes` 一查就知道

下一篇讲事务与锁——为什么 `SELECT` 查到的库存是 100，两个事务都扣减后库存却变成了 99 而不是 98。
