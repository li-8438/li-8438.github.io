---
title: Git 分支与远程协作：从开分支到解冲突
slug: git-branch-remote
summary: 分支是 Git 最锋利的工具，也是最容易搞混的地方——合并方向搞反、冲突不会解、push 被拒。这篇把分支操作和远程协作串成一条线：分支怎么开、合并方向怎么记、冲突怎么解、SSH 怎么配，以及那些「push 不上去」的经典场景。
tags: [Git, 版本控制, 协作, 工程工具]
section: 学习笔记
topic: 工程工具
subtopic: Git
published: 2026-09-07
---

上一篇讲了 Git 的三个区域和四种状态，那是单人单机的基础。一旦要和人协作，或者同时推进两件事，就得用分支。

## 一、分支到底是什么

上一节说过，Git 存的是快照。**分支就是一个指向某个快照的指针**，仅此而已。

```text
main:    ●───●───●
                 ↑
              feature
```

创建分支 = 新建一个指针，不复制任何文件。所以开分支几乎零成本、零延迟——这和 SVN 那种"复制整个目录"的分支完全不是一个量级。

还有个指针叫 `HEAD`，它指向**你当前所在的分支**。切分支本质就是移动 `HEAD`。

## 二、分支的增删改查

```bash
git branch              # 查看本地分支列表（前面带 * 的是当前分支）
git branch -a           # 查看所有分支（含远程）
git branch 分支名        # 创建分支（但不切换）
git checkout 分支名      # 切换分支
git checkout -b 分支名   # 创建并切换（最常用）
git branch -d 分支名     # 删除分支
git branch -D 分支名     # 强制删除（分支有未合并的改动时用）
```

几个实操注意点：

**`git checkout 分支名` 有个便利行为**：如果本地没有这个分支，但远程有同名分支，Git 会自动在本地创建并跟踪它。所以从别人那儿接手分支，直接 checkout 就行。

**删除分支时不能在要删的分支上。** 就像不能坐在椅子上把椅子拆了，得先切到别的分支：

```bash
git checkout main
git branch -d feature/old    # 现在才能删
```

**`git branch -d` 删不掉怎么办？** 说明这个分支有还没合并的改动，Git 在保护你。确认那些改动不要了，就用 `-D` 强删。

现代 Git 也可以用更直观的 `git switch`：

```bash
git switch 分支名        # 等价于 git checkout 分支名
git switch -c 分支名     # 等价于 git checkout -b 分支名
```

`switch` 只管切分支，`checkout` 还管恢复文件——职责混在一起，所以 Git 后来拆了这两个命令出来。新的用 `switch` / `restore` 更不容易搞混。

## 三、合并分支：记住"站在谁的角度"

这是最容易搞反的一步。

假设要把 `feature` 合并到 `main`，做法**不是** `git merge main`，而是：

```bash
git checkout main         # 1. 先切到"接收方"
git merge feature         # 2. 把 feature 合进来
```

口诀：**先切到要保留的那个分支，再 merge 要合并进来的分支。**

搞反了的后果是：你站在 `feature` 上 merge 了 `main`，结果改动合到了 feature 上，main 什么都没变。看起来"合并成功了"，其实方向错了。

### 快进合并 vs 三方合并

Git 合并有两种情况：

**快进（Fast-forward）**：`main` 在你开发期间没动过，Git 直接把 `main` 指针往前挪到 `feature` 的位置，不产生新提交。

```text
合并前:  main: ●───●
                    ╲
                feature: ●───●
合并后:  main: ●───●───●───●  (指针前移，无新提交)
```

**三方合并**：`main` 在你开发期间也往前走了，Git 会拿两个分支的最新快照和它们的共同祖先做三方合并，产生一个新的 merge commit。

```text
合并前:  main: ●───●───●
                    ╲
                feature: ●───●
合并后:  main: ●───●───●───◆  (◆ 是新的 merge commit)
                    ╲     ╱
                feature: ●───●
```

想强制产生 merge commit（保留分支历史），用 `git merge --no-ff`。

## 四、冲突：怎么产生的，怎么解

**冲突的本质**：两个分支修改了同一个文件的同一处，Git 不知道该听谁的。

注意，Git 只会在这一种情况下报冲突。如果两个分支改的是**同一个文件的不同位置**，或者**不同的文件**，Git 会自动合并，完全不用你操心。

发生冲突时，文件里会出现这样的标记：

```text
<<<<<<< HEAD
当前分支的内容
=======
要合并进来的分支的内容
>>>>>>> feature
```

`<<<<<<< HEAD` 到 `=======` 之间是你当前分支的内容，`=======` 到 `>>>>>>>` 之间是要合并进来的内容。

解决步骤：

