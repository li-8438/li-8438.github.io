---
title: Docker Compose 生产配置：健康检查、启动顺序与资源限制
slug: docker-compose-production
summary: 开发环境的 compose 文件直接上生产会出事——服务还没就绪就被访问、容器崩了没人拉起、日志把磁盘写满、一个容器吃光整台机器的内存。这篇讲生产环境必须改的那几项：healthcheck 与 depends_on 的配合、重启策略、资源限额、密钥管理和日志轮转，附一份可直接用的完整配置。
tags: [Docker, Compose, 部署, 运维]
section: 学习笔记
topic: 工程工具
subtopic: Docker
published: 2026-09-07
---

Compose 文件的默认值是为**开发便利**设计的，不是为**生产可靠**。同一份文件，本地跑得好好的，上生产就会暴露一堆问题。

这篇讲的就是那几项"必须在生产打开"的配置。

## 一、健康检查：从"启动了"到"能用了"

这是最重要的一项，也是最容易漏的。

**问题**：容器进程起来了，不等于服务可用。PostgreSQL 容器启动后要初始化数据目录、加载配置，可能要 8 秒才能接受连接。你的应用 3 秒就起来了，立刻去连数据库——连接失败，崩溃。

**解决**：给每个服务定义健康检查，让 Docker 知道它什么时候真正可用。

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: appdb
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d appdb"]
      interval: 10s        # 每 10 秒检查一次
      timeout: 5s          # 单次检查超时时间
      retries: 5           # 连续 5 次失败才标记为 unhealthy
      start_period: 30s    # 启动宽限期，这段时间内失败不计入次数
    restart: unless-stopped
```

四个参数各有各的作用：

**`start_period`（启动宽限期）最关键也最常被漏掉。** 没有它，服务启动期间的健康检查失败会立刻累加到 `retries` 里，导致一个本来正常的服务被误判为不健康。给慢启动的服务（Java 应用、大数据库）设 60-120 秒都不夸张。

**健康检查要打到真实依赖，而不是只返回 200。** 一个只 `return "ok"` 的接口骗过了 Docker，但骗不过用户。好的健康检查应该验证核心依赖是否可用（数据库能不能查、缓存能不能读写），但要注意别做得太重——它每 10 秒跑一次，太重会拖垮服务。

实践中常用两个端点：`/health/live`（存活探针，只查进程在不在）和 `/health/ready`（就绪探针，查依赖通不通）。Docker 的健康检查用前者或后者都行，取决于你想让 Docker 在依赖出问题时重启容器，还是只摘流量。

## 二、depends_on：光有它还不够

`depends_on` 控制启动顺序，但有个**巨大的陷阱**：

> **`depends_on` 默认只等容器"启动"，不等服务"就绪"。**

也就是说，下面这样写**不能**解决前面那个问题：

```yaml
services:
  app:
    depends_on:
      - db       # 只保证 db 容器先启动，不保证 db 能接受连接
```

正确做法是配合 `condition: service_healthy`：

```yaml
services:
  app:
    depends_on:
      db:
        condition: service_healthy       # 等 db 的健康检查通过
      redis:
        condition: service_started       # 只等容器启动（redis 启动很快）
      migrate:
        condition: service_completed_successfully   # 等这个一次性任务成功退出
```

三种 condition 的区别：

| condition | 含义 | 典型用途 |
| --- | --- | --- |
| `service_started` | 容器启动了就行（默认） | 启动快的无状态服务 |
| `service_healthy` | 健康检查通过 | 数据库、缓存等需要初始化的 |
| `service_completed_successfully` | 退出码为 0 | 数据库迁移、初始化脚本等一次性任务 |

**`service_completed_successfully` 解决了一个经典竞态。** 很多团队的应用容器和迁移任务同时启动，结果应用开始服务请求时迁移还没跑完，用户看到"表不存在"的报错。用这个条件让应用等迁移成功退出后再启动，问题永久消失——改这一行可能只要几分钟，能省掉无数次莫名其妙的部署失败。

## 三、重启策略：崩了要能自己起来

不给 `restart` 策略，容器崩溃后就一直躺着，得人工发现、人工拉起。

```yaml
services:
  app:
    restart: unless-stopped
```

四种取值：

| 策略 | 行为 | 什么时候用 |
| --- | --- | --- |
| `no` | 永不重启 | 开发默认值、一次性任务 |
| `always` | 总是重启，包括手动停止后 | 关键基础设施 |
| `on-failure` | 只在非 0 退出码时重启 | 批处理任务 |
| `unless-stopped` | 总是重启，**但手动停止后不重启** | **生产默认值** |

**生产环境默认用 `unless-stopped`。** 它和 `always` 的区别在于：你手动 `docker compose down` 停掉服务后，它不会再自作主张地爬起来。这个区别在维护时很重要——用 `always` 的话，你想停服务做维护，它反复重启，很烦人。

## 四、资源限制：防止一个容器拖垮整台机器

没有限制的情况下，一个内存泄漏的容器能把宿主机内存吃光，导致**同一台机器上的所有服务**一起挂掉。

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
```

