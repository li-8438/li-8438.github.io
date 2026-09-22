/**
 * home.js —— 首页入口
 *
 * 本模块做什么：
 *   1. 装配导航栏/页脚（mountChrome）
 *   2. 并行拉取文章目录与站点配置，渲染 4 张精选文章卡片
 *   3. 填充「现在在写什么」区块
 *   4. 修正首页几个链接的 href（补上 BASE_PATH）
 *
 * 学习要点：
 *   1. 顶层 await（Top-level Await）：这里没有 main() 包裹，模块顶层直接 await。
 *      这是 ES2022 的能力，只在 <script type="module"> 里可用 —— 浏览器会把模块当成一个
 *      大的 async 函数执行。所以 index.html 必须写 type="module"，否则语法报错。
 *   2. Promise.all 并行：catalog 和 site 两份 JSON 互不依赖，一起发比 await 两次快一倍。
 *      ⚠️ 前提是两者都要成功；若其中一个可能失败，就该用 Promise.allSettled。
 *   3. HTML 里 href 先写成相对路径 "./articles.html" 是为了"没 JS 也能跳转"，
 *      JS 加载后再用 withBase 覆盖成带前缀的绝对路径 —— 属于渐进增强。
 *
 * 调用顺序：index.html → 本模块 → chrome.js / content.js / taxonomy.js / config.js。
 */

import { mountChrome, articleCard } from "../chrome.js";
import { loadCatalog, loadSite, featuredArticles } from "../content.js";
import { $ } from "../dom.js";
import { withBase } from "../config.js";
import { articlesHref } from "../taxonomy.js";

// ── 步骤 1：装外壳 ──
await mountChrome();

// ── 步骤 2：并行取数据 ──
// 解构顺序与数组顺序一一对应：Promise.all 的结果顺序由传入顺序决定，而非完成顺序
const [catalog, site] = await Promise.all([loadCatalog(), loadSite()]);

// site.featured 是若干 slug 字符串，这里换成完整的文章对象，且保持配置的先后顺序
const featured = featuredArticles(catalog, site.featured || []);

// ── 步骤 3：修正链接（补 BASE_PATH） ──
$("#browse-link").href = withBase("/articles.html");
$("#about-link").href = withBase("/about.html");
// 两个入口卡片指向"带 section 过滤的列表页"，由 articlesHref 生成查询串
$("#path-notes").href = withBase(articlesHref({ section: "学习笔记" }));
$("#path-essays").href = withBase(articlesHref({ section: "行业思考" }));
$("#view-all").href = withBase("/articles.html");

// ── 步骤 4：渲染精选文章 ──
const grid = $("#featured-grid");
// 没配 featured 时不留空白，而是给一句可操作的提示（告诉用户去改哪个文件的哪个字段）
grid.innerHTML = featured.length
  ? featured.map(articleCard).join("")
  : `<div class="empty glass">还没有指定精选文章。打开 content/site.json，把 featured 写成 4 个文章 slug。</div>`;

// ── 步骤 5：渲染「现在在写什么」 ──
// 全部用 || 兜底：site.json 里 now 字段缺失也不会显示 undefined
const now = site.now || {};
$("#now-title").textContent = now.title || "现在在写什么";
$("#now-text").textContent = now.text || "";
// topics 是字符串数组，逐个包成 .skill-pill 胶囊
$("#now-topics").innerHTML = (now.topics || []).map((t) => `<span class="skill-pill">${t}</span>`).join("");
