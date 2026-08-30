/**
 * chrome.js —— 站点"外壳"（导航栏 + 页脚 + 搜索弹层 + 文章卡片模板）
 *
 * 本模块做什么：
 *   1. mountChrome    —— 每个页面共用的顶部导航和底部页脚，由 JS 注入而非写死在 HTML 里
 *   2. 搜索弹层       —— 全站客户端搜索（⌘K / Ctrl+K 唤起），数据在内存里过滤，不走网络
 *   3. articleHref    —— 文章详情链接的统一构造
 *   4. coverVariant   —— 按文章分类挑一种封面配色
 *   5. articleCard    —— 文章卡片 HTML 模板（首页、列表页、相关文章共用）
 *
 * 学习要点：
 *   1. 为什么导航用 JS 渲染：7 个 HTML 页面如果各写一份 <header>，改一个导航项要改 7 处。
 *      现在每个 HTML 只留一个空的 <header class="top-nav"></header>，由 mountChrome 填充。
 *      代价是首屏导航会晚一帧出现 —— 静态站里这个取舍是划算的。
 *   2. 当前页高亮靠 body 上的 data-page：每个 HTML 在 <body data-page="home"> 里声明自己的身份，
 *      navLink 拿它和导航项比对后加 is-active。这是"数据驱动 UI"的最小例子。
 *   3. 事件用委托（delegate）而不是逐个绑定：header 上挂一个 click 监听，
 *      用 e.target.closest("[data-open-search]") 判断点到了谁。
 *      好处是后来动态插入的节点也自动生效，不用重新绑定。
 *   4. 搜索是纯前端的：目录一共就几篇到几十篇，全量拉进内存做 includes 匹配足够快，
 *      没必要上索引库。命中后只展示前 8 条，避免弹层被撑爆。
 *
 * 调用顺序：pages/*.js 的顶层 → mountChrome() → theme.js / content.js / config.js。
 */

import { SITE, withBase } from "./config.js";
import { $, el } from "./dom.js";
import { loadCatalog } from "./content.js";
import { initTheme, toggleTheme, currentTheme } from "./theme.js";

/**
 * 造一个导航链接。
 * page 参数与 <body data-page="..."> 的值比对，相同则加 is-active 高亮。
 */
function navLink(href, label, page) {
  const current = document.body.dataset.page;
  return el("a", {
    class: `nav-link${current === page ? " is-active" : ""}`,
    href: withBase(href),
    text: label,
  });
}

/**
 * 造出搜索弹层并挂到 body 上，返回 { open, close } 供外部控制。
 *
 * 结构（.search-overlay 全屏遮罩 → .search-panel 面板 → 输入框 + 结果区）：
 *   - 遮罩用 hidden 属性控制显隐，CSS 里配了 .search-overlay[hidden]{display:none!important}
 *     ⚠️ 必须加 !important：display 被设成了 grid，而 [hidden] 默认的 display:none 优先级更低
 *   - 打开时锁 body 滚动（overflow:hidden），关闭时恢复为空字符串（不能写死 "auto"，会覆盖别的样式）
 */
function renderSearchDialog(articles) {
  const dialog = el("div", { class: "search-overlay", hidden: "hidden" });
  dialog.innerHTML = `
    <div class="search-panel glass">
      <div class="search-head">
        <input id="site-search-input" type="search" placeholder="搜索文章标题、摘要、标签…" autocomplete="off" />
        <button type="button" class="icon-btn" data-close-search aria-label="关闭">✕</button>
      </div>
      <div id="site-search-results" class="search-results"></div>
    </div>`;
  document.body.append(dialog);

  const input = $("#site-search-input", dialog);
  const box = $("#site-search-results", dialog);

  /** 按关键词重绘结果区。q 为空时显示提示文案而不是空列表。 */
  const paint = (q) => {
    const query = q.trim().toLowerCase();
    if (!query) {
      box.innerHTML = `<p class="muted">输入关键词，从 ${articles.length} 篇文章中查找。</p>`;
      return;
    }
    // 把"标题 + 摘要 + 标签 + 三级分类"拼成一个大字符串再 includes，
    // 这是最朴素的全文匹配：实现简单、无依赖，几十篇的量级完全够用
    const hits = articles.filter((a) => {
      const hay = `${a.title} ${a.summary} ${(a.tags || []).join(" ")} ${a.section} ${a.topic} ${a.subtopic}`.toLowerCase();
      return hay.includes(query);
    });
    if (!hits.length) {
      box.innerHTML = `<p class="muted">没有匹配「${q}」的文章。</p>`;
      return;
    }
    box.innerHTML = hits
      .slice(0, 8)   // 只展示前 8 条
      .map(
        (a) => `<a class="search-hit" href="${withBase(`/article.html?slug=${encodeURIComponent(a.slug)}`)}">
          <small>${a.subtopic || a.topic || a.section || ""}</small>
          <strong>${a.title}</strong>
          <span>${a.summary}</span>
        </a>`
      )
      .join("");
  };

  const open = () => {
    dialog.hidden = false;
    document.body.style.overflow = "hidden";   // 打开时禁止背景滚动
    paint("");
    input.focus();                             // 打开即聚焦，可以直接打字
  };
  const close = () => {
    dialog.hidden = true;
    document.body.style.overflow = "";         // 还原成样式表里的值
  };

  // 输入即搜索（没有防抖：数据量小，每次重绘的开销可忽略）
  input.addEventListener("input", () => paint(input.value));

  // 点遮罩空白处或关闭按钮 → 关闭。e.target === dialog 判断的是"点在遮罩本身而不是面板上"
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close-search]")) close();
  });

  // 全局快捷键：⌘K / Ctrl+K 切换，Esc 关闭
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();   // 拦掉浏览器默认的"把光标移到地址栏"（Firefox 的 Ctrl+K）
      dialog.hidden ? open() : close();
    }
    if (e.key === "Escape" && !dialog.hidden) close();
  });
  return { open, close };
}

