---
title: 从 SQLite 到 PostgreSQL 的取舍
slug: sqlite-to-postgres-notes
summary: 个人项目何时该坚持零配置数据库，何时值得迁到 Postgres，以及迁移时要注意的边界。
tags: [SQLite, PostgreSQL, Database]
category: 数据库
published: true
---

SQLite 的最大优点是零配置。对个人博客、本地工具和演示项目，它通常已经足够。

## 继续用 SQLite 的理由

单进程写入、备份就是拷文件、没有独立数据库服务。这些对静态化之前的作品集项目非常友好。

## 考虑 Postgres 的信号

出现并发写入、需要更严格的约束、或准备把服务部署到多实例时，再迁移更合适。

## 迁移时的边界

不要把 SQL 方言写进业务层。类型、分页、JSON 字段和时间处理是最常见的差异点。先把仓储层收干净，迁移成本会低很多。
