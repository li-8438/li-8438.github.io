---
title: Docker 核心概念与交付流程：镜像、容器和那条从开发到上线的路
slug: docker-basics
summary: Docker 的门槛不在命令，而在搞清「镜像」和「容器」到底什么关系、改了容器为什么重启就没了。这篇从三个核心概念讲起，串起一条完整交付链路：写 Dockerfile → 构建镜像 → 推仓库 → 服务器拉取 → 启动，并说清每一步在解决什么问题。
tags: [Docker, 容器化, 部署, 工程工具]
section: 学习笔记
topic: 工程工具
subtopic: Docker
published: 2026-09-07
---

"在我机器上能跑"这句话之所以成为梗，是因为它后面通常跟着"但在服务器上不行"。环境差异——操作系统版本、依赖库、Python 版本、系统配置——是部署问题的主要来源。

Docker 的思路是：**不装环境，把环境打包带走。**

## 一、三个核心概念

搞清这三个词的关系，Docker 就懂了一半。

### 镜像（Image）

镜像是一个**只读的模板**，里面打包了运行应用所需的一切：代码、运行时、系统工具、系统库、配置。

打个比方：**镜像是类（class），容器是对象（instance）。** 或者更直白——镜像是装机光盘，容器是装好的那台机器。

镜像是分层的。每条 Dockerfile 指令生成一层，层可以被多个镜像复用。这也是为什么拉取第二个镜像往往很快——很多层已经有了。

### 容器（Container）

容器是镜像的**运行实例**。同一个镜像可以同时跑起多个容器，互不干扰。

关键特性：**容器是可丢弃的（ephemeral）**。容器里做的任何修改，重启后就可能没了。这不是 bug，是设计——它逼着你把需要持久化的东西（数据、配置）显式地放到容器外面。

### 仓库（Registry）

存放镜像的地方。公共的有 Docker Hub，私有部署常用 Harbor，云厂商也有自己的镜像仓库服务。

```text
Dockerfile  --build-->  镜像  --push-->  仓库  --pull-->  服务器  --run-->  容器
```

## 二、容器和虚拟机不是一回事

很多人第一反应是"这不就是虚拟机吗"。差别很大：

| | 虚拟机 | 容器 |
| --- | --- | --- |
| 虚拟化层级 | 硬件级（Hypervisor） | 操作系统级（内核共享） |
| 每个实例的操作系统 | 独立 Guest OS | 共享宿主机内核 |
| 启动速度 | 分钟级 | 秒级甚至毫秒级 |
| 磁盘占用 | GB 级 | MB 级 |
| 隔离性 | 强 | 较弱（共享内核） |

虚拟机模拟一整套硬件，在上面装完整操作系统；容器**共享宿主机的内核**，只是在进程层面做隔离。

所以容器轻、快，但隔离性不如虚拟机。需要强隔离（比如跑不可信代码）的场景，还是得用虚拟机，或者在容器外面再套一层。

## 三、一条完整的交付链路

理解了概念，看实际怎么用。

### 第 1 步：写 Dockerfile

Dockerfile 是构建镜像的"菜谱"，一个文件描述整个环境：

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

后面会专门讲怎么写好这个文件，这里先看它在链路里的位置。

### 第 2 步：构建镜像

```bash
docker build -t myapp:1.0.0 .
```

`-t` 给镜像打标签，`1.0.0` 是版本号。最后的 `.` 是构建上下文路径。

### 第 3 步：推到仓库

```bash
docker push registry.example.com/myapp:1.0.0
```

### 第 4 步：服务器拉取并运行

```bash
docker pull registry.example.com/myapp:1.0.0
docker run -d -p 8000:8000 --name myapp registry.example.com/myapp:1.0.0
```

`-d` 后台运行，`-p 8000:8000` 把容器的 8000 端口映射到宿主机的 8000 端口。

**这条链路的核心价值**：构建一次，到处运行。测试环境验证过的那个镜像，就是生产环境跑的那个镜像——不是"同样步骤重新装一遍"，是**同一个二进制产物**。

这和 Git 那篇讲的"推进产物而不是推进提交"是同一个道理：**不要让同一个东西在不同环境被独立构建两次**，那两次构建之间一定有差异。

## 四、镜像标签：别用 latest

```bash
docker build -t myapp:1.2.3 .     # 语义化版本，推荐
docker build -t myapp:git-a1b2c3d .  # 用 commit 哈希，可精确追溯
docker build -t myapp:latest .    # 不推荐作为部署依据
```

`latest` 的问题在于它是个**移动的指针**——今天的 latest 和明天的 latest 可能是完全不同的镜像。用它部署，你不知道线上跑的到底是什么版本，出问题也无法精确回滚。

