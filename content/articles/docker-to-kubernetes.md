---
title: 从 Docker 到 Kubernetes：单机容器到底够用到什么时候
slug: docker-to-kubernetes
summary: Compose 一把梭的部署方式，会在哪一天突然不够用？这篇不列命令清单，而是回答三个问题：Docker 和 Kubernetes 究竟是什么关系、同一件事在两边怎么做、以及迁移时真正会翻车的六个点。附一份把 RAG 服务从 Compose 搬到集群的完整清单（Deployment、三探针、优雅停机、HPA、Gateway API），以及一张「什么时候别上 Kubernetes」的决策表。
tags: [Docker, Kubernetes, 容器编排, 部署, 运维]
section: 学习笔记
topic: 工程工具
subtopic: Kubernetes
published: 2026-09-07
---

一套 RAG 服务跑在一台 8 核 16G 的机器上：API、MySQL、Redis、etcd、MinIO，一个 compose 文件全拉起来。日常稳得很，直到某天遇到这几种情况：

**要扩容。** 流量涨了，需要第二个 API 实例。Compose 能 `up --scale api=2`，但两个实例抢同一台机器的 CPU，还要手动在前面配负载均衡——而且数据库还是单点。

**要换机器。** 云厂商那台机器要停机维护，你得在另一台机器上把整套环境重建一遍：拉镜像、传数据卷、改配置、验证。数据卷躺在原来那台机器的磁盘上，迁移过程就是一次小型心脏手术。

**要不停机发布。** 现在发布是 `docker compose up -d`，容器先停后起，中间有几秒到几十秒的中断。业务方开始问"能不能别在白天发"。

这三件事有一个共同点：**它们都不是"容器"的问题，而是"一台机器"的问题。** Docker 把环境打包这件事做得很好，但它只管一台机器上的容器。跨机器、跨副本、跨时间的那些事，它不管。

Kubernetes 就是为这些事设计的。但它是有代价的——这个代价值得单独花一整节讨论，因为大部分团队上 K8s 不是因为需要它，而是因为"别人都在用"。

这篇讲的是：**边界在哪里，跨过去的时候哪些东西会变，以及怎么判断该不该跨。**

### 先说清楚：Docker 和 Kubernetes 不是二选一

这是最大的误解，来源是 2020 年那条"Kubernetes 弃用 Docker"的新闻。

真相是：K8s 弃用的是 **dockershim**——一个让 K8s 能直接调用 Docker 守护进程的适配层。它没弃用 Docker 镜像，没弃用 Dockerfile，也没弃用你的 `docker build`。

到 2026 年，这条链路已经完全稳定下来了：

```text
开发机                          集群节点
─────────────────────────      ─────────────────────────
Dockerfile
  │ docker build（BuildKit）
  ▼
OCI 镜像 ──push──▶ Registry ──pull──▶ containerd / CRI-O
                                        │ runc
                                        ▼
                                      容器进程
                                        ▲
                                        │ 调度、自愈、伸缩、网络
                                     Kubernetes
```

Docker 负责**造**容器，Kubernetes 负责**管**容器。它们之间是上下游，不是竞争关系。

时间线能看清这个分离是怎么发生的：

| 时间 | 事件 |
| --- | --- |
| 2013 | Docker 发布，把 Linux 的 namespace/cgroups 包装成人能用的工具 |
| 2017 | Docker 把运行时 containerd 捐给 CNCF；K8s 在与 Swarm、Mesos 的竞争中胜出 |
| 2020 | K8s 宣布弃用 dockershim（1.20） |
| 2022 | K8s 1.24 正式移除 dockershim，集群改用 containerd / CRI-O |
| 2025 | Docker Engine 29 发布，新安装默认启用 containerd 镜像存储 |
| 2026 | Docker Desktop 内置 K8s 1.36；容器生态按"构建 / 运行时 / 编排"三层各司其职 |

所以现在真实的分工是：**本地用 Docker 构建和调试，集群里用 containerd 跑，K8s 管调度。** 你写的 Dockerfile 一个字都不用改。

顺带纠正另一个常见说法——"Docker 已死"。Docker 官方在 2025-2026 年的发力方向是 AI（把模型、MCP 服务也做成 OCI 制品分发），CLI 和 Dockerfile 依然是事实标准。真正的竞争发生在**运行时**这一层（containerd、CRI-O、Podman），而不是构建层。这跟"Docker 死了"是两回事。

## 一、边界：Docker 管一台机器，K8s 管一群机器

一句话概括两者的职责：

> **Docker 回答"这个容器怎么跑起来"，Kubernetes 回答"这些容器应该在哪台机器上跑几个、挂了怎么办"。**

Docker（含 Compose）默认假设**只有一台机器**。它的所有能力都建立在这个前提上：

- 网络：在一台机器上建 bridge 网络，容器间用服务名互访
- 存储：卷是这台机器上的一个目录
- 重启：容器挂了，在这台机器上重新拉起
- 伸缩：`--scale N`，多个副本还是挤在这台机器上

K8s 把前提换成了**有一批机器，而且随时可能有机器坏掉**。于是每个问题都要重新回答一遍。

### 概念映射

先看名词对照，这是迁移时最直观的一层：

