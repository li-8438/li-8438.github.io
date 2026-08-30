# Tech Blog · GitHub Pages 静态博客

纯静态、模块化个人博客。无后端、无数据库、无构建步骤。把仓库推到 GitHub 并打开 Pages 后，即可通过专属网址访问。

视觉参考浅色蓝绿作品集风格：白底、蓝到青绿渐变标题、卡片式文章与关于我页。管理后台、真实评论、服务端统计等 Pages 无法承载的能力已舍弃。

## 目录

```
tech-blog-pages/
├── index.html / articles.html / article.html / about.html
├── 404.html
├── assets/
│   ├── css/main.css
│   ├── js/                 # 配置、内容层、主题、导航、页面入口
│   └── svg/
├── content/
│   ├── site.json           # 首页精选 4 篇 +「现在在写什么」
│   ├── articles.json       # 文章目录（必改）
│   ├── profile.json        # 关于我
│   └── articles/*.md
└── .github/workflows/pages.yml
```

## 本地预览

页面会用 `fetch` 读取 `content/`，不能直接双击 HTML，需要本地静态服务：

```bash
cd tech-blog-pages
python3 -m http.server 4173
```

打开 http://127.0.0.1:4173

## 发布到 GitHub Pages

1. 新建仓库。个人主站建议命名为 `你的用户名.github.io`，访问地址为 `https://你的用户名.github.io`。
2. 把本目录全部文件推上去（不要只推压缩包）。
3. 打开仓库 **Settings → Pages**：
   - 来源选 **Deploy from a branch**，分支 `main`，目录 `/ (root)`；或
   - 来源选 **GitHub Actions**（使用已附带的 workflow）。
4. 等待一两分钟，用专属网址访问。

若仓库名不是 `用户名.github.io`，而是普通项目名，访问地址会变成：

`https://用户名.github.io/仓库名/`

此时打开 `assets/js/config.js`，把 `BASE_PATH` 改成 `"/仓库名"`。

## 新增文章

1. 在 `content/articles/` 新增 Markdown，顶部使用 Front Matter：

```yaml
---
title: 文章标题
slug: my-new-post
summary: 一句话摘要
tags: [RAG, Milvus]
section: 学习笔记
topic: LLM 应用
subtopic: RAG
published: true
---
```

2. 在 `content/articles.json` 增加对应条目，字段与上面一致，`file` 指向该 md。
3. 若要出现在首页精选，把 slug 写入 `content/site.json` 的 `featured`（最多 4 个，按你写的顺序显示，不会自动用最新文章补位）。
4. 提交并推送。

「现在在写什么」改 `content/site.json` 里的 `now.text` 和 `now.topics`。  
个人资料改 `content/profile.json`。站点名、GitHub 链接改 `assets/js/config.js`。

分类树在 `assets/js/taxonomy.js`。

## 已实现 / 已舍弃

已实现：首页双入口、可配置精选文章、现在在写什么、文章页左侧分类树、详情目录与阅读进度、客户端搜索、深浅色、本地点赞、复制链接、相关文章。

已舍弃：独立分类/标签页、管理后台、在线上传、真实评论、阅读量等假统计。