正确做法：部署时用**不可变的标签**（版本号或 commit 哈希）。`latest` 只作为开发时的便利别名。

## 五、数据怎么办：容器删了数据不能丢

容器的文件系统是临时的。数据库、上传的文件、日志这些必须持久化，有两种方式：

### 卷（Volume）

由 Docker 管理的存储，独立于容器生命周期：

```bash
docker volume create pgdata
docker run -v pgdata:/var/lib/postgresql/data postgres:16
```

容器删了，卷还在，数据不丢。**这是生产环境的首选。**

### 绑定挂载（Bind Mount）

直接把宿主机的目录挂进去：

```bash
docker run -v /host/path:/container/path myapp
```

开发时用得多——改代码立刻生效，不用重新构建。生产环境慎用，因为容器对宿主机路径有写权限，耦合也更强。

判断标准：**需要被 Docker 管理、要随容器迁移的用卷；需要和宿主机共享的用绑定挂载。**

## 六、配置怎么办：环境变量与密钥

配置不应该打进镜像——否则换个环境就得重新构建一次镜像。

正确做法是通过环境变量注入：

```bash
docker run -e DATABASE_URL=postgres://... -e LOG_LEVEL=info myapp:1.2.3
```

或者用 `--env-file`：

```bash
docker run --env-file .env myapp:1.2.3
```

**密钥要格外小心。** 数据库密码、API Key 这类东西，不要写在 Dockerfile 里，也不要用 `ENV` 指令——因为镜像是分层的，**即使你在后面一层删掉，前面那层里依然能看到**。

用 Docker secrets 或者运行时注入（启动容器时传 `-e`，或者从密钥管理服务读取）。

## 七、日常命令速查

```bash
# 镜像
docker images                    # 列出本地镜像
docker build -t name:tag .       # 构建
docker rmi 镜像ID                # 删除镜像
docker history 镜像名            # 查看镜像分层（排查体积用）

# 容器
docker ps                        # 运行中的容器
docker ps -a                     # 所有容器（含已停止）
docker run -d -p 8080:80 镜像名   # 启动
docker stop 容器ID               # 停止
docker start 容器ID              # 启动已停止的
docker rm 容器ID                 # 删除（需先停止）
docker rm -f 容器ID              # 强制删除运行中的

# 查看与调试
docker logs 容器ID               # 看日志
docker logs -f --tail=100 容器ID # 实时跟踪最后 100 行
docker exec -it 容器ID /bin/bash # 进容器内部
docker inspect 容器ID            # 看详细配置
docker stats                     # 实时资源占用

# 清理
docker system prune              # 清理未使用的镜像、容器、网络
docker system prune -a            # 连未被使用的镜像一起清（更彻底）
```

`docker system df` 可以看到 Docker 占了多少磁盘。用久了会发现这东西很能吞空间，定期清理很有必要。

## 八、为什么说 AI 应用更需要容器化

传统 Web 应用的依赖主要是语言运行时和几个库。而大模型应用的依赖要复杂得多：

- 特定版本的 Python 和深度学习框架
- CUDA 驱动版本（和 GPU 强绑定）
- 模型权重文件（动辄几个 GB）
- 向量数据库、缓存、API 服务等多个组件

这带来两个特点：

**一是环境极其敏感。** PyTorch 版本和 CUDA 版本错配，可能编译不过或者运行时崩。容器把这套组合完整固化下来，换机器不用重新踩一遍坑。

**二是多组件协同。** 一个 RAG 服务通常要跑 API、向量库、Redis、MySQL 好几个东西。用 Docker Compose 一份文件把它们编排起来，一条命令全部拉起，是单机部署最省事的方案（见 [Docker Compose 生产配置](article.html?slug=docker-compose-production)）。

需要提醒的是：**模型权重不要打进镜像**。几 GB 的权重会让镜像大到无法传输，而且换模型就得重新构建。正确做法是运行时挂载进去，或者启动时从对象存储拉取。

## 小结

1. **镜像是模板，容器是实例**，仓库是存放镜像的地方
2. **容器可丢弃**——需要持久的数据用卷，配置用环境变量注入
3. **交付链路**：Dockerfile → build → push → pull → run，关键是"构建一次，到处运行"
4. **别用 `latest` 部署**，用版本号或 commit 哈希这种不可变标签
5. **密钥绝不打进镜像**——分层存储意味着删了也能翻出来

下一步是写出像样的 Dockerfile——多阶段构建怎么把 1.2GB 砍到 50MB、层的顺序怎么影响构建速度，见 [Dockerfile 最佳实践：多阶段构建与镜像瘦身](article.html?slug=dockerfile-best-practices)。