| Docker / Compose | Kubernetes | 说明 |
| --- | --- | --- |
| 容器 | Pod | Pod 是最小调度单位，可含多个共享网络的容器 |
| service（compose 里一项） | Deployment + Service | 一份要两份清单：Deployment 管副本，Service 管访问入口 |
| `docker run` | 不直接存在 | K8s 里没有"跑一个裸容器"，最小单位是 Pod |
| 卷 volume | PersistentVolumeClaim | 卷不再绑定机器，而是向存储系统"申请" |
| 网络 network | 扁平 Pod 网络 + Service | 所有 Pod 互通，靠 NetworkPolicy 隔离 |
| 端口映射 ports | Service（ClusterIP/NodePort/LoadBalancer） | 集群内用 ClusterIP，对外用 Gateway API |
| environment | ConfigMap / Secret | 配置与密钥分离，且支持挂载为文件 |
| secrets | Secret | 注意默认只是 base64，不是加密 |
| healthcheck | liveness / readiness / startup 探针 | 一个变三个，这是最大的变化 |
| `restart: unless-stopped` | 控制器重建 Pod | 而且可以重建到**另一台机器**上 |
| `depends_on` | 无直接对应 | 用 initContainer 或应用侧重试 |
| `deploy.resources.limits` | requests + limits | 多了一个 requests，且它是调度依据 |

注意最后两行：**`depends_on` 没有对应物，资源限制多了一个字段。** 这两处是迁移时最容易出事的地方，后面专门讲。

### 能力对照

| 能力 | Docker Compose | Kubernetes |
| --- | --- | --- |
| 调度 | 本机，手动 | 跨节点，按资源与约束自动放置 |
| 故障恢复 | 本机重启容器 | 节点故障后在健康节点重建 Pod |
| 伸缩 | `--scale N`，手动 | HPA / KEDA，按指标自动 |
| 发布 | 先停后起，有中断 | 滚动更新、金丝雀、一键回滚 |
| 健康检查 | healthcheck（1 个） | 三种探针，职责分离 |
| 服务发现 | 服务名 DNS（本机） | Service DNS（全集群） |
| 配置更新 | 改文件重启 | ConfigMap 更新可触发滚动重启 |
| 隔离 | 网络隔离（本机） | Namespace + RBAC + NetworkPolicy |
| 存储 | 本地卷 | PVC + StorageClass，可跨节点挂载 |
| 资源模型 | limits | requests（调度）+ limits（上限）+ QoS 分级 |
| 控制平面开销 | 几十 MB | 自托管 2-4GB，k3s 约 0.5-1GB |

最后一行值得单独强调：**K8s 不是免费的。** 它是你引入的一个新系统，有自己的升级节奏、证书轮换、插件兼容性和故障模式。这个成本在"要不要上"的决策里，权重比技术能力更高。

## 二、五个只有 K8s 能解决的场景

不是把能力表过一遍，而是看哪些痛点是 Compose 结构上解决不了的。

### 1. 机器挂了，服务还在

Compose 的 `restart: unless-stopped` 能处理"容器崩了"，处理不了"机器崩了"。机器断电、云厂商宿主机故障、磁盘损坏——这些情况下，Compose 和它管理的一切一起消失。

K8s 的处理方式：节点失联超过一定时间（默认 5 分钟），控制平面把该节点上的 Pod 标记为待重建，调度器在健康节点上重新创建。整个过程不需要人参与。

这个能力有个前提经常被忽略：**你的服务必须是"可重建"的。** 如果数据写在本地卷上，Pod 漂到别的节点就读不到——重建出来的实例是个空壳。所以 K8s 的高可用能力，实际上逼着你把状态外置（详见第四节的存储部分）。

### 2. 按指标自动伸缩

Compose 能手动扩副本，但没法"CPU 超过 70% 就加一个"。K8s 的 HPA 可以：

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: rag-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: rag-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300   # 缩容要保守，避免抖动
```

注意 `scaleDown` 的稳定窗口设得比扩容长得多。这是经验值：**扩容要快，缩容要慢**，否则流量小幅波动就会让副本数来回震荡。

### 3. 零停机发布和秒级回滚

Compose 更新服务是"停旧容器 → 起新容器"，中间必然有中断窗口。

K8s 的滚动更新先起新的、等新副本就绪再摘旧的：

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1         # 更新过程中最多比期望副本多 1 个
      maxUnavailable: 0   # 任何时刻都不允许可用副本低于期望值
```

`maxUnavailable: 0` 是关键。不写这行，默认值是 25%，意味着 4 副本的服务在发布时会先干掉一个——如果你没有多余容量，这就是真实的用户可见中断。

回滚更简单：

```bash
kubectl rollout undo deployment/rag-api          # 回到上一版
kubectl rollout history deployment/rag-api       # 看历史版本
kubectl rollout undo deployment/rag-api --to-revision=3
```

前提是你的镜像标签是**不可变的**（版本号或 commit 哈希）。用 `latest` 的话，回滚拉到的还是同一个镜像——这一点在 [Docker 核心概念](article.html?slug=docker-basics) 里强调过，在 K8s 里后果更严重。

### 4. 多团队、多环境共用一套基础设施

Compose 里"环境隔离"通常靠不同的 compose 文件和不同的机器。K8s 用 Namespace + RBAC + ResourceQuota 在同一套集群里切分：

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-rag-quota
  namespace: team-rag
