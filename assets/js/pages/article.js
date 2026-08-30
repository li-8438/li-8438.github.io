/**
 * article.js —— 文章详情页入口（本项目中逻辑最重的一个页面模块）
 *
 * 本模块做什么：
 *   1. 从 URL 读 slug，加载文章；不存在则显示兜底提示
 *   2. Markdown 渲染成 HTML，同时拿到目录 toc，拼出整页结构（左侧目录 + 信息卡 + 正文）
 *   3. 渲染相关文章（按标签/分类相似度）
 *   4. 绑定点赞、复制链接两个交互
 *   5. 监听滚动：更新顶部阅读进度条 + 高亮当前所在的目录项
 *
 * 学习要点：
 *   1. 整页一次性 innerHTML：先拼好一大段 HTML 再塞进 #article-root，
 *      比逐节点 createElement 代码量小得多。代价是要自己保证拼接内容可信
 *      （Markdown 正文已经在 renderMarkdown 里 escapeHtml 过，所以安全）。
 *   2. 阅读进度：max = scrollHeight - innerHeight 是"还能往下滚多少像素"，
 *      用它做分母，滚到底部才刚好 100%。⚠️ 直接拿 window.scrollY / scrollHeight 永远到不了 100%。
 *   3. 目录高亮用"最后一个已滚过屏幕上方 120px 的标题"作为当前节：
 *      遍历所有标题，只要 getBoundingClientRect().top <= 120 就把它记为 current，
 *      遍历完自然留下最靠下的那个。120 是给吸顶导航留的余量。
 *   4. 滚动监听传 { passive: true }：告诉浏览器"我不会 preventDefault"，
 *      浏览器就能放心地异步处理滚动，避免掉帧。
 *   5. 可选链 ?. 的使用：$("#like-btn") 查不到时 ?.addEventListener 静默跳过，
 *      比 if (btn) 更省字。同理 related 为空时 #related 保持空节点。
 *
 * 调用顺序：article.html → 本模块 → chrome.js / content.js / markdown.js / dom.js / config.js。
 */

import { mountChrome, articleCard } from "../chrome.js";
import { loadArticle, loadCatalog, relatedArticles, getLikes, toggleLike } from "../content.js";
import { renderMarkdown } from "../markdown.js";
import { $, formatDate, readingMinutes } from "../dom.js";
import { SITE, withBase } from "../config.js";

// ── 步骤 1：装外壳 + 取文章 ──
await mountChrome();

const slug = new URLSearchParams(location.search).get("slug");
const article = slug ? await loadArticle(slug) : null;

