---
title: Dockerfile 最佳实践：多阶段构建与镜像瘦身
slug: dockerfile-best-practices
summary: 能跑的 Dockerfile 和写得好的 Dockerfile 之间，可能差着 1GB 体积和五分钟构建时间。这篇讲的是真正影响结果的那几条：多阶段构建怎么砍掉 80% 体积、COPY 的顺序为什么决定构建速度、怎么用非 root 用户、以及那些悄悄把镜像撑大的坑。
tags: [Docker, Dockerfile, 镜像优化, 工程工具]
section: 学习笔记
topic: 工程工具
subtopic: Docker
published: 2026-09-07
---

一个典型的反例：

```dockerfile
FROM python:3.12
COPY . .
RUN pip install -r requirements.txt
CMD ["python", "main.py"]
```

这三行能跑，但它产出的镜像大概 1GB 以上，每次改一行代码都要重装所有依赖，而且容器以 root 运行。

改成下面这样，能把体积砍到 200MB 以下，构建时间从几分钟降到几秒。差别就在几条规则上。

## 一、选对基础镜像

基础镜像决定了你的起点体积和攻击面。以 Python 为例：

| 基础镜像 | 体积 | 有没有 shell | 什么时候用 |
| --- | --- | --- | --- |
| `python:3.12` | ~1 GB | 有 | 开发调试 |
| `python:3.12-slim` | ~130 MB | 有 | **生产默认**，兼容性好 |
| `python:3.12-alpine` | ~50 MB | 有 | 追求极致体积，但可能有兼容问题 |
| `distroless` | ~20-50 MB | **没有** | 最高安全性，无法进容器调试 |

**推荐默认用 `-slim` 变体。** 它基于 Debian，兼容性问题少，体积已经比完整版小了一个数量级。

Alpine 更小的代价是它用 **musl libc** 而不是 glibc。Python 的很多 C 扩展（比如 `psycopg2`、`numpy` 的某些版本、PyTorch）在 musl 下要么编译失败，要么要额外装编译工具链，最后体积反而没省下来。**除非你确认依赖在 Alpine 上没问题，否则别为了小几十 MB 给自己找麻烦。**

Distroless 连 shell 都没有，攻击面最小，但也意味着没法 `docker exec` 进去排查。需要调试时得用它的 debug 变体，或者用 `docker cp` 把工具拷进去。

**一定要锁定具体版本。** `FROM python:latest` 今天和明天可能指向不同的 Python 版本，明天构建就崩了。写 `python:3.12-slim` 或者更精确到 `python:3.12.7-slim`。

## 二、多阶段构建：最有价值的一招

问题在哪？构建应用需要编译器、构建工具、开发依赖，但**运行**时一样都不需要。传统写法把这些全留在了最终镜像里。

多阶段构建的思路：**用一个镜像构建，只把产物拷贝到另一个干净的运行镜像。**

以 Python 项目为例：

```dockerfile
# 第一阶段：构建
FROM python:3.12-slim AS builder
WORKDIR /app

# 用虚拟环境，方便整体拷贝
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 第二阶段：运行
FROM python:3.12-slim
WORKDIR /app

# 只拷贝虚拟环境，不拷贝构建工具和缓存
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

最终镜像里没有 pip 缓存、没有编译工具、没有中间产物。

如果是 Go 这类编译型语言，效果更夸张——`golang` 基础镜像构建出的二进制文件，拷到一个 `scratch`（空镜像）或 `distroless` 里，能从 1.5GB 降到 15MB。

**判断标准**：只要你的构建过程需要装编译工具、SDK 或者开发依赖，就该用多阶段构建。

## 三、层的顺序决定构建速度

Docker 逐层构建，并且**缓存每一层**。某一层变了，它后面所有层的缓存全部失效，都得重跑。

这意味着——**把变化频率低的放前面，变化频率高的放后面。**

```dockerfile
# ❌ 错误：先拷全部代码
COPY . .
RUN pip install -r requirements.txt
# 改一行代码 → COPY 层失效 → pip install 层也失效 → 重新安装所有依赖
```

```dockerfile
# ✅ 正确：先只拷依赖声明
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# 改一行代码 → 只有最后的 COPY 层失效，依赖层命中缓存
```

依赖文件（`requirements.txt`、`package.json`、`go.mod`）的变化频率远低于源代码。把它单独提前，改代码时就不会触发依赖重装。

这一条能把日常构建从几分钟降到几秒，是投入产出比最高的优化。

另外几个缓存相关的点：

```bash
docker build --pull -t myapp:1.0.0 .        # 强制拉取最新基础镜像
docker build --no-cache -t myapp:1.0.0 .    # 禁用缓存，全量重建
docker build --pull --no-cache ...          # 两者结合，最彻底
```

`--pull` 拉新基础镜像，`--no-cache` 重跑所有构建步骤，两者目的不同，可以组合使用。

## 四、.dockerignore：别把垃圾送进构建上下文

执行 `docker build .` 时，Docker 会把当前目录下的**所有文件**打包发送给守护进程，这就是"构建上下文"。

没有 `.dockerignore`，你会把 `.git` 目录、本地 `venv`、`.env` 密钥文件、测试目录、日志全送进去。后果有两个：构建变慢，以及**密钥可能被拷进镜像**。

```dockerfile
# .dockerignore
.git
.gitignore
__pycache__
*.pyc
venv/
.venv/
.env
.env.*
*.log
tests/
.pytest_cache/
README.md
Dockerfile
docker-compose*.yml
```

`.env` 那行尤其重要。很多人以为后面没 `COPY .env` 就安全，但如果写了 `COPY . .`，而 `.env` 又没被忽略，它就已经进镜像了。

## 五、安全：不要用 root 跑容器

容器默认以 root 运行。一旦应用被攻破，攻击者就拿到了容器内的 root 权限，接下来可能进一步逃逸到宿主机。

```dockerfile
# 创建非 root 用户
RUN groupadd --system appgroup && \
    useradd --system --ingroup appgroup appuser