spec:
  hard:
    requests.cpu: "8"
    requests.memory: 16Gi
    limits.cpu: "16"
    limits.memory: 32Gi
    persistentvolumeclaims: "10"
```

好处是资源池化、配额可控、权限可细分。代价是多了一层需要有人管理的抽象。

### 5. 声明式：告诉它"要什么"，而不是"做什么"

这是思维方式的转变，也是 K8s 所有能力的地基。

Compose 是命令式的：你执行 `up`，它启动容器；执行完，它的工作就结束了。K8s 是声明式的：你写下"我要 3 个副本"，控制器会持续比对实际状态与期望状态，不一致就动作——**永远在比，不是执行一次**。

结果是：**你手动 `kubectl delete pod` 删掉一个 Pod，它会自己回来。** 这在 Compose 里是不可想象的（删了就是删了），在 K8s 里是基本保证。

理解这一点，后面很多设计就说得通了：为什么 `depends_on` 没有对应物、为什么探针要分三种、为什么应用必须能承受随时被杀——因为它们都是"期望状态"模型的一部分。

## 三、迁移时会翻车的六个点

这是这篇最有价值的部分。能力对照表到处都有，但下面这些坑，只有真的迁过才知道。

### 坑 1：健康检查从一个变成三个

Compose 里只有一个 `healthcheck`。K8s 把它拆成了三个探针，因为它们的**后果完全不同**：

| 探针 | 问的问题 | 失败后果 | 检查应该多重 |
| --- | --- | --- | --- |
| `startupProbe` | 启动完成了吗 | 重启容器 | 可以重，因为只在启动期跑 |
| `livenessProbe` | 进程还活着吗 | **重启容器** | 要极轻，只看自身 |
| `readinessProbe` | 能接流量吗 | 只摘流量，不重启 | 可以查依赖 |

最常见的生产事故，是**把 liveness 探针写成"检查数据库"**：

```yaml
# ❌ 危险：数据库抖一下，所有 Pod 被重启，重启又压垮数据库
livenessProbe:
  httpGet:
    path: /health
    port: 8000
```

正确做法：liveness 只看进程自身是否卡死（比如一个只检查事件循环是否在转的接口），依赖检查放在 readiness 里：

```yaml
startupProbe:            # 慢启动保护：这段时间内 liveness 不生效
  httpGet:
    path: /health/live
    port: 8000
  periodSeconds: 10
  failureThreshold: 18   # 10s × 18 = 最多等 180 秒启动
livenessProbe:
  httpGet:
    path: /health/live
    port: 8000
  periodSeconds: 10
  failureThreshold: 3
  timeoutSeconds: 3
readinessProbe:
  httpGet:
    path: /health/ready  # 这个可以查数据库、查缓存
    port: 8000
  periodSeconds: 5
  failureThreshold: 3
  timeoutSeconds: 3
```

**`startupProbe` 是 Compose 的 `start_period` 的升级版。** Compose 里，启动宽限期内失败只是不计入次数，健康检查照常跑；K8s 里，startupProbe 成功之前 liveness 和 readiness **根本不会启动**。对于启动要几十秒甚至几分钟的服务（Java 应用、加载大模型的推理服务），这个区别是"能不能起来"和"永远在重启循环里"的区别。

### 坑 2：优雅停机的竞态窗口

这是 K8s 最经典、也最少被提前知道的坑。

Compose 里 `docker compose stop` 会发 SIGTERM，等一段时间（默认 10 秒）再 SIGKILL。简单直接。

K8s 里 Pod 删除的流程是这样的：

```text
t=0s   Pod 被标记为 Terminating
       ├─ 控制面开始把 Pod 从 Service 的 Endpoints 里摘除  ← 异步，需要时间
       └─ kubelet 开始执行 preStop 钩子（如果配了）
t=?s   preStop 执行完毕，SIGTERM 发给容器 1 号进程
       └─ 应用开始优雅关闭：停止接收新请求、处理完在途请求
t=60s  terminationGracePeriodSeconds 到期，SIGKILL
```

**问题在于第 2 步的两件事是并行的。** Endpoints 摘除要经过 API Server → 各节点的 kube-proxy → 更新转发规则，通常需要 1-10 秒；而 SIGTERM 一旦发出，应用立刻开始关闭。于是存在一个窗口：**应用已经不接收新请求了，但负载均衡还在往它这里发——这批请求全部 502。**

修法是加一个 `preStop` 钩子，人为把这个窗口填上：

```yaml
spec:
  terminationGracePeriodSeconds: 60    # 总预算：含 preStop 的时间
  containers:
    - name: api
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 10"]   # 等 Endpoints 摘除传播完
```

三个要点：

- **`terminationGracePeriodSeconds` 包含 `preStop` 的时间。** 设 60 秒、preStop 睡 10 秒，应用实际只有 50 秒做收尾。两个值要一起调。
- **应用必须真的处理 SIGTERM。** 收到信号后停止接收新连接、处理完在途请求、关闭数据库连接，然后退出。不处理的话，宽限期一到就是 SIGKILL，什么都没保存。
- **长连接（WebSocket、SSE 流式输出）要给更长的宽限期。** 大模型的流式响应可能持续几十秒，这类服务 `terminationGracePeriodSeconds` 给到 120-300 秒并不夸张。

对于流式输出的 AI 应用，这一条尤其重要——用户正看着回答一个字一个字往外冒，一次滚动更新就把连接切断了。

### 坑 3：本地卷陷阱

Compose 的卷是**这台机器上的一个目录**。K8s 的 Pod 可能漂移到任何一台节点上。

于是这个经典事故发生了：MySQL 的 Pod 原本在节点 A，节点 A 故障，Pod 在节点 B 重建，挂载的是节点 B 的存储——**空的**。服务"自愈"了，但数据没了。

K8s 的解法是 PVC + StorageClass：卷不再是目录，而是向存储系统申请的一块资源，可以被任何节点挂载（取决于访问模式）：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: milvus-data
spec:
  accessModes:
    - ReadWriteOnce          # 只能被单个节点以读写方式挂载
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 100Gi
```

