---
title: Python 数据库工程实践：连接池、ORM 与批量写入
slug: python-db-connection-pool
summary: 每次查询都新建连接，是把数据库往死里逼。这篇讲清连接池怎么配、SQLAlchemy ORM 怎么用、批量写入怎么提速，以及异步场景下的正确姿势。
tags: [Python, MySQL, 连接池, SQLAlchemy, ORM]
section: 学习笔记
topic: 数据与存储
subtopic: MySQL
published: true
---

初学 Python 操作数据库时，代码通常长这样：函数开头 `connect()`，结尾 `close()`。逻辑没错，但一旦放到 Web 服务里，这套写法会在并发上来时把数据库拖垮。

这篇讲三件事：为什么要用连接池、怎么用 ORM 优雅地写 SQL、以及批量操作能带来多大的提速。

## 短连接有什么问题

先看一个典型的「教科书式」写法：

```python
import pymysql

def get_user(user_id: int):
    conn = pymysql.connect(host="localhost", user="root", password="123456", database="app")
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()          # 每次查询都彻底断开
    return row
```

问题在于**建立一次 MySQL 连接的成本很高**：TCP 三次握手、MySQL 认证握手、分配连接资源。粗略估计一次连接建立要几毫秒到几十毫秒，而一次简单查询本身可能只要零点几毫秒。

也就是说，**建连接的开销比执行 SQL 还大**。每秒 1000 个请求就意味着每秒 1000 次建连和断连，数据库大部分时间都在做认证而不是查数据。

更糟的是连接数失控。MySQL 的 `max_connections` 默认 151，超过就报 `Too many connections`。短连接模式下，连接创建快、销毁也快，但并发高峰时仍可能瞬间打满。

## 连接池：复用而不是重建

连接池的思路很朴素：**连接用完不关，放回池子里，下次直接拿来用**。

```
应用 ──┬─→ 从池里借连接 ──→ 执行 SQL ──→ 归还连接 ──┐
      └─────────────────────────────────────────────┘
                        ↑
                  连接池（维持 N 个活跃连接）
```

Python 里最通用的是 `DBUtils`：

```bash
pip install DBUtils pymysql
```

```python
from dbutils.pooled_db import PooledDB
import pymysql

pool = PooledDB(
    creator=pymysql,              # 用哪个驱动
    maxconnections=20,            # 池里最多维持多少连接
    mincached=5,                  # 启动时预建多少空闲连接
    maxcached=10,                 # 最多缓存多少空闲连接
    maxusage=None,                # 单个连接最多复用次数（None = 不限）
    blocking=True,                # 池满时是否阻塞等待（False 会直接报错）
    host="localhost",
    port=3306,
    user="root",
    password="123456",
    database="app",
    charset="utf8mb4",
    autocommit=False,
)
```

用的时候从池里借，用完归还：

```python
def get_user(user_id: int):
    conn = pool.connection()      # 借（不是新建）
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            return cursor.fetchone()
    finally:
        conn.close()              # 注意：这是「归还」给池，不是真关闭
```

这里有个容易误解的点：**`conn.close()` 在连接池语境下是「归还」，不是「断开」**。底层连接仍然活着，等着被下次复用。

配一个上下文管理器，用起来更安全：

```python
from contextlib import contextmanager

@contextmanager
def get_conn():
    """借出连接，自动处理提交、回滚和归还。"""
    conn = pool.connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()              # 归还

# 用法
with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("UPDATE users SET name = %s WHERE id = %s", ("user_a", 1))
```

**参数怎么配**：`maxconnections` 不是越大越好。MySQL 侧能支撑的并发查询数是有限的（和 CPU 核数相关），连接数设得太大，反而会因为上下文切换拖垮性能。经验值：**连接池大小 ≈ CPU 核数 × 2 + 磁盘数**，Web 应用通常 10~50 就够。如果应用有多个实例，还要再除以实例数。

## SQLAlchemy：连接池 + ORM 一步到位

