---
title: FastAPI 高性能架构实践
slug: fastapi-production-architecture
summary: 很多团队把 FastAPI 用成了「更快的 Flask」，直到某天一次同步调用把整个 worker 冻住，连健康检查都超时。这篇不列 API 清单，而是按一次请求「进到出」的顺序讲四件事：分层切在哪、async def 与 def 怎么分工、三类资源生命周期各放在哪、以及没有可观测性为什么等于没法优化。最后附连接池与 worker 数的预算算法。
tags: [Python, FastAPI, Backend]
section: 学习笔记
topic: Python
subtopic: ""
date: 2026-09-21
published: true
---

FastAPI 的「高性能」是个容易被误读的词。

它快，一半来自 Starlette 把请求放在一条事件循环上跑，另一半取决于你有没有把阻塞关在门外。框架只提供「请求可以跑在事件循环上」的能力，并不保证这件事真的发生——一个同步的 `requests.get()` 就足以让整个 worker 停下来，连 `/healthz` 都跟着超时。

这篇不列 API 清单，而是按一次请求「从进到出」的顺序讲四件事：分层切在哪、`async def` 与 `def` 怎么分工、资源的三类生命周期各放在哪、以及为什么没有可观测性就等于没法做性能优化。

## 1. 分层的判据：这一层能不能被单独替换

分层最容易做成「文件夹表演」：路由、服务、仓储三个目录都建好了，代码却还是从路由一路写到 SQL。

判断分层是否成立，我只看一个标准——**这一层能不能被单独替换**。

- 路由层：只做 HTTP 的事（解析、校验、状态码、异常映射），不该知道表结构长什么样。
- 服务层：只写业务规则，不该 import `Request`，也不该 import `HTTPException`。
- 仓储层：只碰数据，ORM、SQL、连接池全部关在这一层里。

路由应该薄到只剩一行调用：

```python
# ✅ 路由是薄壳：拿校验过的入参 → 调服务 → 返回结果
@router.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(body: OrderCreate, svc: OrderService = Depends(get_order_service)):
    return await svc.create(body)
```

```python
# ❌ 同一个函数里：解析参数 → 查库存 → 写订单 → 拼响应
@router.post("/orders")
async def create_order(body: dict, session: Session = Depends(get_db)):
    if body.get("qty") is None:              # 参数校验混进来了
        raise HTTPException(400, "缺少 qty")
    stock = session.execute(...).scalar()    # 数据访问混进来了
    ...
```

有个更简单的自检方式，两个问题就够：

1. 给服务层写单测时，需要起一个 HTTP 服务吗？（不该需要）
2. 把 FastAPI 换成别的框架，需要改的只有路由层吗？（该只有路由层）

如果第二问的答案是「全都要改」，那业务规则其实写在路由里，只是文件名叫 `service.py` 而已。

## 2. 类型不只是校验，是边界契约

FastAPI 的自动文档常被当成演示功能，但真正值钱的是它背后的东西：**OpenAPI 是一份机器可读的契约**。有了它，前端类型、接口测试用例、网关校验规则都可以从同一份定义里生成，而不是靠人对齐字段。

要让这份契约有意义，第一件事是**请求模型和响应模型分开**：

```python
class UserCreate(BaseModel):           # 入参：允许写什么
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def strong_enough(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码至少 8 位")
        return v

class UserOut(BaseModel):              # 出参：允许读什么（注意这里没有 password）
    id: int
    email: EmailStr
    created_at: datetime
```

分开写有两个直接收益。一是**响应模型会自动裁字段**——`password_hash` 这种字段根本不在 `UserOut` 里，接口就不可能漏出去，不需要靠「记得别返回它」。二是校验只有一处，路由里不该再出现 `if len(name) < 2` 这种判断，出现了就说明校验放错了层。

还有一个常见的手写冗余：

```python
# ❌ 多余：FastAPI 会按 response_model 序列化
return UserOut(**user.__dict__)

# ✅ 直接把 ORM 对象返回即可
return user
```

## 3. `async def` 是一个承诺，不是超能力

这是 FastAPI 里唯一一个「写错一个字，性能掉一个数量级」的地方。

FastAPI 的路由有两条执行路径，理解性能问题的前提就在这里：

- `async def` 定义的路径函数，**直接在事件循环上执行**。事件循环每个 worker 只有一条，它只在遇到 `await` 时才会去处理别的请求。
- 普通 `def` 定义的路径函数，FastAPI 会**把它丢进线程池**（anyio 的默认上限是 40 个线程，可以用 `anyio.to_thread.current_default_thread_limiter().total_tokens` 调整）。阻塞在这里是安全的，因为事件循环没被占住。

所以判据只有一句话：**函数体里每一个 I/O 调用都是可 await 的，才用 `async def`；只要有一个同步调用，就用 `def`。**

看一个真实形态的事故：

```python
# ❌ async def + 同步 HTTP 客户端 = 把事件循环按在地上
@app.get("/user/{uid}/profile")
async def get_profile(uid: str):
    r = requests.get(f"http://users-svc/internal/{uid}", timeout=30)
    return r.json()
```