访问模式是这里的重点：

| 模式 | 含义 | 典型用途 |
| --- | --- | --- |
| `ReadWriteOnce`（RWO） | 单节点读写 | 数据库、大多数有状态服务 |
| `ReadWriteOncePod` | 单个 Pod 读写（更严格） | 需要强独占的场景 |
| `ReadWriteMany`（RWX） | 多节点同时读写 | 共享模型权重、NFS 类存储 |
| `ReadOnlyMany`（ROX） | 多节点只读 | 只读分发的数据集 |

注意 RWO 是"单**节点**"，不是"单 Pod"——同一节点上的多个 Pod 可以同时挂载。需要严格单 Pod 独占时用 `ReadWriteOncePod`。

**我的建议：数据库不要进集群。** 用云厂商的托管数据库（RDS 一类），把备份、主从、故障切换这些事外包出去。理由很实在：

- 有状态服务在 K8s 里需要 StatefulSet + 稳定的网络标识 + 有序的启停，复杂度显著高于无状态服务
- 一旦出问题，恢复数据的难度比恢复一个无状态 Pod 高一个数量级
- 集群之外的托管数据库，本身就不受集群故障影响

如果一定要在集群里跑有状态服务（比如 Milvus 依赖的 etcd 和 MinIO），正确的姿势是 StatefulSet + PVC + 经过验证的备份方案，并且**先演练一次恢复**再上线。

### 坑 4：资源模型多了一个维度

Compose 里 `deploy.resources.limits` 是唯一的控制项。K8s 里有两个字段，作用完全不同：

```yaml
resources:
  requests:            # 调度依据：节点要有这么多空闲才肯放
    cpu: "500m"        # 500 毫核 = 半个 CPU
    memory: "512Mi"
  limits:              # 硬上限
    cpu: "1"
    memory: "1Gi"
```

区别非常关键：

**CPU 超限和内存超限的后果不一样。** CPU 用超了只是被限流（throttle），请求变慢；内存超了直接 OOMKill，进程被杀。所以**内存 limit 要给足，CPU limit 可以适度收紧**——很多人把 CPU limit 设得太小，导致服务延迟莫名其妙地抖动，就是这个原因。

**requests 决定调度，也决定 QoS 等级。** K8s 按 requests 和 limits 的关系把 Pod 分成三档，节点资源紧张时的驱逐优先级不同：

| QoS 等级 | 条件 | 资源紧张时 |
| --- | --- | --- |
| `Guaranteed` | 所有容器的 requests == limits | 最后被杀 |
| `Burstable` | 至少有一个容器设置了 requests 或 limits | 中间 |
| `BestEffort` | 什么都没设 | 第一个被杀 |

**不设 resources 的 Pod 是 BestEffort**，节点内存一紧它先死。所以"先跑起来再说，资源以后再配"在 K8s 里是很危险的做法——Compose 里不配只是没上限，K8s 里不配等于主动声明"我最该被杀"。

### 坑 5：`depends_on` 没有对应物

Compose 里这一行很常见：

```yaml
depends_on:
  db:
    condition: service_healthy
```

K8s 里**没有这个功能，也不会有**。原因不是没实现，而是设计取向不同：**在分布式系统里，依赖"永远可能暂时不可用"**——数据库可能重启、网络可能抖动、Pod 可能被调度到另一个节点。如果编排层能保证"启动顺序"，那也只是启动那一次的顺序，运行时的中断它管不了。

所以 K8s 的态度是：**应用必须自己处理依赖不可用。** 具体做法是分层处理：

**依赖可能暂时不可用** → 应用层重试（带指数退避）。这是绝大多数情况的正确解法。

**必须完成的前置任务**（比如数据库迁移）→ 用 initContainer 或 Job：

```yaml
initContainers:
  - name: wait-for-db
    image: postgres:16-alpine
    command: ["sh", "-c", "until pg_isready -h db -p 5432; do sleep 2; done"]
  - name: migrate
    image: registry.example.com/rag-api:1.4.2
    command: ["alembic", "upgrade", "head"]
```

**顺序真的重要**（比如 Milvus 要先等 etcd 和 MinIO 就绪）→ 靠 readiness 探针 + 应用侧重试共同保证。