/**
 * 页面外壳装配入口。每个页面 JS 的顶层都会 await 它。
 *
 * 流程：
 *   1. initTheme()           —— 先恢复主题，避免导航以默认色闪一下
 *   2. 渲染 header / footer  —— 清空容器再 append（幂等，重复调用不会叠加）
 *   3. 拉目录 → 建搜索弹层
 *   4. 在 header 上挂事件委托，处理"打开搜索"和"切换主题"
 */
export async function mountChrome() {
  initTheme();

  const header = $("header.top-nav");
  const footer = $("footer.site-footer");
  // 404.html 没有这两个元素，直接返回，让页面保持"无外壳"的极简状态
  if (!header || !footer) return;

  header.innerHTML = "";
  header.append(
    el("div", { class: "shell nav-inner" }, [
      // 左：品牌（渐变小方块 + 站名）
      el("a", { class: "brand", href: withBase("/index.html") }, [
        el("span", { class: "brand-mark", html: "<i></i>" }),
        el("strong", { text: SITE.name }),
      ]),
      // 中：主导航。窄屏下 .nav-links 被 CSS 隐藏（见 main.css 的 @media）
      el("nav", { class: "nav-links", "aria-label": "主导航" }, [
        navLink("/index.html", "首页", "home"),
        navLink("/articles.html", "文章", "articles"),
        navLink("/about.html", "关于我", "about"),
      ]),
      // 右：搜索入口 + 主题开关 + GitHub
      el("div", { class: "nav-actions" }, [
        el("button", { class: "search-chip", type: "button", "data-open-search": true }, [
          el("span", { text: "搜索文库…" }),
          el("kbd", { text: "⌘K" }),
        ]),
        el("button", {
          class: "icon-btn",
          type: "button",
          "data-toggle-theme": true,
          "aria-label": "切换主题",
          text: currentTheme() === "dark" ? "☀" : "☾",   // 深色下显示太阳（点了变亮），反之月亮
        }),
        el("a", { class: "admin-chip", href: SITE.github, target: "_blank", rel: "noreferrer", text: "GitHub" }),
      ]),
    ])
  );

  footer.innerHTML = "";
  footer.append(
    el("div", { class: "shell footer-inner" }, [
      el("span", { text: `© ${new Date().getFullYear()} ${SITE.name}` }),   // 年份自动跟随当前年
      el("span", { text: "纯静态站点 · 可直接托管于 GitHub Pages" }),
    ])
  );

  // 目录加载失败时降级成空数组：导航和页脚照常显示，只是搜索搜不到东西
  const articles = await loadCatalog().catch(() => []);
  const search = renderSearchDialog(articles);

  // 事件委托：一个监听器管住 header 里所有（含未来的）可点元素
  header.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-search]")) search.open();
    if (e.target.closest("[data-toggle-theme]")) {
      toggleTheme();
      // 切换后同步按钮图标。closest 可能命中子元素，所以要用 closest 拿回按钮本身再改文案
      const btn = e.target.closest("[data-toggle-theme]");
      btn.textContent = currentTheme() === "dark" ? "☀" : "☾";
    }
  });
}

/**
 * 文章详情页链接：/article.html?slug=xxx
 * encodeURIComponent 是必须的 —— slug 里若有中文或特殊字符，不编码会拼出非法 URL。
 */
export function articleHref(slug) {
  return withBase(`/article.html?slug=${encodeURIComponent(slug)}`);
}

/**
 * 按文章分类挑封面配色（返回 CSS 类名后缀，对应 .cover-ai / .cover-ops / …）。
 *
 * 这是一张手写的映射表：分类 → 视觉风格。
 * 之所以不做成"按分类名哈希取色"，是为了让配色可控 —— 学习笔记偏绿、架构偏蓝、AI 偏青。
 * 匹配不到时回落到 arch（深蓝），保证任何文章都不会出现没有配色的封面。
 */
export function coverVariant(article) {
  if (article.section === "学习笔记") {
    if (article.topic === "Python") return "be";
    if (article.topic === "数据与存储") return "db";
    if (article.topic === "模型基础") return "ai";
    return "fe";
  }
  if (article.topic === "AI 落地") return "ai";
  if (article.topic === "架构与选型") return "ops";
  return "arch";
}

/**
 * 文章卡片的 HTML 字符串（首页精选、列表页、相关文章三处共用）。
 *
 * ⚠️ 这里用模板字符串直接拼 HTML，所以文章的 title / summary 没有经过转义。
 *    数据来自自己维护的 articles.json，属于可信内容，可以接受；
 *    如果将来接了用户投稿，就必须先把字段过一遍 escapeHtml。
 */
export function articleCard(article) {
  const label = article.subtopic || article.topic || article.section || "";
  return `<a class="article-card glass" href="${articleHref(article.slug)}">
    <div class="article-cover cover-${coverVariant(article)}">
      <span class="cover-badge">${label}</span>
      <div class="cover-art" aria-hidden="true"></div>
    </div>
    <div class="article-body">
      <h3>${article.title}</h3>
      <p>${article.summary}</p>
      <div class="card-meta">
        <span>${article.date}</span>
        <span>${article.section || ""}</span>
      </div>
    </div>
  </a>`;
}