平时上游 40ms 返回，一切正常，什么都看不出来。某次上游发布后冷启动，一个请求卡了 20 秒——**这个 worker 上所有在途请求全都排在这一行后面**，P99 直接冲到 30 秒，连 `/healthz` 都超时。修复只是去掉 `async` 一个词。

三种正确写法，按场景选：

```python
# 1) 换异步客户端（推荐，尤其是同一个请求要打多个下游时）
async with httpx.AsyncClient() as client:
    r = await client.get(url, timeout=30)

# 2) 去掉 async，让 FastAPI 把整个函数丢进线程池（改动最小）
@app.get("/profile")
def get_profile(uid: str):
    return requests.get(url, timeout=30).json()

# 3) 保留 async 签名，只把同步调用踢到线程里
r = await asyncio.to_thread(requests.get, url, timeout=30)
```

| 场景 | 选谁 | 原因 |
|---|---|---|
| 只做参数组装、读内存里的对象 | 都行 | 没有 I/O，差别可忽略 |
| 用 asyncpg / asyncmy / httpx 等异步库 | `async def` | 每个 I/O 都能 await |
| 用 PyMySQL / requests / 同步云厂商 SDK | `def` | 让线程池兜住阻塞 |
| 一个请求要并发打多个下游 | `async def` + `asyncio.gather` | 扇出只能靠事件循环 |
| 重 CPU / 重 GPU 计算 | 都不该放在端点里 | 交给任务队列或独立推理服务 |

最后一行值得单独说：图像处理、模型推理这类计算，放进 `def` 也只是把线程池占满，放进 `async def` 更糟——它会直接冻住事件循环。正确做法是交给任务队列（Celery、ARQ 之类）或独立的推理服务。

「后台任务」用的是同一个判据。`BackgroundTasks` 适合一两百毫秒、失败也无所谓的事（记一条埋点、发一封通知）；需要重试、需要进程重启后还能活下来的，就该上队列。另外后台任务里不要复用请求注入的数据库会话——请求一结束它就关了。

## 4. 资源的三类生命周期

FastAPI 的资源管理其实只回答一个问题：**这个东西该活多久？** 按答案分三类，放错任何一类都会出问题。

**（1）进程级：贵且可共享的，一个 worker 只建一次。**

数据库 engine、`httpx.AsyncClient`、Redis 连接、模型、tracer 都属于这一类。它们放 `lifespan`，挂到 `app.state`：

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)        # 日志要在第一个请求之前就绪
    app.state.engine = create_async_engine(settings.database_url, pool_size=10, max_overflow=10)
    app.state.http = httpx.AsyncClient(timeout=10.0)
    yield                                         # 这一行之前是启动，之后是关闭
    await app.state.http.aclose()
    await app.state.engine.dispose()

app = FastAPI(lifespan=lifespan)
```

`lifespan` 取代了老的 `@app.on_event("startup")`：同一个资源的建立和释放写在同一个函数里，而且启动阶段出错会直接让进程起不来——比「服务看起来是好的、第一个请求才炸」要好得多。

**（2）请求级：每请求一个、用完就关的。**

数据库会话是几乎唯一常见的那一个，用带 `yield` 的依赖：

```python
async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(request.app.state.engine) as session:
        yield session
```

**（3）随手建：便宜到不值得缓存的。** 直接建，不要为了「优雅」加一层单例。

把这三类搞混，有两个经典错误：

- **在依赖里创建 engine 或连接池**：看起来在用连接池，实际上每次请求都新建一个，池根本没生效，还白白多一次握手。池是进程级的。
- **把 session 做成模块级全局**：两个并发请求共用一条连接和一个事务，轻则数据串台，重则一方的回滚把另一方的写入带走。

还有一个很隐蔽的坑：**带 `yield` 的依赖，清理代码到底什么时候执行？** 这段行为在 FastAPI 里改过好几次。0.118.0 之前，退出代码在「路径函数返回后、响应发出前」执行——于是返回 `StreamingResponse` 的接口会发现依赖里的 session 在流式传输过程中就已经被关掉了。0.118.0 把清理时机改回「响应发送完成后」，流式响应才能安全持有依赖给的资源；再往后（0.121.0 起）干脆给了 `Depends(scope=...)`，让时机变成你能显式选的：

```python
# 默认：清理代码在响应发送完成后执行（流式响应用这个）
session: AsyncSession = Depends(get_session)