这个转变对代码是有要求的：**你的应用启动逻辑不能假设依赖一定可用，必须能重试。** 如果代码里是"启动时连一次数据库，失败就退出"，到 K8s 里会变成 CrashLoopBackOff 死循环。这也是为什么容器化做得好的应用，迁 K8s 会顺很多——前面几篇强调的那些习惯（健康检查、连接重试、优雅停机）在这里全都要用上。

### 坑 6：网络模型完全变了

Compose 的网络模型很直观：每个服务一个名字，容器间用名字互访，端口映射对外暴露。

K8s 的模型不一样：

**Pod IP 会变，不要依赖它。** Pod 重建就换 IP。服务间访问一律走 Service 的 DNS 名（`http://rag-api:8000`），Service 提供稳定的虚拟 IP 并做负载均衡。

**所有 Pod 默认互通。** Compose 里不同网络是隔离的；K8s 的 Pod 网络是扁平的，任何 Pod 默认能访问任何 Pod。**想隔离必须显式写 NetworkPolicy**——不写就是全通，这在多租户或合规场景里是硬伤。

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-only-gateway
spec:
  podSelector:
    matchLabels:
      app: rag-api
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: gateway-system
      ports:
        - protocol: TCP
          port: 8000
```

**对外暴露的写法在 2026 年变了。** 这一点很重要，很多教程还是旧的：

> **Ingress NGINX 控制器已于 2026 年 3 月 24 日正式退役**——不再有版本发布、bug 修复，**也不再有安全补丁**。已部署的实例还能跑，镜像和 Helm chart 也还在，但新披露的 CVE 永远不会修。Ingress API 本身保留但已冻结（不再加新功能）。

新项目应该用 **Gateway API**（v1.5.1 已是 stable，运行在 K8s 1.30+）。它是 Ingress 的继任者，用角色分离的模型替代了 Ingress 那套越堆越多的注解：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: rag-api
spec:
  parentRefs:
    - name: external-gateway      # 由运维管理的 Gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: rag-api
          port: 8000
      timeouts:
        request: 120s             # 流式接口要给够
```

从 Ingress 迁移可以用官方工具 `ingress2gateway`（1.0 版本可自动转换 30 多种注解），但 `configuration-snippet`、`auth-url` 这类注解没有等价物，必须手工重建。**并且不要直接切换流量**：新旧并存，用 DNS 或权重逐步切，验证几天再下线旧的。

## 四、实战：把一套 RAG 服务搬进集群

前面讲的是差异，这一节给一份能改改就用的清单。以一个典型的 RAG 服务为例：API 服务 + MySQL + Redis + 向量库（Milvus，依赖 etcd + MinIO）。

### 迁移前的 Compose 长什么样

真实项目里大概是这个形状（节选）：

```yaml
services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: root123        # ← 明文密码，迁移时要处理
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"]
      interval: 10s
      timeout: 5s
      retries: 20

  etcd:
    image: quay.io/coreos/etcd:v3.5.18
    command: etcd --data-dir /etcd
    volumes:
      - etcd_data:/etcd
    healthcheck:
      test: ["CMD", "etcdctl", "endpoint", "health"]
      interval: 10s
      start_period: 10s
      retries: 20
    stop_grace_period: 60s

volumes:
  mysql_data:
  etcd_data:
```

看着很正常。但里面有四样东西在 K8s 里要重新做：明文密码、本地卷、healthcheck（一个变三个）、`stop_grace_period`（对应优雅停机的那一整套）。

### 第一步：无状态服务的 Deployment

这是核心清单，逐段说清楚每段在解决什么：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rag-api
  namespace: rag
spec:
  replicas: 3                        # 至少 2，否则滚动更新和节点故障都会中断
  selector:
    matchLabels:
      app: rag-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0              # 发布期间不允许可用副本下降
  template:
    metadata:
      labels:
        app: rag-api
    spec:
      terminationGracePeriodSeconds: 90      # 含 preStop 的 10 秒
      initContainers:
        - name: migrate
          image: registry.example.com/rag-api:1.4.2
          command: ["alembic", "upgrade", "head"]
          envFrom:
            - secretRef:
                name: rag-secrets
      containers:
        - name: api
          image: registry.example.com/rag-api:1.4.2    # 固定版本，不用 latest
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - configMapRef:
                name: rag-config       # 非敏感配置
            - secretRef:
                name: rag-secrets      # 密码、API Key
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "2Gi"            # 内存上限给足，防 OOMKill
          startupProbe:
            httpGet: { path: /health/live, port: http }
            periodSeconds: 5
            failureThreshold: 60       # 5s × 60 = 最多等 5 分钟启动
          livenessProbe:
            httpGet: { path: /health/live, port: http }
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3        # 只看自身，绝不查依赖
          readinessProbe:
            httpGet: { path: /health/ready, port: http }
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3        # 可以查数据库、查缓存
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]   # 填 Endpoints 摘除的窗口
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 10001
          volumeMounts:
            - name: tmp
              mountPath: /tmp         # 只读根文件系统时要给临时目录
      volumes:
        - name: tmp
          emptyDir: {}
      topologySpreadConstraints:      # 让副本尽量分散在不同节点
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: rag-api
```

几个解释：

**`topologySpreadConstraints` 是"Compose 转 K8s 后最容易忘的收益"。** 3 个副本如果全挤在一个节点上，那个节点挂了等于没有多副本。这行配置告诉调度器：尽量把它们摊到不同机器。单机 Compose 根本没这个问题（也没这个能力）。

**initContainer 里的 migrate 就是 `depends_on: service_completed_successfully` 的替代品。** 它跑完才启动主容器。注意它会在**每个** Pod 启动时执行，所以迁移脚本必须是幂等的、能并发安全的（MySQL 的 DDL 有锁，问题不大，但要意识到这点）。

**`securityContext` 那段是 Compose 里没有的维度。** K8s 有 Pod Security Admission，可以按 Namespace 强制要求非 root、只读根文件系统等。这些在 [Dockerfile 最佳实践](article.html?slug=dockerfile-best-practices) 里是"建议"，在 K8s 里可以变成"强制"。

### 第二步：Service 与对外暴露

```yaml
apiVersion: v1
kind: Service
metadata:
  name: rag-api
  namespace: rag
