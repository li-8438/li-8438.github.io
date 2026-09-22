---
title: Docker 排障与交付清单：从「起不来」到「敢上线」
slug: docker-troubleshooting
summary: 容器起不来、健康检查失败、端口不通、磁盘半夜写满——这些是线上最常见的 Docker 故障。这篇不讲概念，讲方法论：一套从现象到根因的排查路径，六个高频故障的定位命令，以及一份上线前逐项打勾的交付清单。
tags: [Docker, 排障, 运维, 部署]
section: 学习笔记
topic: 工程工具
subtopic: Docker
published: 2026-09-07
---

Docker 出问题时，最难的不是修，是**不知道从哪儿看起**。容器一闪而过、日志一片空白、健康检查一直转圈——现象都一样，原因千差万别。

这篇给一条固定的排查路径，以及一份上线前的检查清单。

## 一、排障三步法

不管什么故障，按这个顺序来，能覆盖八成问题。

### 第 1 步：看状态

```bash
docker compose ps
```

重点看 `STATUS` 列：

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| `Up (healthy)` | 正常 | 问题不在这层 |
| `Up (health: starting)` | 还在启动宽限期 | 等着，或检查 `start_period` 是否太短 |
| `Up (unhealthy)` | 健康检查失败 | 看第 2 步 |
| `Restarting` | 反复崩溃重启 | 看日志，八成是启动就报错 |
| `Exit 1` | 已退出，退出码 1 | 看日志 |

退出码有讲究：`Exit 0` 是正常退出（可能是一次性任务跑完了），`Exit 1` 是应用报错，`Exit 137` 通常是**被 OOM kill**（内存超限），`Exit 143` 是收到 SIGTERM（正常停止信号）。

### 第 2 步：看日志

```bash
docker compose logs api                  # 看某个服务的全部日志
docker compose logs --tail=100 api       # 只看最后 100 行
docker compose logs -f api               # 实时跟踪
docker compose logs --since 10m api      # 只看最近 10 分钟
```

容器已经退出的，日志还在：

```bash
docker logs 容器ID       # 即使容器停了也能看
```

**看日志的正确姿势是找最后一条错误**，而不是从头读。应用崩溃前打印的堆栈或错误信息，通常直接指明原因。

### 第 3 步：进容器

日志看不出问题，就进容器里实地查看：

```bash
docker compose exec api sh        # 进容器（Alpine 镜像用 sh）
docker compose exec api bash      # Debian 系镜像用 bash
```

进去之后能查：配置文件对不对、环境变量有没有注入、依赖的服务能不能连上、文件权限是否正确。

**注意**：如果 Dockerfile 里用了 distroless 基础镜像，容器里没有 shell，`exec` 会失败。这是 distroless 的代价——调试时得用它的 debug 变体，或者用 `docker cp` 把调试工具拷进去。

## 二、六个高频故障

### 故障 1：容器起来就退出

**现象**：`docker compose ps` 显示 `Exit 1` 或反复 `Restarting`。

**排查**：

```bash
docker compose logs api
docker inspect 容器ID --format='{{.State.ExitCode}}'
```

**常见原因**：

- 应用启动报错（配置缺失、依赖连不上、端口被占用）
- `CMD` 命令写错，容器主进程立刻结束——**容器没有前台进程就会退出**，这是新手最常犯的错
- 配置文件挂载路径不对

**关键点**：容器的生命周期绑定在**主进程**上。主进程结束，容器就退出。所以不要写 `CMD service nginx start` 这种后台启动（启动完命令就返回了），要写前台运行的形式：`CMD ["nginx", "-g", "daemon off;"]`。

### 故障 2：健康检查一直失败

**现象**：状态卡在 `health: starting` 然后变成 `unhealthy`。

**排查**：

```bash
# 看最近几次健康检查的输出和退出码
docker inspect 容器ID --format='{{json .State.Health}}' | python -m json.tool
```

**常见原因**：

- **`start_period` 太短**。服务要 60 秒才起来，你只给了 10 秒宽限
- **镜像里没有健康检查用的工具**。比如用了 `curl` 但镜像里没装 curl（slim 镜像经常没有）
- **检查命令写错**。YAML 里的引号嵌套容易出问题
- **服务真的有问题**，这在 restarted 的策略下会表现为反复重启

**如果镜像没有 curl**，改用语言自带的方式（比如 Python 的 `urllib`），或者用 `wget`（Alpine 自带）。

### 故障 3：端口不通

**现象**：容器在跑，但访问不了。

**排查**：

```bash
docker compose ps                    # 确认端口映射
docker port 容器ID                    # 看实际映射
docker compose exec api sh -c "netstat -tlnp"   # 容器内看监听
```

**常见原因**：

- **应用监听在 `127.0.0.1` 而不是 `0.0.0.0`**。这是最常见的原因——容器内的 localhost 和宿主机的 localhost 不是一回事，监听 `127.0.0.1` 只能容器内访问
- 端口映射写反了。`-p 宿主机端口:容器端口`，顺序别搞错
- 容器间通信用的是**服务名和容器端口**，不是映射出来的宿主机端口

### 故障 4：磁盘被写满

**现象**：所有服务突然一起异常，或者 `no space left on device`。

**排查**：

```bash
df -h                        # 看磁盘
docker system df             # 看 Docker 占了多少
docker system df -v          # 详细，按容器/镜像/卷分类
```