1. **先沟通，再动手。** 冲突往往意味着两个人动了同一块逻辑，正确答案通常是"综合两边"或者"以某一边为准"，这得问人，不该靠猜
2. 手动编辑文件，删掉标记，保留正确的内容
3. `git add 文件名` 标记冲突已解决
4. `git commit` 完成这次合并

大部分编辑器和 IDE 都提供三栏视图（当前 / 共同祖先 / 传入），比手改标记清晰得多，推荐用工具而不是手撕。

解决完冲突，代码处于"已修改"状态，走一遍完整的提交流程：**暂存 → 提交本地 → 推送远程**。

一个重要的经验：**冲突的复杂度和分支存活时间成超线性关系。** 分支活一天，冲突可能就三行；活一个月，可能几百行还理不清。所以勤合并、短分支，不是洁癖，是省时间。

## 五、远程仓库：clone / pull / push

```bash
git clone 项目地址              # 把远程仓库完整复制到本地（第一次用）
git remote -v                   # 查看已关联的远程仓库
git remote add origin 地址      # 关联远程仓库（origin 是习惯命名）
git remote rm origin            # 取消关联（地址填错了时用）
git remote show origin          # 查看远程仓库的详细信息（含所有分支）
git pull                        # 拉取远程改动并合并到本地
git push                        # 把本地提交推送到远程
git push -u origin 分支名        # 第一次推送分支时用 -u 建立跟踪关系
```

`-u` 是 `--set-upstream` 的缩写。第一次推送加 `-u`，之后这个分支直接 `git push` 就行，不用每次都写 `origin 分支名`。

**铁律：先 pull 再 push。**

如果你的本地落后于远程（别人已经推了新提交），直接 `push` 会被拒绝。正确顺序是：

```bash
git pull        # 先把别人的改动拉下来合并
# 有冲突就解决冲突
git push        # 再推自己的
```

而且建议**频繁 pull**，别攒到最后一次性拉——那样冲突会又多又难解。

## 六、两种访问方式：HTTPS 和 SSH

| | HTTPS | SSH |
| --- | --- | --- |
| 配置 | 零配置 | 需要生成并配置密钥 |
| 每次操作 | 要输账号密码（或用凭证助手） | 不用输 |
| 防火墙穿透 | 好（走 443 端口） | 可能受限（走 22 端口） |

### HTTPS 方式

```bash
git config --global user.name "用户名"
git config --global user.email "邮箱"

git remote add origin https://仓库地址
git push -u origin "master"
```

如果地址加错了，不能重复 add，得先删：

```bash
git remote rm origin
git remote add origin https://正确的地址
```

### SSH 方式（推荐）

一次配置，长期免密：

```bash
# 1. 生成密钥对
ssh-keygen -t rsa -b 4096 -C "你的邮箱"
# 一路回车；如果提示输入 y/n，输 y
```

执行完会在用户目录下生成 `.ssh` 文件夹，里面两个文件：

- `id_rsa` —— 私钥，**绝不能外传**
- `id_rsa.pub` —— 公钥，可以公开

然后用文本编辑器打开 `id_rsa.pub`，全选复制，到代码托管平台的 SSH 设置里添加。

测试是否配置成功：

```bash
ssh -T git@gitee.com       # 码云
ssh -T git@github.com      # GitHub
```

看到欢迎信息就说明通了。之后所有 push / pull 都不用再输密码。

**私钥的安全边界**：`id_rsa` 一旦泄露，别人就能以你的身份推代码。不要把它提交进任何仓库，不要发给任何人。换机器时重新生成一对，而不是把私钥拷过去。

## 七、常见"推不上去"的场景

**报错：rejected，non-fast-forward**

远程有你本地没有的提交。先 `git pull` 再 `push`。

**报错：Permission denied (publickey)**

SSH 密钥没配好，或者用的是 HTTPS 地址但没登录。检查 `ssh -T` 是否通，以及 `git remote -v` 看地址是 https 还是 git 开头。

**报错：failed to push some refs**

同第一个，本地落后于远程。

**push 成功但代码没上线**

这通常不是 Git 的问题——推到了错误的分支，或者 CI 没触发。检查 `git branch` 看当前分支，以及推的是不是部署分支。

## 小结

分支和远程协作的核心就几条：

1. **分支是指针**，开分支几乎零成本，别舍不得开
2. **合并方向**：先切到接收方，再 merge 来源方
3. **冲突**：只在同一处被同时修改时产生，先沟通再动手，勤 pull 能大幅降低冲突成本
4. **先 pull 再 push**，频繁同步
5. **SSH 一次配置长期免密**，私钥绝不外传

会用分支之后，下一个问题就是"团队该怎么组织分支"——是全员往 main 上推，还是搞 develop / release 一大套，以及变基和合并到底该选哪个，见 [Git 工作流与提交规范：分支策略怎么选](article.html?slug=git-workflow-strategy)。