如果项目已经用到 ORM，直接用 SQLAlchemy 自带的连接池更省事——它默认就启用了 `QueuePool`。

```bash
pip install sqlalchemy pymysql
```

```python
from sqlalchemy import create_engine

engine = create_engine(
    "mysql+pymysql://root:123456@localhost:3306/app?charset=utf8mb4",
    pool_size=10,          # 池里常驻的连接数
    max_overflow=20,       # 池满后最多还能临时新建多少（超出部分用完即弃）
    pool_recycle=3600,     # 连接存活超过 1 小时就重建，避开 MySQL 的 8 小时断连
    pool_pre_ping=True,    # 每次借出前先 ping 一下，确保连接还活着
    echo=False,            # 调试时设 True，会打印所有 SQL
)
```

两个参数特别关键：

**`pool_recycle`** 用来规避 MySQL 的 `wait_timeout`（默认 8 小时）。如果应用长时间空闲，MySQL 会单方面断开连接，而应用端不知道，下次取到这个「死连接」就会报错。设为比 `wait_timeout` 小的值（比如 3600），让 SQLAlchemy 主动回收。

**`pool_pre_ping`** 是双保险——每次借出连接前先发一个轻量 ping，失效就自动重连。开销极小，建议常开。

### 用 ORM 定义模型

```python
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    email: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)

Base.metadata.create_all(engine)     # 建表（已存在则跳过）
```

增删改查：

```python
with Session(engine) as session:
    # 新增
    session.add(User(name="user_a", email="user_a@example.com"))
    session.commit()

    # 查询
    user = session.query(User).filter_by(name="user_a").first()

    # 更新
    user.name = "user_a_2"
    session.commit()

    # 删除
    session.delete(user)
    session.commit()
```

**ORM 不是银弹**。它适合业务实体的 CRUD，但在复杂查询（多表聚合、窗口函数、批量操作）上写起来反而别扭。我的实践是：**业务对象用 ORM，复杂报表和分析用原生 SQL**。SQLAlchemy 两者都支持：

```python
from sqlalchemy import text

with Session(engine) as session:
    rows = session.execute(
        text("SELECT category, COUNT(*) AS cnt FROM documents GROUP BY category")
    ).fetchall()
```

## 批量写入：从 10 分钟到 10 秒

导入一批文档、批量插入日志——这类场景如果逐条 INSERT，会慢到怀疑人生。原因是每条 INSERT 都是一次完整的网络往返 + 事务提交。

用 `executemany` 合并成多次值的一条 SQL：

```python
def batch_insert(rows: list[tuple], batch_size: int = 1000):
    """分批批量写入。rows 是 [(name, email), ...] 这样的元组列表。"""
    sql = "INSERT INTO users (name, email) VALUES (%s, %s)"
    with get_conn() as conn:
        with conn.cursor() as cur:
            for i in range(0, len(rows), batch_size):
                cur.executemany(sql, rows[i:i + batch_size])
                # 每批提交一次，避免大事务占锁太久
```

两个细节：

**为什么要分批**：一次性塞 10 万条会让单个 SQL 包过大，可能超过 `max_allowed_packet` 限制，而且大事务长时间持锁会影响其他查询。每批 1000~5000 条是常见选择。

**批量时也用事务**：如果不显式开启事务，每条 INSERT 都会自动提交一次（autocommit），批量写入的提速效果会被事务开销抵消。用 `get_conn()` 这类上下文管理器包住，让它整体提交。

实测对比（5 万条记录）：逐条插入约 60 秒，批量插入约 3 秒，差距 20 倍。

如果数据量特别大（百万级），MySQL 还有更快的 `LOAD DATA INFILE`，直接读取 CSV 文件入库，速度能再快一个数量级。

## 防 SQL 注入

老生常谈但必须强调。**永远不要拼接 SQL 字符串**：

