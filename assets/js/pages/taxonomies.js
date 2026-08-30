/**
 * taxonomies.js —— 分类 / 标签总览页（categories.html 与 tags.html 共用）
 *
 * 本模块做什么：
 *   1. 装外壳，拉文章目录
 *   2. 用 <body data-page="..."> 区分当前是"分类"还是"标签"模式
 *   3. 统计取值与文章数，渲染成卡片网格，点击跳到对应的归档页
 *
 * 学习要点：
 *   1. 一份代码服务两个页面：靠 body 上的 data-page 分支，避免写两份几乎一样的 JS。
 *      这是"配置驱动"的简化版 —— 页面自己声明身份，脚本按身份分流。
 *   2. 两个模式的差异只有两处：
 *      - 数据源：uniqueValues(catalog, "category") 取单值字段 vs uniqueTags(catalog) 展开数组字段
 *      - 链接参数：?category=xxx vs ?tag=xxx
 *      ⚠️ 注意 articles.html 目前只处理 section/topic/subtopic，不认 category 和 tag 参数，
 *         所以这两个页面的卡片点进去其实会落到"全部文章"。README 里把它们归为"已舍弃"的能力。
 *   3. encodeURIComponent：分类名可能是中文，必须编码后才能放进查询串。
 *
 * 调用顺序：categories.html / tags.html → 本模块 → chrome.js / content.js / config.js。
 */

import { mountChrome } from "../chrome.js";
import { loadCatalog, uniqueValues, uniqueTags } from "../content.js";
import { $ } from "../dom.js";
import { withBase } from "../config.js";

// ── 步骤 1：装外壳 + 取目录 ──
await mountChrome();

const catalog = await loadCatalog();

// ── 步骤 2：按页面身份分流 ──
const mode = document.body.dataset.page;   // "tags" 或 "categories"
const items = mode === "tags" ? uniqueTags(catalog) : uniqueValues(catalog, "category");
const key = mode === "tags" ? "tag" : "category";   // 链接里的参数名

// ── 步骤 3：标题与说明文案 ──
$("#tax-title").textContent = mode === "tags" ? "标签" : "分类";
$("#tax-lead").textContent =
  mode === "tags" ? "按技术标签浏览全部文章。" : "按知识域浏览全栈、大模型与工程实践。";

// ── 步骤 4：渲染卡片 ──
$("#tax-grid").innerHTML = items
  .map(
    (item) => `<a class="tax-card glass" href="${withBase(`/articles.html?${key}=${encodeURIComponent(item.name)}`)}">
      <strong>${item.name}</strong>
      <span>${item.count} 篇文章</span>
    </a>`
  )
  .join("");
