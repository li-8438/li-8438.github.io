/**
 * articles.js —— 文章列表 / 归档页入口
 *
 * 本模块做什么：
 *   1. 装外壳，拉文章目录
 *   2. 从 URL 参数读出筛选状态（q / section / topic / subtopic）
 *   3. 遍历分类树渲染左侧导航（每项带文章数）
 *   4. 按"分类条件 + 关键词"过滤并渲染卡片，输入框变化时重算
 *
 * 学习要点：
 *   1. 状态来自 URL：?section=学习笔记&topic=LLM%20应用 就是页面的全部状态。
 *      好处是链接可分享、可收藏、刷新不丢；代价是每次点分类都是一次整页跳转
 *      （静态站里可以接受，若要无刷新就得用 history.pushState 自己接管）。
 *   2. 侧边栏是"递归数据 → 扁平 HTML"的典型例子：三层 for 循环展开分类树，
 *      每层缩进靠一个额外的 class（side-section / side-topic / side-sub）控制。
 *      注意这里只固定三层，不是真正的递归 —— 数据也只定义了三层，够用即可。
 *   3. 过滤是"每次全量重算"：输入框每敲一个字就 filter 一遍全部文章并重建 DOM。
 *      几十篇的量级下这比做增量更新简单得多，也不会出错。
 *
 * 调用顺序：articles.html → 本模块 → chrome.js / content.js / taxonomy.js / config.js。
 */

import { mountChrome, articleCard } from "../chrome.js";
import { loadCatalog } from "../content.js";
import { $ } from "../dom.js";
import { withBase } from "../config.js";
import { TAXONOMY, articlesHref, filterArticles } from "../taxonomy.js";

// ── 步骤 1：装外壳 + 取目录 ──
await mountChrome();

const catalog = await loadCatalog();

// ── 步骤 2：从 URL 解析筛选状态 ──
// location.search 是 "?section=xx&topic=yy"，URLSearchParams 提供了 .get() 直接取
const params = new URLSearchParams(location.search);
// state 是页面唯一的可变状态源：输入框事件只改 state.q，再调 apply() 重绘
const state = {
  q: params.get("q") || "",
  section: params.get("section") || "",
  topic: params.get("topic") || "",
  subtopic: params.get("subtopic") || "",
};

/** 判断某个分类条件是否等于当前状态（用于侧栏高亮）。空串与 undefined 视为相等。 */
function isActive(next) {
  return state.section === (next.section || "") && state.topic === (next.topic || "") && state.subtopic === (next.subtopic || "");
}

/**
 * 造一个侧栏条目。
 * 每生成一项都跑一次 filterArticles 算文章数 —— 数据量小，用最直接的方式换取可读性。
 */
function item(label, query, extraClass = "") {
  const href = withBase(articlesHref(query));
  const on = isActive(query);
  const count = filterArticles(catalog, query).length;
  return `<a class="side-link ${extraClass}${on ? " is-on" : ""}" href="${href}">
    <span>${label}</span><small>${count}</small>
  </a>`;
}

// ── 步骤 3：渲染左侧分类树 ──
function renderSide() {
  const parts = [item("全部", {}, "side-all")];   // 第一项：不限分类
  for (const section of TAXONOMY) {
    parts.push(item(section.name, { section: section.name }, "side-section"));
    for (const topic of section.children || []) {
      // ⚠️ 二级必须带上父级 section 一起过滤：不同栏目下可能有同名的 topic
      parts.push(item(topic.name, { section: section.name, topic: topic.name }, "side-topic"));
      for (const sub of topic.children || []) {
        parts.push(item(sub.name, { section: section.name, topic: topic.name, subtopic: sub.name }, "side-sub"));
      }
    }
  }
  $("#article-side").innerHTML = parts.join("");
}

/** 列表标题：优先显示最具体的那一级分类名。 */
function titleForState() {
  return state.subtopic || state.topic || state.section || "全部文章";
}

// ── 步骤 4：过滤 + 渲染 ──
function apply() {
  const q = state.q.trim().toLowerCase();
  // 两段过滤：先按分类，再按关键词
  const list = filterArticles(catalog, state).filter((a) => {
    if (!q) return true;
    // 和全站搜索同一套做法：把可搜字段拼成一个字符串再 includes
    const hay = `${a.title} ${a.summary} ${(a.tags || []).join(" ")} ${a.section} ${a.topic} ${a.subtopic}`.toLowerCase();
    return hay.includes(q);
  });
  $("#list-heading").textContent = titleForState();
  $("#list-count").textContent = `${list.length} 篇`;
  $("#article-list").innerHTML = list.length
    ? list.map(articleCard).join("")
    : `<div class="empty glass">这个分类下还没有文章。把旧文挂到对应的 section / topic / subtopic 即可。</div>`;
}

// ── 步骤 5：首次渲染 + 绑定输入事件 ──
renderSide();
$("#list-search").value = state.q;   // 把 URL 里的 q 回填到输入框，让状态可见
apply();

// 输入即筛选。这里没有防抖：列表最多几十张卡片，每次全量重绘的开销可以忽略
$("#list-search").addEventListener("input", (e) => {
  state.q = e.target.value;
  apply();
});
