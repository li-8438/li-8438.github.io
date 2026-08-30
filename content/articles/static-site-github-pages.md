---
title: 用 GitHub Pages 发布模块化静态博客
slug: static-site-github-pages
summary: 不依赖后端与数据库，用 Markdown + 静态资源把个人博客发布到专属 Pages 网址。
tags: [GitHub Pages, Static, Architecture]
category: 架构设计
published: true
---

GitHub Pages 适合承载“内容变化慢、访问以阅读为主”的个人站点。它不能跑数据库，也不该承担后台写接口。

## 内容与页面分离

文章以 Markdown 为唯一来源，页面只负责排版和导航。新增一篇文章时，更新正文文件和目录清单即可。

## 仓库形态

用户站使用 `username.github.io` 作为仓库名，访问地址最短。项目站需要给前端配置仓库前缀，否则静态资源会 404。

## 发布流程

本地预览确认后推送到默认分支，在仓库 Settings 中打开 Pages。此后每次更新 Markdown 并推送，站点就会刷新。

## 主动放弃的能力

在线编辑、真实评论、跨用户统计需要额外服务。静态站可以把这些做成本地点赞、复制链接和客户端搜索，而不引入后端。