```python
# ❌ 致命：用户输入直接拼进 SQL
user_input = "1' OR '1'='1"
cursor.execute(f"SELECT * FROM users WHERE id = '{user_input}'")
# 实际执行：SELECT * FROM users WHERE id = '1' OR '1'='1'
# 后果：整张表被拖走
```

正确做法是用**参数化查询**，让驱动负责转义：

```python
# ✅ 参数化：%s 是占位符，值由驱动安全处理
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

注意 `%s` 不是 Python 的字符串格式化，是 DB-API 的占位符——`execute` 的第二个参数才负责填值。写成 `cursor.execute("... %s" % user_id)` 就白搭了。

SQLAlchemy 的 `text()` 同样支持参数绑定：

```python
session.execute(
    text("SELECT * FROM users WHERE name = :name"),
    {"name": name},
)
```

**占位符不能用于表名、列名**。这类动态部分如果要从用户输入来，必须用白名单校验，不能直接拼。

## 异步场景

做大模型应用时经常用 FastAPI + asyncio。这里有个坑：**PyMySQL 是同步驱动，在 async 函数里调用会阻塞整个事件循环**。一个慢查询就能让所有并发请求一起卡住。

正确做法是用异步驱动 `asyncmy` 或 `aiomysql`：

```bash
pip install sqlalchemy[asyncio] asyncmy
```

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

engine = create_async_engine(
    "mysql+asyncmy://root:123456@localhost:3306/app",
    pool_size=10,
    pool_pre_ping=True,
)

async def get_user_async(user_id: int):
    async with AsyncSession(engine) as session:
        result = await session.execute(
            text("SELECT * FROM users WHERE id = :id"),
            {"id": user_id},
        )
        return result.fetchone()
```

关键点：`await` 是「暂停点」，等待数据库返回时事件循环可以去处理其他请求，这才是异步的价值所在。

## 大模型应用中的落地

**对话历史的持久化**。多轮对话要落库，同时用 Redis 做热缓存：

```python
def save_message(session_id: str, role: str, content: str):
    """写入 MySQL 持久化，同时更新 Redis 里的近期对话。"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO messages (session_id, role, content) VALUES (%s, %s, %s)",
                (session_id, role, content),
            )
    # Redis 里只保留最近 20 轮，供下次请求快速组装上下文
    append_message(session_id, role, content)
```

MySQL 存全量（可审计、可回溯），Redis 存近期（低延迟）。这是典型的冷热分离。

**文档入库的批量写入**。RAG 知识库导入时，切片后可能有几万条，务必批量：

```python
def import_documents(chunks: list[dict]):
    """批量导入文档切片，按内容哈希去重。"""
    sql = """
        INSERT IGNORE INTO documents (kb_id, content_hash, content, char_count)
        VALUES (%s, %s, %s, %s)
    """
    rows = [
        (c["kb_id"], c["hash"], c["content"], len(c["content"]))
        for c in chunks
    ]
    batch_insert(rows)
```

配合前面提到过的唯一索引 `uk_kb_hash`，重复导入自动跳过。

**连接池大小的坑**：大模型应用通常有多个 worker 进程（uvicorn `--workers 4`），每个 worker 都有自己的连接池。设置 `pool_size` 时要乘以 worker 数量，别超过 MySQL 的 `max_connections`。

## 小结

1. **建连接比执行 SQL 还贵**，生产环境必须用连接池
2. **`pool_pre_ping` 和 `pool_recycle` 必开**，规避 MySQL 8 小时断连问题
3. **连接池不是越大越好**，参考「CPU 核数 × 2」再按实例数分摊
4. **批量写入用 `executemany`**，配合事务提交，提速可达 20 倍
5. **永远用参数化查询**，拼接 SQL 字符串等于开门揖盗
6. **异步框架配异步驱动**，同步驱动会阻塞事件循环

相关阅读：[MySQL 索引与慢查询优化](article.html?slug=mysql-index-optimization)讲查询怎么变快，[MySQL 事务与锁](article.html?slug=mysql-transaction-lock)讲并发下怎么保证数据正确。