spec:
  selector:
    app: rag-api
  ports:
    - name: http
      port: 8000
      targetPort: http
  type: ClusterIP          # 集群内访问；对外走 Gateway API
```

集群内其他服务用 `http://rag-api:8000` 访问——和 Compose 里用服务名访问体验一致，但背后是集群级的 DNS 和负载均衡。

### 第三步：配置与密钥分离

```bash
# 非敏感配置：可以直接从 .env 生成
kubectl create configmap rag-config --from-env-file=.env -n rag

# 密钥：注意默认是 base64 编码，不是加密
kubectl create secret generic rag-secrets \
  --from-literal=DB_PASSWORD='xxx' \
  --from-literal=LLM_API_KEY='xxx' -n rag
```

**K8s Secret 默认只是 base64，不是加密。** 生产环境要么开启 etcd 静态加密，要么用外部密钥管理（Vault、云厂商 KMS、External Secrets Operator）。想把所有清单都提交进 Git 做 GitOps，就绕不开 Sealed Secrets 或类似的方案——这是 Compose 时代不用操心的一整块。

### 第四步：有状态部分

按前面的结论，优先级是这样的：

| 组件 | 建议 | 理由 |
| --- | --- | --- |
| MySQL | 用托管数据库 | 数据最珍贵，别自己扛备份和故障切换 |
| Redis | 托管，或单副本 + 持久化 | 缓存可重建，但要评估丢缓存的代价 |
| 向量库 | 托管优先；自建用 StatefulSet | 依赖链长（元数据 + 对象存储），自建复杂度高 |
| etcd / MinIO | 只在自建向量库时才需要 | 本身就是有状态组件，需要 StatefulSet + PVC |

如果确实要在集群里跑 Milvus 这类组件，形态是 StatefulSet（稳定网络标识 + 有序启停）+ PVC（每个副本独立卷）+ 经过演练的备份：

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: milvus
spec:
  serviceName: milvus
  replicas: 1                          # 分布式部署要按官方 operator 来，别自己拼
  template:
    spec:
      containers:
        - name: milvus
          image: milvusdb/milvus:v2.5.x
          volumeMounts:
            - name: data
              mountPath: /var/lib/milvus
  volumeClaimTemplates:                # 每个副本自动获得一个 PVC
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 100Gi
```

### 第五步：自动伸缩与中断预算

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: rag-api-pdb
spec:
  minAvailable: 2               # 自愿中断（节点升级、缩容）时至少保留 2 个
  selector:
    matchLabels:
      app: rag-api
```

**PDB 保护的是"自愿中断"**：节点升级、集群缩容、管理员 drain。它不保护节点突然宕机（那是"非自愿中断"）。没有 PDB 的话，一次节点批量升级可能把所有副本同时赶走。

### 部署与验证命令

```bash
kubectl apply -f k8s/                                  # 应用全部清单
kubectl rollout status deployment/rag-api -n rag       # 等发布完成（阻塞直到就绪）
kubectl get pods -n rag -w                             # 实时看 Pod 状态变化
kubectl describe pod <pod> -n rag                      # 排障第一命令：看 Events
kubectl logs -f deployment/rag-api -n rag              # 看日志（自动选一个 Pod）
kubectl top pods -n rag                                # 看实际资源占用
kubectl rollout undo deployment/rag-api -n rag         # 回滚
```

`kubectl describe` 的 Events 部分是排障的核心信息源：镜像拉取失败、调度失败（资源不够）、探针失败、被驱逐——原因都写在那里。这相当于 Compose 里 `docker compose ps` + `logs` + `inspect` 的组合，但信息更集中（这一块的排查思路见 [Docker 排障与交付清单](article.html?slug=docker-troubleshooting)）。

## 五、AI 负载上 K8s 的额外考量

如果你的服务涉及模型推理，K8s 上还有几件事和常规 Web 服务不一样。

### GPU 的分配方式正在换代

传统方式是 device plugin 的**整数卡模型**：`nvidia.com/gpu: 1` 就是独占一整张卡，不区分实际用了多少。对推理服务来说，一张 H100 跑一个小模型是巨大的浪费。

K8s 1.36（2026 年 4 月发布）把 **DRA（动态资源分配）** 的几个关键能力推到 Beta 并默认开启——可分区设备、可消耗容量、设备污点与容忍。它们的目标就是取代整数卡模型，让"这张卡分你 40% 显存"这种表达成为可能。