**常见原因**：

- 日志没配轮转（见上一篇的 `max-size` / `max-file`）
- 悬空镜像和停止的容器堆积

**清理**：

```bash
docker system prune          # 清理停止的容器、未使用的网络、悬空镜像
docker system prune -a       # 连未被任何容器引用的镜像一起清
docker volume prune          # 清理未使用的卷（⚠️ 确认没重要数据）
```

**`docker volume prune` 要格外小心**——卷里可能有数据库数据。执行前确认这些卷确实不要了。

应急清理日志：

```bash
# 找到大的日志文件
find /var/lib/docker/containers -name "*.log" -size +100M

# 清空（不建议直接 rm，正在写入的文件句柄会有问题）
truncate -s 0 /var/lib/docker/containers/容器ID/容器ID-json.log
```

治本还是要配日志轮转。

### 故障 5：容器被 OOM kill

**现象**：容器突然消失，`Exit 137`，`docker inspect` 显示 `OOMKilled: true`。

**排查**：

```bash
docker inspect 容器ID --format='{{.State.OOMKilled}}'
docker stats                 # 实时看内存占用
```

**常见原因**：

- 内存限制设得太低
- 应用有内存泄漏
- JVM 类应用没设堆大小，在容器里可能申请超出限制的内存

**处理**：先确认是"限制太低"还是"应用真吃内存"。前者调高 `limits`，后者要查应用。

### 故障 6：容器之间连不通

**现象**：应用连不上数据库，报 `could not translate host name` 或连接超时。

**排查**：

```bash
docker network ls
docker network inspect 网络名          # 看哪些容器在这个网络里
docker compose exec api sh -c "ping db"   # 容器内测试连通性
```

**常见原因**：

- **不在同一个网络**。Compose 会为项目创建默认网络，同一 compose 文件的服务自动互联；跨 compose 文件就要显式配置外部网络
- **用了 `localhost` 而不是服务名**。容器间通信要用**服务名**（如 `db`、`redis`），不是 localhost
- 服务名带下划线导致 DNS 解析失败（老版本 Docker）

## 三、交付清单

代码能跑不等于能交付。上线前逐项对照。

### 部署前

- [ ] 镜像用的是**固定版本标签**，不是 `latest`
- [ ] 镜像跑过漏洞扫描（`docker scout cves` 或 `trivy`），没有高危 CVE
- [ ] Dockerfile 里没有硬编码密钥，也没有 `COPY .env`
- [ ] `.dockerignore` 已配置，`.git` 和 `.env` 被排除
- [ ] 容器以**非 root 用户**运行
- [ ] compose 文件里每个服务都有 healthcheck 和 restart 策略
- [ ] 资源限制已设置，所有容器 limits 之和低于机器可用内存
- [ ] 日志轮转已配置
- [ ] 需要持久化的数据用了卷，不是写在容器可写层
- [ ] 数据库迁移任务是独立的、幂等的，应用等它成功后再启动

### 部署中

- [ ] 先 `pull` 再 `up`，加了 `--remove-orphans`
- [ ] 有回滚方案：上一个版本的镜像标签还在，随时能切回去
- [ ] 数据库变更是**向后兼容**的（先加字段，再改代码，最后删旧字段）
- [ ] 在业务低峰期执行

### 部署后

- [ ] `docker compose ps` 所有服务都是 `Up (healthy)`
- [ ] 应用健康检查端点返回正常（不只是容器健康，业务接口也要验）
- [ ] 关键业务链路手动走一遍
- [ ] 日志里没有新的报错
- [ ] 资源占用在预期范围内
- [ ] 监控和告警已接入（至少要有容器健康状态告警）

**关于"向后兼容的数据库变更"**多说一句。这是部署顺序里最容易出事的环节：如果你先部署了新代码（依赖新字段），再跑迁移，中间那一瞬间服务是坏的。正确顺序是——先加字段（新旧代码都能跑），部署新代码，确认没问题，最后再删旧字段。这个模式叫 expand/contract，牺牲一点速度换取随时可回滚。

## 四、几条运维习惯

**保留最近几个版本的镜像。** 回滚时现构建来不及。

**任何手工操作都要有记录。** 线上 `docker exec` 进去改了什么，事后没人记得，下次部署又被覆盖，然后问题复现。

**`docker compose down` 和 `stop` 要分清。** `down` 会删除容器和网络（卷默认保留），`stop` 只是停止。生产环境误用 `down -v` 会连卷一起删，数据就没了。

**定期演练恢复。** 备份有了不等于能恢复，只有真的恢复过一次，才知道备份是不是有效的。

## 小结

1. **排障三步**：`ps` 看状态 → `logs` 看日志 → `exec` 进容器。退出码能直接指向方向（137 是 OOM）
2. **容器没有前台进程就会退出**，这是"起来就挂"的头号原因
3. **容器间用服务名通信**，应用要监听 `0.0.0.0` 而不是 `127.0.0.1`
4. **日志轮转和定期清理**能避免半夜被磁盘告警叫醒
5. **交付清单的价值在于把"记得做"变成"勾过一遍"**——尤其是回滚方案和向后兼容的迁移

到这里 Docker 四篇完整了：核心概念与交付流程、Dockerfile 最佳实践、Compose 生产配置、排障与交付清单。
