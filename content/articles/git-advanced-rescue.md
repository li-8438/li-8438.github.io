---
title: Git 高级命令与救援：reflog、bisect、stash 与撤回的三种力度
slug: git-advanced-rescue
summary: 会用 add/commit/push 只是入门，真正的分水岭是出事之后——误 reset 了怎么找回、哪个提交引入了 bug 怎么定位、手上的活没写完却要切分支怎么办。这篇讲 Git 的「后悔药」体系：reflog 安全网、reset 三档力度、revert 与 reset 的取舍、bisect 二分定位、stash 与 worktree。
tags: [Git, 排障, 版本控制, 工程工具]
section: 学习笔记
topic: 工程工具
subtopic: Git
published: 2026-09-07
---

前面三篇讲的是"怎么往前走"。这篇讲"怎么往回退"——以及更重要的一点：**Git 里绝大部分操作其实都是可恢复的**，前提是知道去哪儿找。

## 一、reflog：Git 的安全网

这是最重要的一条命令，也是最少人知道的：

```bash
git reflog
```

它记录的是 **`HEAD` 的每一次移动**——每次 commit、checkout、reset、rebase、merge，都会留下一条记录。

```text
a1b2c3d HEAD@{0}: reset: moving to HEAD~2
e4f5g6h HEAD@{1}: commit: feat(rag): 新增 FAQ 直出
i7j8k9l HEAD@{2}: commit: fix(auth): 修复会话串号
```

看第一列那串哈希——**那就是你以为已经丢失的提交**。

### 实战：误 reset 的救援

场景：你 `git reset --hard` 回退了两个版本，然后发现回退错了，那两个提交里有重要代码。

```bash
git reflog                        # 找到 reset 之前的那个哈希
git reset --hard e4f5g6h          # 回到那个位置
```

代码就回来了。整个过程十秒钟。

**关键认知**：`git reset --hard` 并没有删除提交，它只是把分支指针挪走了，把那些提交变成了"孤儿"。只要 reflog 还记得它们，就能找回来。

reflog 的记录默认保留 **90 天**（未被引用的对象 30 天后才可能被 GC 回收）。所以真出事了别慌，也**别急着跑 `git gc`**，先查 reflog。

新手和高手的区别往往就在这：新手以为 `reset --hard` 删掉了工作，高手知道它只是挪了个指针。

不过要说明白：**reflog 救不了未提交的改动**。工作区里改了但没 commit 的内容，`checkout --` 或 `reset --hard` 清掉就是真清掉了。所以还是那句话——重要的改动先提交，提交了就基本安全。

## 二、撤回的三种力度：reset 的三种模式

`git reset` 有三个档位，区别只在于"退回之后，改动留在哪"：

| 模式 | 分支指针 | 暂存区 | 工作区 | 用途 |
| --- | --- | --- | --- | --- |
| `--soft` | 回退 | 保留 | 保留 | 想重新组织这几个提交 |
| `--mixed`（默认） | 回退 | 清空 | 保留 | 想重新挑要提交哪些文件 |
| `--hard` | 回退 | 清空 | **清空** | 彻底丢弃，危险 |

```bash
git reset --soft HEAD~1     # 撤销上次 commit，改动还在暂存区
git reset HEAD~1            # 撤销上次 commit 和 add，改动还在工作区
git reset --hard HEAD~1     # 撤销并彻底丢弃改动
```

**`--hard` 是唯一会丢数据的那个**，用之前务必确认改动已经不需要，或者已经 commit 过。

一个高频用法：**撤销上一次提交但保留改动**，重新整理后再提交：

```bash
git reset --soft HEAD~1     # 上次的提交被撤销，改动回到暂存区
# 改改文件，补上忘加的东西
git commit -m "更准确的提交信息"
```

## 三、revert vs reset：什么时候绝对不能用 reset

两者都能"回到过去"，但机制完全不同：

- **`reset` 改写历史**——把指针挪回去，后面的提交从这条分支的历史里消失
- **`revert` 新增提交**——创建一个新提交，内容是把某个旧提交的改动反向抵消

```bash
git revert 哈希值        # 生成一个"反向提交"，抵消那次的改动
```

**判断标准只有一条：这个提交有没有被推送到共享分支？**

- **没推送**（只在本地）→ 用 `reset`，干净利落
- **已推送到 main/develop 等共享分支** → 必须用 `revert`

原因是：如果你 reset 了一个别人已经拉到本地的提交，然后 force-push，所有人的本地历史就和远程分叉了，接下来是一连串的混乱。`revert` 不改写历史，只是在后面追加一个"这次改错了，撤回来"的记录，所有人正常 pull 就能同步。