当前三种共享方式的取舍：

| 方式 | 隔离性 | 适用场景 |
| --- | --- | --- |
| 直通（一 Pod 一卡） | 最强，性能无损 | 70B 以上的旗舰模型 |
| MIG（硬件分区） | 强，有固定粒度 | SLA 严格、负载可预测 |
| 时间片复用 | 无内存隔离 | 开发/测试环境、7B 以下小模型 |

时间片复用在生产环境的风险是**尾延迟放大**：一个繁忙的 Pod 会拖慢共享同一张卡的其他 Pod。在线推理慎用。

### 冷启动是推理服务伸缩的最大敌人

Web 服务扩一个副本是秒级；推理服务扩一个是分钟级。链路是：

```text
拉镜像（30-60s）→ 下载权重（30-120s）→ 载入显存（20-90s）→ 预热（5-10s）
                                    总计：2-5 分钟
```

这带来两个直接后果：

**HPA 基于 CPU 伸缩对推理服务无效。** GPU 跑满了，CPU 可能还很闲，HPA 判断"不需要扩"。有效的信号是**业务指标**：

- 队列深度（`vllm:num_requests_waiting`）—— 最诚实的信号
- KV cache 使用率 —— 快满时新请求会被拒
- P95/P99 延迟 —— 直接的 SLO 信号

用 KEDA 可以直接基于 Prometheus 查询伸缩：

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: llm-inference
spec:
  scaleTargetRef:
    name: llm-inference
  minReplicaCount: 1          # 生产环境别设 0
  maxReplicaCount: 8
  cooldownPeriod: 600         # 缩容前先冷静 10 分钟
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        threshold: "4"
        query: avg(vllm:num_requests_waiting)
