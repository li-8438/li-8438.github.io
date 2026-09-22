---
title: Git 工作流与提交规范：分支策略怎么选，rebase 还是 merge
slug: git-workflow-strategy
summary: "分支策略没有标准答案，但选错代价很大：要么流程重得走不动，要么 main 上天天出问题。这篇对比四种主流工作流（Trunk-Based / GitHub Flow / GitFlow / Release Flow）的适用场景，讲清 rebase 和 merge 的安全边界，以及 Conventional Commits 为什么不只是形式主义。"
tags: [Git, 工作流, 代码评审, 工程工具]
section: 学习笔记
topic: 工程工具
subtopic: Git
published: 2026-09-07
---

学会了开分支和合并，接下来是团队层面的问题：**大家应该怎么组织分支？**

这个问题没有标准答案，但有明确的错误答案——比如给一个每周部署十几次的 SaaS 项目上 GitFlow，或者给一个要同时维护三个版本的企业软件搞 Trunk-Based。

## 一、四种主流工作流

### Trunk-Based Development（主干开发）

所有人往 `main` 上合，分支存活时间以**小时**计，通常不超过一到三天。没做完的功能用**特性开关（feature flag）**藏起来，代码进主干但行为不生效。

```text
main:  ●──●──●──●──●──●──●──●
          ↑     ↑        ↑
       短分支  短分支   短分支
```

**适合**：持续部署的 SaaS、微服务、有可靠 CI 和测试的团队。

**代价**：要求 CI 快且可信，要求团队有写测试的习惯，需要有特性开关的机制。如果这几个条件不满足，主干会变成"谁都能弄坏"的地方。

**判断标准**：如果你做不到每天往主干合并（DORA 给高性能团队的定义），先修 CI，别用分支去掩盖 CI 的问题。

### GitHub Flow

Trunk-Based 的轻量版。`main` 永远可部署，每个改动开一个分支，通过 PR 评审后合并。

流程就五步：从 main 开分支 → 提交 → 开 PR → 评审 + CI 通过 → 合并。

**适合**：大多数 Web 团队。这是最省心的默认选择。

**风险**：分支容易堆积。不删的分支会变成"僵尸分支"，几个月后没人敢动。

### GitFlow

`main`（生产）+ `develop`（集成分支）+ `feature/*` + `release/*` + `hotfix/*`，五个角色。