- `limits` —— 硬上限，超了会被 OOM kill 或限流
- `reservations` —— 软性保留，调度时的参考值

设多少合适？看服务实际用量，在峰值上留 30%-50% 余量。一台 4GB 的机器，给所有容器的 `limits` 加起来控制在 2.5-3GB，剩下的留给操作系统和突发。

## 五、密钥：不要放进 .env

**不要把生产密钥写在服务器上的 `.env` 文件里**，更不要提交进仓库。

推荐用 Docker secrets：

```yaml
services:
  db:
    image: postgres:16-alpine
    secrets:
      - db_password
    environment:
      # 注意是 _FILE 后缀，从文件读取而不是直接写值
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

密钥会以文件形式挂载到容器的 `/run/secrets/` 下，容器内的应用读文件获取。比环境变量好在：不会出现在 `docker inspect` 的输出里，也不会被子进程继承。

很多官方镜像支持 `*_FILE` 环境变量约定（PostgreSQL、MySQL 都支持），就是为这个场景设计的。

如果觉得 secrets 太重，退而求其次的方案是：**CI/CD 在部署时注入环境变量**，密钥存在 CI 的密钥管理里，不落盘到服务器。

**已经泄露的密钥要吊销，不是删掉就行。** 密钥一旦进过公开仓库，就当作已经泄露——去控制台吊销重新生成，别指望删文件能解决问题。

## 六、日志轮转：别让日志写满磁盘

Docker 默认的 json-file 日志驱动**不做轮转**。一个跑几个月的容器，日志文件能长到几十 GB，把磁盘写满，然后所有服务一起挂。

```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "10m"     # 单个日志文件最大 10MB
        max-file: "3"       # 最多保留 3 个文件
```

这样每个容器的日志最多占 30MB。

注意两点：

1. **要给每个服务单独配**，服务级配置不会覆盖其他容器的默认行为
2. 全局默认值在 Docker 守护进程配置里设（`/etc/docker/daemon.json`），两边都设才完整

日志内容打到**标准输出**，由采集层统一处理，不要在容器内写日志文件——那既不好查，也会占容器的可写层。

## 七、一份完整的生产配置

以一个典型的 AI 应用为例（API + PostgreSQL + Redis + 向量库）：

```yaml
services:
  api:
    image: registry.example.com/rag-api:1.4.2      # 固定版本，不用 latest
    env_file: .env
    secrets:
      - db_password
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped
    read_only: true          # 根文件系统只读
    tmpfs:
      - /tmp                 # 需要写临时文件的地方用内存盘
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

  migrate:
    image: registry.example.com/rag-api:1.4.2
    command: ["alembic", "upgrade", "head"]     # 一次性任务
    depends_on:
      db:
        condition: service_healthy
    restart: "no"            # 一次性任务不重启
    env_file: .env

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ragdb
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d ragdb"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 1G
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass $(REDIS_PASSWORD)
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 256M
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "3"

secrets:
  db_password:
    file: ./secrets/db_password.txt

volumes:
  pgdata:
  redisdata:
```

部署命令：

```bash
# 拉取新镜像并启动（注意要显式 pull）
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# 看状态，STATUS 列会显示 (healthy) / (unhealthy) / (health: starting)
docker compose -f docker-compose.prod.yml ps

# 看日志
docker compose -f docker-compose.prod.yml logs --tail=100 -f api
```

## 八、容易踩的坑

**孤儿容器堆积。** 从 compose 文件里删掉一个服务后，旧容器还在跑。每次启动加 `--remove-orphans` 清理。

**卷的权限问题导致静默失败。** 容器以非 root 用户运行，但挂载的卷属主是 root，写不进去，而且往往不报明显的错。要么预先创建卷并设置正确的属主，要么用 init 容器模式处理。

**`up -d` 不会自动拉新镜像。** 它复用本地缓存。所以部署流程必须是 `pull` 然后 `up`，否则你以为部署了新版本，其实跑的还是旧的。

**Compose 文件里的 `$` 要转义成 `$$`。** Compose 会先做变量插值。如果你的应用配置里有 `$`（比如密码里带 `$`），不转义就会被当成变量替换掉，得到一个空值。

**服务名别用下划线。** 老版本 Docker 的 bridge 网络对下划线的 DNS 解析有问题，用连字符更保险。

**健康检查通过了但服务还是坏的。** 说明检查太浅。只查端口通不通不够，要查真实依赖。

## 小结

开发 compose 上生产前，逐项对照：

1. **每个服务配 healthcheck**，别漏 `start_period`
2. **`depends_on` 加 `condition: service_healthy`**，光写服务名没用
3. **`restart: unless-stopped`**，崩了能自己起来
4. **`deploy.resources.limits`**，防止一个容器拖垮整机
5. **密钥用 secrets**，不放 `.env` 不进镜像
6. **日志配 `max-size` 和 `max-file`**，否则迟早写满磁盘
7. **镜像用固定版本标签**，部署时先 pull 再 up，加 `--remove-orphans`

配好了不等于万事大吉。容器起不来、健康检查失败、端口不通、磁盘写满——这些线上问题的定位方法见 [Docker 排障与交付清单](article.html?slug=docker-troubleshooting)。