# 显式：路径函数一结束就清理（资源更早释放，但响应过程中不能再依赖它）
session: AsyncSession = Depends(get_session, scope="function")
```

只要你的服务里有流式接口，又用依赖注入了数据库会话或外部连接，这一条就值得对着自己的版本确认一遍——这类问题不会在压测里暴露，只会在某次「响应确实发出去了、但内容不完整」的时候才被发现。

## 5. 连接池与 worker 数：先把预算算清楚

这是最容易被忽略的一个乘号：

> 数据库看到的连接数 = worker 数 ×（pool_size + max_overflow）

4 个 worker、每个池 `pool_size=10, max_overflow=10`，峰值就是 80 条连接。再算上预发环境、定时任务、以及运维窗口里并存的另一个版本，数据库的 `max_connections` 很容易被打满——表现出来却是「服务突然全站超时」这种看不出根因的现象。

```python
engine = create_async_engine(
    settings.database_url,
    pool_size=10,         # 常驻连接
    max_overflow=10,      # 突发时最多再借这么多（池的上限是 5/10，这里是按服务调的起点）
    pool_timeout=30,      # 借不到就等，等不到就报错，不要无限等
    pool_recycle=1800,    # 半小时回收一次，避开数据库侧的 idle 断连
    pool_pre_ping=True,   # 借出前先探活，防止拿到已经死掉的连接
)
```

调参的顺序是：先按上面的公式把总量压到数据库容量的六七成以内，再用 `pg_stat_activity`（或 MySQL 的 `SHOW PROCESSLIST`）看真实并发，最后压测确认。**不要靠猜。**

worker 数量也有个常见的抄错：WSGI 时代的 `2 × CPU + 1` 不要照搬。ASGI 的并发主要靠事件循环而不是多进程，起点取「每核 1 个」，再按压测结果加减——注意每加一个 worker，上面的连接数预算就再乘一次。跨多实例部署时，通常需要在数据库前面放一个 PgBouncer 之类的连接池代理，把成千上万的连接复用成几十条。

另外两条几乎零成本的纪律：`--reload` 只属于本机开发，生产环境用 `uvicorn --workers N` 或 `gunicorn -k uvicorn.workers.UvicornWorker` 交给它做进程管理；`uvloop + httptools`（Linux）能提高吞吐，但请先解决第 3 节的阻塞问题——那才是数量级更大的那一个。

## 6. 可观测性四件套：没有它，优化只能靠猜

性能优化最贵的不是改代码，而是**定位**。没有下面这四样，你连「慢在哪一层」都要靠猜。

**request id**：一次请求的所有日志必须能被串起来。用一个中间件把 id 放进 `ContextVar` 并回写到响应头，客户端报障时直接给你一串可 grep 的值：

```python
request_id_var: ContextVar[str] = ContextVar("request_id")

@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex
    token = request_id_var.set(rid)
    try:
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response
    finally:
        request_id_var.reset(token)
```

**结构化日志**：输出 JSON 到 stdout，交给采集侧统一收集。字段化的日志才能被查询——`print("用户登录成功")` 只能被肉眼读。

**延迟分布而不是平均值**：记 P50 / P95 / P99 和慢请求明细。平均值会把「1% 的请求卡了 30 秒」平均成「还挺快」，而线上事故永远发生在那 1% 里。

**健康检查要分两种**：`liveness` 回答「进程还活着吗」，`readiness` 回答「现在能接流量吗」。`readiness` 应该真的探一下关键依赖（数据库、缓存），否则滚动发布时会把流量打进一个还没准备好的实例；反过来，`liveness` 千万不要去探数据库——数据库抖动会让编排系统把好好的进程全部重启，把一次抖动放大成一次故障。

## 7. 容易踩的坑

1. `async def` 里调用同步驱动或同步 SDK —— 一个慢调用冻住整个 worker
2. 在依赖里创建 engine / 连接池 —— 池形同虚设，每请求一次握手
3. 把 `AsyncSession` 写成模块级全局 —— 跨请求共享事务
4. 在 `for` 循环里逐条 `await` 查询 —— N+1，改用 `selectinload` 一次取或 `asyncio.gather` 并发
5. worker 数照抄 `2N+1`，再乘上池大小，把数据库连接打满
6. 重 CPU / GPU 计算放在端点上 —— 应该进队列或独立推理服务
7. 生产开 `--reload`；用 `on_event` 而不是 `lifespan`
8. 用 `print` 当日志、没有 request id —— 故障时只能靠时间戳猜

## 小结

1. 分层的判据是**可替换性**，不是文件夹数量
2. 请求模型与响应模型分开，让 OpenAPI 成为真正被消费的契约
3. `async def` 是承诺：**所有 I/O 可 await 才用**，否则一律 `def`
4. 资源按生命周期分三类：**进程级放 lifespan、请求级用 yield 依赖、便宜的直接建**
5. 数据库连接数 = **worker 数 × 池大小**，先算预算再调参
6. 可观测性四件套（request id、结构化日志、延迟分布、两种健康检查）应该在第一天就装好

相关阅读：[Python 数据库工程实践：连接池、ORM 与批量写入](article.html?slug=python-db-connection-pool)讲连接池与批量写入的细节，[Python 多进程、多线程与 GIL](article.html?slug=python-multitask)讲清线程池背后的 GIL 限制，[从 Docker 到 Kubernetes：单机容器到底够用到什么时候](article.html?slug=docker-to-kubernetes)讲部署侧的探针与优雅停机，[AI Gateway](article.html?slug=ai-gateway-llm-infrastructure)讲网关层怎么统一做限流、缓存与成本归因。
