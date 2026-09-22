---
title: MySQL 入门：DDL、DML 与 DQL
slug: mysql-basics
summary: 从建库建表（DDL）、增删改（DML）到查询（DQL），把 MySQL 最常用的三类 SQL 一次理清，涵盖数据类型选型、NULL 处理、多表连接、子查询和正则。
tags: [MySQL, SQL, 数据库]
section: 学习笔记
topic: 数据与存储
subtopic: MySQL
published: true
---

MySQL 是最流行的关系型数据库。SQL 语句按作用分成三大类：**DDL** 定义结构（建库建表）、**DML** 操作数据（增删改）、**DQL** 查询数据（最常用）。搞清这三类，日常开发就够用了。

## DDL：定义数据库和表

DDL 管的是「结构」，即数据库和表本身的创建与删除：

```sql
create database my_db;          -- 创建数据库
use my_db;                      -- 使用数据库
show databases;                 -- 查看所有数据库
drop database my_db;            -- 删除数据库

create table my_db.user (
    id int primary key,              -- 主键：唯一 + 非空
    name varchar(20) not null,       -- 非空
    email varchar(50) unique,        -- 唯一
    age int default 18,              -- 默认值
    score decimal(5, 2)              -- 总长 5，小数 2 位
);

show tables;                    -- 查看当前库有哪些表
desc my_db.user;                -- 查看表结构
drop table my_db.user;          -- 删除表
```

### 数据类型怎么选

建表要给每列选类型，选对了省空间、查询快；选错了要么浪费、要么溢出。常用类型速查：

| 类型 | 存储 | 说明 | 适用场景 |
|---|---|---|---|
| tinyint | 1 字节 | -128 ~ 127 | 状态、性别、布尔 |
| int | 4 字节 | ±21 亿 | 常规整数、ID |
| bigint | 8 字节 | 巨大整数 | 大数据量主键 |
| decimal(m,n) | 变长 | 精确小数，总 m 位、小数 n 位 | **金额** |
| char(n) | 定长 | 固定 n 字符，不足补空格 | 身份证、手机号 |
| varchar(n) | 变长 | 最多 n 字符，按实际长度存 | 姓名、标题 |
| text | 变长 | 最长 65535 字符 | 文章、长文本 |
| date / datetime / timestamp | 3/8/4 字节 | 日期 / 日期时间 / 时间戳 | 各种时间 |

三个最容易踩的选型坑：

**金额永远用 decimal，别用 float**。float/double 是近似存储，`0.1 + 0.2` 在浮点里不等于 `0.3`，存钱会算错。金额一律 `decimal(10,2)`。

**char 和 varchar 的区别**：char 定长，`'ab'` 存进 char(5) 也占满 5 个字符空间（快但费空间）；varchar 变长，存多长占多长（省空间）。长度固定的用 char，长度变化的用 varchar。

**datetime 和 timestamp 的区别**：timestamp 有时区、范围只到 2038 年、支持 `on update current_timestamp` 自动更新；datetime 范围大到 9999 年但无时区。建表时「创建时间 + 更新时间」通常这么写：

```sql
create table t (
    created_at datetime default current_timestamp,
    updated_at datetime default current_timestamp on update current_timestamp
);
```

### ALTER：改表结构

表建好后要改结构，用 `alter table`：

```sql
alter table user add column phone varchar(20);    -- 加列
alter table user drop column phone;               -- 删列
alter table user modify age tinyint;              -- 只改类型
alter table user change age age int;              -- 改名 + 改类型（列名要写两遍）
alter table user rename to user_bak;              -- 改表名
```

记忆点：`modify` 只改类型，`change` 既改名又改类型（所以 `change` 后面列名出现两次）。改表结构在数据量大时会锁表，生产环境要选低峰期操作。

## DML：增删改数据

DML 管的是「数据行」：

```sql
-- 插入（可一次插多行）
insert into my_db.user (id, name, age) values (1, 'user_a', 18), (2, 'user_b', 20);

-- 修改（不写 where 会改全表，务必小心）
update my_db.user set age = 19 where id = 1;

-- 删除
delete from my_db.user where id = 2;   -- 可回滚，逐行删
truncate my_db.user;                   -- 清空整表，不可回滚
```

## DQL：查询数据

DQL 是日常写得最多、也最丰富的一类。

### 基础查询

```sql
select * from user;                 -- 查所有列
select name, age from user;         -- 查指定列
select * from user where age > 18;  -- 条件查询
```

`where` 支持比较（`>`、`<`、`=`）、逻辑（`and`、`or`）、区间（`between`）、模糊（`like`）、非空（`is null`）等条件。

### 排序、聚合、分组、分页

```sql
select * from user order by age desc;          -- 按年龄降序（asc 升序）

select count(*), max(age), min(age), sum(age), avg(age) from user;  -- 聚合函数

select dept, count(*) from user group by dept; -- 分组：按部门统计人数
select dept, count(*) from user group by dept having count(*) > 5;  -- 分组后过滤

select * from user limit 0, 10;               -- 分页：从第 0 条起取 10 条
```

记忆点：`group by` 按什么分就按什么查，分组后必然配合聚合；`having` 用在分组之后，`where` 用在分组之前。

### 多表连接

把分散在多张表里的数据关联起来查，用 `join ... on`：

```sql
-- 内连接：只返回两表都满足条件的行
select * from orders o join users u on o.user_id = u.id;

-- 左外连接：以左表为主，右表只取满足条件的
select * from orders o left join users u on o.user_id = u.id;

-- 右外连接：以右表为主
select * from orders o right join users u on o.user_id = u.id;
```