一句话：**公开历史只追加，不改写。**

## 四、stash：手上的活没干完要切走

场景：你正在改代码，改到一半，突然要切到另一个分支修个紧急 bug。直接切会把未提交的改动带过去，不提交又不想留一个"wip"的脏提交。

```bash
git stash                      # 把工作区和暂存区的改动暂存起来，工作区变干净
git stash push -m "wip: 登录重构"  # 带说明，推荐
git stash list                 # 看所有暂存
git stash pop                  # 恢复最近一次暂存，并从列表删除
git stash apply                # 恢复但保留在列表（可能多次应用到不同分支）
git stash drop                 # 删除某条暂存
git stash clear                # 清空所有
```

切回来之后 `git stash pop`，改动原样回来。

一个有用但少用的参数：

```bash
git stash push -m "wip" --keep-index
```

`--keep-index` 只暂存工作区的改动，**保留暂存区的内容**。适合"我已经 add 了一部分，想把剩下的先收起来"。

**stash 不是长期存储。** 它存在本地，容易忘，也不好检索。如果一件"暂时放下的活"可能超过一天，正经开个分支提交上去更靠谱。

## 五、bisect：二分法定位引入 bug 的提交

场景：某个功能昨天还好好的，今天坏了，中间有几十个提交。怎么找出是哪一次搞坏的？

手工一个个 checkout 试太慢，用 `bisect` 做二分查找——**几十个提交只要五六次就能定位**。

```bash
git bisect start              # 开始
git bisect bad                # 标记当前版本是坏的
git bisect good v1.4.0        # 标记某个已知的好版本（也可用哈希）

# Git 会自动切到中间某个提交，你测试后告诉它好坏：
git bisect bad                # 这个版本有问题
git bisect good               # 这个版本没问题

# 重复几轮后，Git 会告诉你：
# a1b2c3d is the first bad commit

git bisect reset              # 结束后回到起点
```

每次 Git 切到一个提交，你就跑一下测试或者手动验证，然后告诉它 good 还是 bad。它自动二分，log₂(50) ≈ 6 次就能在 50 个提交里定位。

如果能写成脚本，还能全自动：

```bash
git bisect run ./test.sh      # test.sh 退出码 0 = good，非 0 = bad
```

这在排查"哪次改动引入了性能退化"这类问题上极其实用，比人肉翻提交历史高效太多。

## 六、cherry-pick：把某个提交单独搬过来

想把另一个分支上的**某一个**提交拿过来，而不是合并整个分支：

```bash
git cherry-pick 哈希值
git cherry-pick -x 哈希值     # -x 会在提交信息里记录原始提交哈希，便于追溯
```

典型场景：hotfix 分支上修了个 bug，需要把这个修复单独搬到 release 分支。

前面讲 Release Flow 时说过"发布分支上只 cherry-pick 修复，绝不 cherry-pick 新功能"，用的就是这条命令。

## 七、worktree：同时开多个工作区

场景：你要在 `feature-a` 上开发，同时 `main` 上有个紧急 bug 要修。切来切去很烦，stash 也麻烦。

```bash
git worktree add ../proj-hotfix hotfix/critical
```

这会在 `../proj-hotfix` 目录创建一个**独立的工作目录**，检出 `hotfix/critical` 分支，和你的主工作区互不干扰。两边可以同时编译、同时跑测试，不用切分支也不用 stash。

```bash
git worktree list             # 查看所有工作区
git worktree remove ../proj-hotfix   # 用完删掉
```

## 八、大仓库优化

如果仓库很大（比如 monorepo 或者塞了很多历史文件的老仓库），这两个命令能大幅提速：

```bash
# 只下载元数据，需要时再按需拉取文件内容（blob:none）
git clone --filter=blob:none --sparse 仓库地址

# 只检出你关心的目录
git sparse-checkout set src/billing src/shared
```

克隆时间能从几十分钟降到几分钟，磁盘占用也小得多。

## 小结

Git 的"后悔药"体系，记住这五条就够用：

1. **reflog 是安全网**——几乎所有操作都可恢复，提交过的东西 90 天内都能找回
2. **reset 三档**：`--soft` 保留暂存区、`--mixed` 只留工作区、`--hard` 全丢（唯一危险的）
3. **已推送的提交只能 revert，不能 reset**——公开历史只追加不改写
4. **bisect 二分定位**，几十个提交五六次就找到引入 bug 的那次
5. **stash 临时存、worktree 长期开**，别用 stash 当长期存储

到这里 Git 四篇就齐了：概念与状态、分支与协作、工作流与规范、高级与救援。下一块是容器化——[Docker 核心概念与交付流程](article.html?slug=docker-basics)。
