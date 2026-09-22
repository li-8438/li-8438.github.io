---
title: 用 PyMySQL 操作 MySQL
slug: pymysql
summary: 在 Python 里连接 MySQL，走通查询、增删改、事务提交回滚，并用参数化查询堵住 SQL 注入这个安全漏洞。
tags: [Python, MySQL, PyMySQL]
section: 学习笔记
topic: 数据与存储
subtopic: MySQL
published: true
---

上一篇文章的 SQL 是在客户端里手敲的。真正做项目时，SQL 要由 Python 代码来执行——查到的数据交给程序处理，程序的数据写回数据库。`PyMySQL` 就是 Python 连接 MySQL 的标准库之一。

## 连接数据库的标准步骤

一次完整操作的骨架是「导包 → 连接 → 游标 → 执行 → 关闭」：

```python
import pymysql

# 1. 连接数据库
conn = pymysql.connect(
    host="127.0.0.1",
    port=3306,
    user="root",
    password="123456",
    database="my_db",
    charset="utf8mb4",
)

# 2. 创建游标（cursor 是执行 SQL 的「手」）
cursor = conn.cursor()

# 3. 通过游标执行 SQL
cursor.execute("select * from user")

# 4. 关闭游标和连接
cursor.close()
conn.close()
```

关键角色是**游标**：连接负责「连上数据库」，游标负责「执行语句、拿结果」。

## 查询数据

```python
import pymysql

conn = pymysql.connect(host="127.0.0.1", user="root", password="123456", database="my_db")
cursor = conn.cursor()

cursor.execute("select id, name, age from user")

one = cursor.fetchone()      # 取一行
all_rows = cursor.fetchall() # 取全部行，返回元组列表

for row in all_rows:
    print(row)

cursor.close()
conn.close()
```

`fetchone` 取一条，`fetchall` 取全部。查询是只读操作，不需要提交。

## 增删改与事务

增删改会改变数据，必须调用 `commit()` 提交才真正生效；出问题可以用 `rollback()` 回滚撤销：

```python
import pymysql

conn = pymysql.connect(host="127.0.0.1", user="root", password="123456", database="my_db")
cursor = conn.cursor()

try:
    cursor.execute("insert into user (name, age) values ('user_a', 18)")
    cursor.execute("update user set age = 19 where name = 'user_a'")
    conn.commit()          # 提交，让改动生效
    print("操作成功")
except Exception as e:
    conn.rollback()        # 回滚，撤销本次所有改动
    print("操作失败，已回滚：", e)
finally:
    cursor.close()
    conn.close()
```

为什么需要 `commit`？因为 MySQL 默认开启了事务——多条改动先「暂存」，`commit` 才一次性生效。`rollback` 则是「反悔键」，保证要么全成功、要么全撤销。

## 防止 SQL 注入

直接把用户输入拼进 SQL，是致命的漏洞。看这个登录验证：

```python
# 危险写法：用户输入 ' or '1'='1 就能绕过密码
account = input("账号：")
password = input("密码：")
sql = f"select * from user where account='{account}' and password='{password}'"
cursor.execute(sql)
```

如果用户输入 `' or '1'='1`，拼出来的 SQL 条件恒真，直接登录成功。正确做法是**参数化查询**——用占位符 `%s`，把参数单独传进去：

```python
# 安全写法：参数化查询，值由驱动安全转义
account = input("账号：")
password = input("密码：")
sql = "select * from user where account=%s and password=%s"
cursor.execute(sql, (account, password))   # 参数作为元组传入

result = cursor.fetchone()
if result:
    print("登录成功")
else:
    print("账号或密码错误")
```

参数化查询让数据库驱动负责转义，用户输入永远被当作「值」而不是「SQL 代码」，从根本上堵住了注入。

## 大模型应用中的落地

**大模型调用必须放在事务外**。这是最容易踩的坑——典型错误写法：

```python
# ❌ 错误：事务里调 LLM，锁会被持有好几秒
conn.begin()
cursor.execute("insert into messages (session_id, role, content) values (%s,%s,%s)",
               (session_id, "user", question))
answer = call_llm(question)      # 一次调用可能要 3~10 秒！
cursor.execute("insert into messages (session_id, role, content) values (%s,%s,%s)",
               (session_id, "assistant", answer))
conn.commit()
```

事务里调外部 API，锁会被白白占用几秒钟。并发一上来就是大面积锁等待，甚至死锁。正确做法是先拿结果，再开事务：

```python
# ✅ 正确：先调模型，事务窗口只有几毫秒
answer = call_llm(question)

conn.begin()
try:
    cursor.executemany(
        "insert into messages (session_id, role, content) values (%s,%s,%s)",
        [(session_id, "user", question), (session_id, "assistant", answer)],
    )
    conn.commit()
except Exception:
    conn.rollback()
    raise
```

这样事务窗口只有几毫秒，而且两条消息要么都写入、要么都不写入，上下文不会残缺。

**批量写入文档切片**。RAG 知识库导入时，切片后往往有几万条，逐条 INSERT 会慢到怀疑人生。用 `executemany` 分批提交，实测能提速 20 倍。完整写法见 [Python 数据库工程实践](article.html?slug=python-db-connection-pool)。

## 小结

PyMySQL 的操作就四步：**连接、建游标、执行、提交/回滚**。三个必须牢记的点：

1. 增删改后要 `commit`
2. 所有拼接用户输入的 SQL 都要改成参数化查询
3. 事务里只放数据库操作，别在里面调大模型 API

这篇的写法是「每次建连接」，适合脚本和练习。放到 Web 服务里必须换连接池，见 [Python 数据库工程实践：连接池、ORM 与批量写入](article.html?slug=python-db-connection-pool)。