## NULL 值处理

NULL 表示「缺失、未知」，它不是 0，也不是空字符串。三个最容易出错的地方：

**1. 不能用 `=` 和 `!=` 判断 NULL**

```sql
-- ❌ 错误：永远查不到结果，因为 null = null 的结果是 null（不是 true）
select * from user where age = null;
-- ✅ 正确：用 is null / is not null
select * from user where age is null;
select * from user where age is not null;
```

`<=>` 是特殊运算符，两个值相等**或都为 null** 时返回 true：

```sql
select * from user where age <=> null;   -- 等价于 age is null
```

**2. NULL 参与运算，结果还是 NULL**

```sql
select 1 + null;      -- 结果是 null，不是 1
```

所以某列有 null 会「污染」整行运算结果，要用函数兜底。

**3. 聚合函数会忽略 NULL**

```sql
select count(*) from user;     -- 数所有行
select count(age) from user;   -- 只数 age 非 null 的行，结果会偏小
```

处理 NULL 的两个核心函数：

```sql
select ifnull(age, 0) from user;                   -- age 为 null 时返回 0（两参）
select coalesce(phone, email, '无') from user;     -- 返回第一个非 null 的值（多参）
select nullif(a, b);                                -- a = b 时返回 null，否则返回 a
```

- `ifnull(x, y)`：x 是 null 就返回 y，只能两参
- `coalesce(a, b, c)`：返回第一个不是 null 的参数，是 `ifnull` 的多参升级版
- `nullif(a, b)`：a 和 b 相等返回 null，常用来避免除零

## UNION 与正则 REGEXP

**UNION 合并两个查询结果**，要求两个查询的列数、类型一致：

```sql
select name from table_a
union          -- 合并并去重
select name from table_b;

select name from table_a
union all      -- 合并不去重，更快
select name from table_b;
```

`union` 默认去重（内部要排序去重，慢一点），`union all` 不去重（更快）。确定没有重复时优先用 `union all`。

**REGEXP 正则匹配**。`like` 只能做简单通配，`regexp` 支持真正的正则：

```sql
select * from user where name regexp '^a';      -- 以 a 开头
select * from user where name regexp 'chen$';   -- 以 chen 结尾
select * from user where name regexp '^[0-9]';  -- 以数字开头
```

`like` 用 `%`（任意多字符）和 `_`（单个字符）做通配，`regexp` 才是正则表达式。简单匹配用 like，复杂规则才上 regexp。

## 自连接与子查询

### 自连接

一张表自己关联自己，典型场景是「省市区」存在同一张表里：

```sql
select *
from areas as sheng
join areas as shi on sheng.id = shi.pid
join areas as qu  on shi.id = qu.pid;
```

### 子查询

把一次查询的结果，当作另一次查询的条件。可以出现在 `from` 后、`where` 后、`select` 后：

```sql
-- 查询价格高于平均价的商品（where 后）
select * from product where price > (select avg(price) from product);

-- 先过滤再套一层查询（from 后）
select * from (select * from product where price > 500) as t where t.category = '电子产品';

-- 查询价格与平均价的差值（select 后）
select name, price - (select avg(price) from product) from product;
```

## 大模型应用中的落地

做 RAG 或对话系统时，MySQL 主要存两样东西：业务元数据和对话记录。几个典型表结构：

**对话记录表**。多轮对话的核心，按会话分组、按时间排序：

```sql
create table messages (
  id          bigint primary key auto_increment,
  session_id  varchar(64) not null comment '会话ID',
  role        varchar(16) not null comment 'user / assistant / system',
  content     text        not null comment '消息内容',
  token_count int         default 0 comment 'token 数，用于控制上下文长度',
  created_at  datetime    not null default current_timestamp,
  key idx_session_time (session_id, created_at)
) engine=innodb default charset=utf8mb4;
```

那个联合索引很关键——「取某会话最近 20 条消息」是最频繁的查询，`(session_id, created_at)` 正好匹配。索引的原理见 [MySQL 索引与慢查询优化](article.html?slug=mysql-index-optimization)。

**文档切片表**。RAG 知识库里，一篇文档会被切成多个 chunk：

```sql
create table documents (
  id           bigint       not null primary key auto_increment,
  kb_id        bigint       not null comment '知识库ID',
  doc_name     varchar(255) not null,
  chunk_index  int          not null comment '第几个切片',
  content      text         not null,
  content_hash char(32)     not null comment '内容MD5，用于去重',
  created_at   datetime     not null default current_timestamp,
  unique key uk_kb_hash (kb_id, content_hash)
) engine=innodb default charset=utf8mb4;
```

唯一索引 `uk_kb_hash` 让数据库来保证幂等——重复导入同一文档不会产出重复切片，比在应用层判断可靠得多。

注意向量本身不要存在普通字段里。向量是高维浮点数组，需要专门的向量类型或向量数据库，见 [向量数据库入门](article.html?slug=vector-database-rag)。MySQL 这里只存文本和元数据，向量 id 作为外键关联过去即可。

## 小结

三类 SQL 各司其职：**DDL 建结构、DML 改数据、DQL 查数据**。其中 DQL 是重点——`where` 过滤、`group by` 分组、`join` 连表、子查询套娃，层层叠加就能表达任意查询需求。

语法只是起点。真正上线会遇到两个新问题：查询变慢了怎么办、并发下数据错了怎么办。接着看 [MySQL 索引与慢查询优化](article.html?slug=mysql-index-optimization) 和 [MySQL 事务与锁](article.html?slug=mysql-transaction-lock)。