```

**HPA 的 `minReplicas` 不能是 0**（HPA 没有 0 的概念），只有 KEDA 能做 scale-to-zero。但生产环境一般不建议归零——一次冷启动 2-5 分钟，用户等不了。折中做法是 `minReplicas` 设为峰值的 30% 左右，用钱换响应速度。

**模型权重不要打进镜像。** 这一点在 [Docker 核心概念](article.html?slug=docker-basics) 里说过，在 K8s 里有更好的解法：K8s 1.36 把 **OCI 制品作为卷挂载**（VolumeSource: OCI Artifact）推到了 GA，模型权重可以像镜像一样存在仓库里，然后作为只读卷挂给 Pod——既不用打进镜像，也不用自己写下载逻辑。

另外，**系统内存的 requests 要按模型体积申请**。加载过程中权重会先进系统内存再转显存，如果 requests 按常规 Web 服务设个 8Gi，Pod 会在启动阶段被 OOM kill。经验值是**模型文件大小的 2 倍再加缓冲**。

**推理服务的 `startupProbe` 要给到 300-600 秒。** 默认的 10 秒超时会在模型加载完成前就把 Pod 杀掉，然后无限重启——这是推理服务上 K8s 最常见的新手故障。

## 六、什么时候不要上 Kubernetes

讲了这么多 K8s 的能力，但诚实地说：**大部分项目不该上。**

### 成本对比

先看一眼开销的量级差（仅编排层，不含业务负载）：

| | Docker Compose | K8s（自托管） | k3s（轻量发行版） |
| --- | --- | --- | --- |
| 内存 | 几十 MB | 2-4 GB | 0.5-1 GB |
| 系统进程 | Docker 守护进程 | API Server、etcd、调度器、控制器、kubelet、kube-proxy | 单个二进制 |
| 最低可行配置 | 1GB 内存的机器 | 4GB 起 | 2GB 起 |

托管 K8s（EKS、GKE、AKS 一类）不用自己养控制平面，但有固定的集群管理费（约 70-80 美元/月）加节点费用。**一个 5 美元一个月的单机能跑住的业务，上托管 K8s 后账单涨 20 倍起步。**

### 决策表

按顺序问自己这几个问题，指向 Compose 的项越多，就越不该迁：

| 判断条件 | 指向 Compose | 指向 K8s |
| --- | --- | --- |
| 容量 | 整套服务一台机器装得下 | 已经在多台机器间拆分 |
| 流量形态 | 可预测，峰谷差在 3 倍内 | 突发、按小时级波动 |
| 团队 | 碰基础设施的人少于 3 个 | 有明确的平台负责人或团队 |
| 发布频率 | 一周几次 | 一天多次，且要求零停机 |
| 可用性要求 | 尽力而为，无合同约束 | 有 SLA，单机故障不可接受 |
| 交付对象 | 项目要交给别人运维 | 自己长期运营 |
| 合规 | 无特殊要求 | 需要审计日志、RBAC、网络隔离 |

### 我自己的判断标准

**会上的情况：**

- 服务已经撑爆一台机器，或者单机故障的代价不可接受
- 需要真正的弹性伸缩（不是"可能会需要"）
- 每天多次发布且要求零停机、秒级回滚
- 有多个团队需要在同一套基础设施上独立发布
- 有合规要求，需要 RBAC、审计、网络策略这些原生能力

**不会上的情况：**

- 团队小于 3 人，没人愿意长期背这个运维的锅
- 一台 8C16G 就能扛住全部流量
- 内部工具、定时任务、演示项目、还在验证期的产品
- 单纯因为"K8s 是标准"或者"简历上好看"

中间地带（4-8 人、服务数量尴尬）有个很实在的判断方法：**看你们组有没有人真心愿意长期维护集群。** 有，就上；没有，就先把 Compose 用到极致——把健康检查、资源限制、日志轮转、备份恢复这些基本功做扎实，收获比上一个没人会排障的集群大得多。

### 三个中间选项

如果确实需要多机能力但不想上完整 K8s：

**k3s** —— 单二进制的轻量发行版，0.5-1GB 内存就能跑控制平面，适合过渡期和边缘场景。

**托管容器服务**（Cloud Run、ECS、Container Apps 一类）—— 推镜像上去，设 CPU 和内存，平台负责伸缩和冗余。**这些平台解决的是"我要扩容"和"我要高可用"，而不是"我要 K8s"。** 很多时候这才是正确答案。

**Compose + 反向代理 + 备份** —— 一台机器跑全套，前面挂反向代理做 TLS 和多实例负载均衡，加定时备份并演练恢复。这套方案能撑住的流量比很多人想象的大得多，而且一个人就能完全理解。

## 七、常见误区

**"上了 K8s 就有高可用了。"** 没有。K8s 只保证"Pod 挂了会重建"，不保证你的应用能扛住重建。没配探针，流量照样打进没就绪的 Pod；没配资源限制，节点照样被拖垮；数据写本地卷，Pod 漂走了照样丢。**K8s 把很多"建议"变成了"必须"——不做的话，比单机 Compose 更容易出事。**

**"用云厂商托管版就省心了。"** 托管版只接管控制平面。节点、工作负载、网络、存储、证书、伸缩策略，全还是你的。EKS 不会因为你在用它就自动给你配好探针和资源限制。

**"把数据库也塞进集群，统一了多好。"** 统一的是部署方式，不是运维复杂度。有状态服务在 K8s 里的难度比无状态高一个量级，而且失败代价是数据。除非有非常明确的理由，否则用托管数据库。

**"先上 K8s，以后肯定用得上。"** 这是为想象中的问题提前付费。真实情况是：很多团队上了 K8s 之后，80% 的工作负载永远是 1-3 个固定副本，从来没用过 HPA，也没跨过节点。

**"Compose 只是开发工具，不能上生产。"** 正好相反。配好健康检查、重启策略、日志轮转和反向代理的 Compose，能撑起相当规模的生产业务。它在 2026 年依然是活跃维护的项目，单机场景它是正确选择而不是将就。

**"迁移就是把 compose 文件转一下。"** 用 `kompose convert` 大概能自动完成 70-80%，但生成的是骨架：没有探针、没有资源限制、密钥可能是明文、`depends_on` 直接丢掉。**自动转换的产物必须经过补齐才能上生产**，而真正的工作量恰恰在被丢掉的那部分。

## 小结

**边界**：Docker 管一台机器上的容器怎么跑，K8s 管一群机器上的容器在哪跑、跑几个、挂了怎么办。两者是上下游，不是替代关系——集群里跑的还是 Docker 构建的 OCI 镜像。

**迁移时真正会变的东西**（按踩坑概率排序）：

1. **探针从 1 个变 3 个** —— liveness 查依赖会导致雪崩式重启；慢启动服务必须有 startupProbe
2. **优雅停机有竞态** —— Endpoints 摘除是异步的，用 `preStop: sleep 10` 填窗口，且宽限期包含 preStop 时间
3. **本地卷不再可靠** —— Pod 会漂移，有状态服务要么用共享存储，要么用托管数据库
4. **资源模型多一个维度** —— requests 决定调度和 QoS，不设就是 BestEffort（最先被杀）；CPU 超限是限流，内存超限是 kill
5. **`depends_on` 没有对应物** —— 应用必须能重试依赖，前置任务用 initContainer
6. **网络模型变了** —— Pod IP 会变、默认全通（要显式写 NetworkPolicy）、对外入口从 Ingress 转向 Gateway API（Ingress NGINX 已于 2026-03-24 退役）

**判断该不该上**：看容量、流量形态、团队规模、发布频率、可用性承诺这五项，多数指向 Compose 就先别动。**K8s 买的是自动恢复和滚动发布，代价是一块必须长期有人维护的运维面积。** 能背这个锅就上，背不动就先把 Compose 的基本功做扎实。

**AI 负载额外注意**：GPU 分配正从整数卡转向 DRA；推理服务冷启动 2-5 分钟，HPA 基于 CPU 无效，要改用队列深度和 KV cache 使用率；模型权重走 OCI 制品挂载而不是打进镜像；系统内存按模型体积的 2 倍申请。

回到开头那三个问题：扩容、换机器、不停机发布。它们的解法不是"上 K8s"，而是先问清楚——**这三个问题现在真的在花钱吗？** 如果是，K8s 是成熟的答案；如果只是担心以后会，那先把 Compose 这份文件写好，等痛点真实出现了再迁，成本反而更低。

延伸阅读：[Docker 核心概念与交付流程](article.html?slug=docker-basics)、[Dockerfile 最佳实践](article.html?slug=dockerfile-best-practices)、[Docker Compose 生产配置](article.html?slug=docker-compose-production)、[Docker 排障与交付清单](article.html?slug=docker-troubleshooting)。