| 分支 | 作用 | 从哪来 | 合到哪去 |
| --- | --- | --- | --- |
| main | 生产代码，打 tag | — | — |
| develop | 下个版本的集成 | main | — |
| feature/* | 新功能 | develop | develop |
| release/* | 发布准备、RC 测试 | develop | main + develop |
| hotfix/* | 生产紧急修复 | main | main + develop |

**适合**：有明确版本号的产品、需要同时维护多个已发布版本、有合规审计要求的场景。典型是移动端 App、桌面软件、私有化部署的企业软件。

**代价**：重。分支多、合并路径长，长期分支带来的合并地狱是真实存在的。

**什么时候不该用**：一个每天部署多次的 Web 应用。那套 develop → release → main 的晋升流程纯属仪式，不产生任何价值。

### Release Flow

主干开发 + 按节奏切 `release/x.y` 分支。新功能只进 main，发布分支上只 cherry-pick 修复，绝不 cherry-pick 新功能。

**适合**：卖给企业客户、客户会锁定版本、你需要给每个小版本打补丁的场景。

## 二、怎么选

| 工作流 | 分支结构 | 适合 | 主要成本 |
| --- | --- | --- | --- |
| Trunk-Based | main + 极短分支 | 高频部署、CI 可靠 | 要求强测试 + 特性开关 |
| GitHub Flow | main + 短功能分支 | 大多数 Web 团队 | 分支易堆积，需纪律 |
| GitFlow | main/develop/feature/release/hotfix | 版本化产品、多版本并行 | 流程重，合并地狱 |
| Release Flow | main + release/x.y | 企业交付、版本锁定 | cherry-pick 纪律 |

几条决策原则：

**默认选 GitHub Flow。** 它足够简单，又能覆盖绝大多数场景。

**除非你真的在同时维护多个已发布版本，否则不要上 GitFlow。** 很多团队上 GitFlow 是因为"大公司都这么干"，但那些公司往往有你要解决的那个具体问题（版本并行、合规审计），而你没有。

**Trunk-Based 是目标，不是起点。** 它要求 CI 能在几分钟内跑完并值得信任。测试套件跑两小时的团队硬上主干开发，只会把主干变成雷区。

**不要按环境建分支。** 不要搞 `dev` 分支对应测试环境、`staging` 分支对应预发。正确做法是**构建一次产物，把它依次推进各个环境**（promote artifacts, not commits）。按环境建分支会导致同一个 commit 在不同环境行为不一致。

## 三、rebase 还是 merge

这是 Git 最经典的争论。两者做的事完全不同：

**merge** 把两个分支的最新提交和它们的共同祖先做三方合并，产生一个新的 merge commit，保留完整的分支拓扑。

**rebase** 把你分支上的提交"摘下来"，在目标分支的最新提交上依次重放，改写成一条直线，不留 merge commit。

### 黄金法则

> **不要对已经推送出去、且别人可能基于它工作的提交执行 rebase。**

这条不是风格建议，是硬规则。违反它的后果是：你 force-push 改写了历史，别人下次 `git pull` 会把你的新提交和他本地的旧提交混在一起，历史里出现一堆重复的 commit，还可能引发莫名其妙的冲突。

安全边界很清晰：

- **可以 rebase**：只在你本地、从未 push 过的提交
- **可以 rebase**：已 push 但确定没人基于它工作的分支（比如只有你一个人用的功能分支）
- **绝不 rebase**：共享分支，尤其是 `main`、`develop`

### 日常该怎么用

**开发过程中用 rebase 同步主干**，让自己的分支始终基于最新的 main：

```bash
git checkout feature/login
git rebase main        # 把 login 的改动重放到最新 main 上
```

这样你的 PR diff 是干净的——只有你真正的改动，没有一堆"Merge branch 'main'"的噪音。

**合并到主干时用 merge**（或者说，PR 的合并按钮点下去就是 merge，保持默认即可）。

一句话总结：**变基在推送前，合并在共享后。**

懒人配置，让 `git pull` 自动用 rebase，避免拉取时产生一堆无意义的 merge commit：

```bash
git config --global pull.rebase true
```

### 三种 PR 合并方式

| 方式 | 结果 | 什么时候用 |
| --- | --- | --- |
| Merge commit | 保留完整分支历史和合并节点 | 需要审计轨迹、长期分支 |
| Squash merge | 整个 PR 压成一个 commit | **多数团队的默认选择**，main 历史干净 |
| Rebase merge | 线性历史，无合并节点 | 提交序列本身有意义时（重构和行为变更分开） |

**团队内要统一选一种。** 混着用会让 `git log --graph` 完全没法看。Squash merge 是大多数团队的合理默认——main 上一条 PR 一个 commit，回溯时非常清爽。

## 四、Conventional Commits：不只是好看

格式是这样的：

```text
type(scope): 简短描述

可选的正文，解释为什么这么改

Closes #123
```

常用 type：

| type | 含义 |
| --- | --- |
| feat | 新功能 |
| fix | 修 bug |
| docs | 文档 |
| refactor | 重构（不改行为） |
| test | 测试 |
| chore | 构建/依赖等杂项 |
| perf | 性能优化 |
| ci | CI 配置 |

示例：

```bash
git commit -m "fix(auth): 修复并发登录时会话串号的问题"
git commit -m "feat(rag): 新增 FAQ 直出快速路径"
git commit -m "refactor(retrieval): 抽出检索计划构建逻辑"
```

**为什么值得坚持？不是因为好看，而是因为它能被机器解析，从而驱动自动化：**

1. **自动生成 changelog**——`semantic-release`、`release-please` 这类工具直接读提交历史生成发布说明，不用人手写
2. **自动版本号**——`feat` → 小版本，`fix` → 补丁版本，`BREAKING CHANGE` → 大版本，语义化版本自动推进
3. **可检索**——`git log --grep="^fix(auth)"` 能精确筛出某个模块的所有修复

这就是"格式即数据"的价值：提交信息从给人看的备注，变成了给工具用的结构化输入。

## 五、PR 与评审的几条实操建议

**PR 要小。** 目标是 400 行以内。大 PR 的问题不是评审慢，而是**没人真的看**——评审者扫两眼就点通过了，缺陷就这么进去。

**提交前先自己审一遍 diff。** 你会发现大量低级问题，省掉一轮往返。

**描述写清楚三件事**：改了什么、为什么改、怎么验证。UI 改动附截图或录屏，十秒录屏抵得上千言万语。

**区分"必须改"和"建议改"。** 评审时把"这里会空指针"和"这个变量可以换个名字"分开说，前者阻塞，后者不阻塞。

**用 draft PR 标记未完成的工作**，让别人知道可以看但别急着审。

**及时清理已合并的分支**，避免僵尸分支堆积。

## 小结

1. **默认 GitHub Flow**；有版本化/多版本需求再考虑 GitFlow；CI 又快又可信才上 Trunk-Based
2. **绝不按环境建分支**，推进产物而不是推进提交
3. **rebase 在推送前，merge 在共享后**——永远不要 rebase 别人可能基于其工作的提交
4. **团队统一一种 PR 合并方式**，squash 是合理默认
5. **Conventional Commits 的价值在于驱动自动化**（changelog、语义化版本），不只是好看

再往后是 Git 的高阶用法——误 reset 了怎么救、怎么二分定位引入 bug 的那次提交、怎么临时切走手上的活，见 [Git 高级命令与救援：reflog、bisect、stash](article.html?slug=git-advanced-rescue)。