WORKDIR /app
COPY --chown=appuser:appgroup . .

# 切换到非 root
USER appuser

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

很多官方镜像已经内置了非 root 用户（比如 Node 镜像的 `node`），直接 `USER node` 就行。

注意顺序：**先 `COPY --chown` 再 `USER`**。如果先切用户再拷贝，可能因为权限不足导致写入失败。

## 六、减少层数与清理缓存

每条 `RUN`、`COPY`、`ADD` 都会产生一层。相关的命令应该合并：

```dockerfile
# ❌ 三层，且 apt 缓存留在了镜像里
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*
```

```dockerfile
# ✅ 一层，缓存同层清理
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
```

关键点：**清理必须和安装在同一层**。否则缓存在前一层已经固化了，后一层删它只是加了个"删除标记"，镜像体积一点没小。

几个常用的清理参数：

| 命令 | 参数 |
| --- | --- |
| apt | `--no-install-recommends` + `rm -rf /var/lib/apt/lists/*` |
| pip | `--no-cache-dir` |
| npm | `npm ci` + `npm cache clean --force` |
| apk | `--no-cache` 或 `apk add --virtual` 后 `apk del` |

## 七、一个完整的 Python 生产 Dockerfile

把上面几条合起来：

```dockerfile
# syntax=docker/dockerfile:1

# ============ 构建阶段 ============
FROM python:3.12-slim AS builder
WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 先只拷依赖声明，最大化缓存命中
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ============ 运行阶段 ============
FROM python:3.12-slim

# 创建非 root 用户
RUN groupadd --system appgroup && \
    useradd --system --ingroup appgroup appuser

WORKDIR /app

# 从构建阶段只拷贝虚拟环境
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 拷贝代码（带正确的属主）
COPY --chown=appuser:appgroup . .

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

几个额外说明：

**`PYTHONUNBUFFERED=1`** 让 Python 输出不缓冲，否则容器日志可能看不到实时输出。

**`PYTHONDONTWRITEBYTECODE=1`** 不生成 `.pyc` 文件，减少无用文件。

**`HEALTHCHECK`** 让 Docker 能判断容器是否真的可用，而不只是"进程还在"。这是 Compose 健康检查的基础，后面讲编排时会用到。

## 八、构建之后要做的检查

```bash
# 看体积（第一件事）
docker images myapp

# 看分层，找出是哪一层撑大的
docker history myapp:1.0.0

# 扫漏洞
docker scout cves myapp:1.0.0
trivy image myapp:1.0.0
```

漏洞扫描应该在 **CI 里做**，而不是只本地跑一次。基础镜像和依赖的安全补丁是持续发布的，三个月前干净的镜像现在可能有 CVE。

**定期重建镜像**也是这个道理——镜像是不可变的，它快照的是构建那一刻的状态。想拿到最新的安全补丁，就得重新构建。

## 小结

按影响力排序：

1. **多阶段构建**——砍掉构建工具，体积和攻击面同时下降
2. **`COPY` 依赖文件先于源代码**——日常构建从几分钟变几秒
3. **`.dockerignore`**——构建更快，且防止密钥进镜像
4. **锁定基础镜像版本**——避免"昨天还能构建"
5. **非 root 用户**——容器被攻破时的止损线
6. **同层清理缓存**——减体积
7. **CI 里跑漏洞扫描**——安全补丁是持续的事

单个容器搞定了，下一步是多个容器怎么协同——健康检查、启动顺序、资源限制、密钥管理，见 [Docker Compose 生产配置](article.html?slug=docker-compose-production)。