// 没传 slug 或 slug 在目录里查不到（未发布 / 拼错）→ 给出可返回的提示，不留白屏
if (!article) {
  $("#article-root").innerHTML = `<div class="empty glass">文章不存在或尚未发布。<a href="${withBase("/articles.html")}">返回列表</a></div>`;
} else {
  // 改标签页标题，方便在浏览器标签栏/历史记录里辨认
  document.title = `${article.title} · ${SITE.name}`;
  const { html, toc } = renderMarkdown(article.content);
  const minutes = readingMinutes(article.content);
  const liked = getLikes(article.slug);

  // ── 步骤 2：整页渲染 ──
  $("#article-root").innerHTML = `
    <div class="reading-progress" aria-hidden="true"><i id="read-bar"></i></div>
    <div class="crumb"><a href="${withBase("/articles.html")}">文章</a><span>/</span>${article.section || ""}${article.topic ? " / " + article.topic : ""}${article.subtopic ? " / " + article.subtopic : ""}</div>
    <article class="article-layout">
      <aside class="article-aside">
        <div class="glass sticky-card">
          <div class="aside-title">目录</div>
          <nav class="toc" id="toc">${
            toc.length
              ? toc
                  .map(
                    // toc-lv1/2/3 控制缩进层级，href="#id" 靠浏览器原生锚点跳转
                    (t) =>
                      `<a class="toc-link toc-lv${t.level}" href="#${t.id}">${t.title}</a>`
                  )
                  .join("")
              : `<p class="muted">本文暂无目录</p>`
          }</nav>
        </div>
        <div class="glass sticky-card meta-card">
          <div class="aside-title">文章信息</div>
          <dl>
            <dt>发布时间</dt><dd>${formatDate(article.date)}</dd>
            <dt>阅读时长</dt><dd>约 ${minutes} 分钟</dd>
            <dt>栏目</dt><dd>${article.section || "—"}</dd>
            <dt>分类</dt><dd>${[article.topic, article.subtopic].filter(Boolean).join(" / ") || "—"}</dd>
          </dl>
          <div class="share-row">
            <button type="button" id="like-btn" class="share-btn${liked ? " is-on" : ""}">${liked ? "已点赞" : "点赞"}</button>
            <button type="button" id="copy-btn" class="share-btn">复制链接</button>
          </div>
        </div>
      </aside>
      <div>
        <header class="article-hero glass">
          <div class="pill-row">${[article.section, article.subtopic || article.topic, ...(article.tags || [])]
            .filter(Boolean)
            .map((t, i) => `<span class="pill${i === 0 ? " pill-accent" : ""}">${t}</span>`)   // 第一枚胶囊高亮成主题色
            .join("")}</div>
          <h1>${article.title}</h1>
          <p>${article.summary}</p>
          <div class="author-row">
            <div class="mini-avatar">${SITE.author.slice(0, 1)}</div>
            <div><strong>${SITE.author}</strong><span>${SITE.tagline}</span></div>
            <div class="article-stats">
              <span>${formatDate(article.date)}</span>
              <span>${minutes} min</span>
            </div>
          </div>
        </header>
        ${article.diagram === "llm-arch" ? `<div class="arch-board glass">${archBoard()}</div>` : ""}
        <div class="markdown glass">${html}</div>
        <section class="related" id="related"></section>
      </div>
    </article>
  `;

  // ── 步骤 3：相关文章 ──
  const catalog = await loadCatalog();
  const related = relatedArticles(catalog, article);
  if (related.length) {
    $("#related").innerHTML = `<h2>相关文章</h2><div class="article-grid">${related.map(articleCard).join("")}</div>`;
  }

  // ── 步骤 4：点赞 / 复制链接 ──
  $("#like-btn")?.addEventListener("click", (e) => {
    const on = toggleLike(article.slug);
    // 用 currentTarget 而不是 target：点到的可能是按钮内部的文本节点
    e.currentTarget.classList.toggle("is-on", on);
    e.currentTarget.textContent = on ? "已点赞" : "点赞";
  });
  $("#copy-btn")?.addEventListener("click", async (e) => {
    // navigator.clipboard 只在 HTTPS 或 localhost 下可用
    // ⚠️ 用 file:// 双击打开页面时它会是 undefined，这里会抛错 —— 所以本站点必须用 http 服务预览
    await navigator.clipboard.writeText(location.href);
    e.currentTarget.textContent = "已复制";
    setTimeout(() => (e.currentTarget.textContent = "复制链接"), 1600);   // 1.6 秒后把文案改回去
  });

  // ── 步骤 5：滚动联动（进度条 + 目录高亮） ──
  const bar = $("#read-bar");
  const links = [...document.querySelectorAll(".toc-link")];   // 转成数组以便用 forEach
  // 按 toc 顺序取出真实的标题 DOM；filter(Boolean) 去掉 id 对不上的（理论上不会发生）
  const heads = toc.map((t) => document.getElementById(t.id)).filter(Boolean);

  const onScroll = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;   // 可滚动的总距离
    // 页面比视口还短时 max <= 0，此时直接给 0，避免出现 NaN 或 Infinity
    const pct = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
    if (bar) bar.style.width = `${pct}%`;

    // 找出"最后一个已经滚到视口上方 120px 以内"的标题，它就是当前节
    let current = heads[0];
    for (const h of heads) {
      if (h.getBoundingClientRect().top <= 120) current = h;
    }
    // 逐个比对 href，命中才加 is-active
    links.forEach((a) => a.classList.toggle("is-active", current && a.getAttribute("href") === `#${current.id}`));
  };

  document.addEventListener("scroll", onScroll, { passive: true });
  onScroll();   // 先跑一次，让刚进页面时进度条和目录就处于正确状态
}

/**
 * 「整体架构」示意图（仅在文章 Front Matter 里写了 diagram: llm-arch 时插入）。
 *
 * 这是"用数据渲染小图表"的最小实现：一个二维数组 → 四列卡片。
 * 每层第一个元素是列标题（.arch-h），后面两个是列内的节点（.arch-n）。
 * 想加第五层或改节点，改 cols 数组即可，不用碰 HTML。
 */
function archBoard() {
  const cols = [
    ["数据层", "数据采集", "数据处理"],
    ["模型层", "模型训练", "模型评估"],
    ["服务层", "API 服务", "监控告警"],
    ["应用层", "Web 应用", "移动应用"],
  ];
  return `<div class="arch-title">整体架构</div><div class="arch-flow">${cols
    .map(
      (c) =>
        `<div class="arch-col"><div class="arch-h">${c[0]}</div><div class="arch-n">${c[1]}</div><div class="arch-n">${c[2]}</div></div>`
    )
    .join("")}</div>`;
}
