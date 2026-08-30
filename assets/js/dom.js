/**
 * dom.js —— 原生 DOM 工具箱（选择器 / 建元素 / 格式化）
 *
 * 本模块做什么：
 *   1. $、$$        —— querySelector 的简写，$$ 额外把 NodeList 转成真数组
 *   2. el           —— 一个 20 行的 mini hyperscript，用对象字面量造 DOM 节点
 *   3. formatDate / readingMinutes / formatCount —— 三个展示层的格式化函数
 *
 * 学习要点：
 *   1. 为什么 $$ 要 [...NodeList]：querySelectorAll 返回的是 NodeList，
 *      它只有 forEach，没有 map / filter / sort / slice。
 *      展开成真数组后才能用全部数组方法（article.js 里对目录链接就用到了）。
 *   2. el() 是"数据驱动 DOM"的最小实现：不用 innerHTML 拼字符串，也就天然免疫
 *      HTML 注入——传 text 走 textContent，浏览器不会把它当标签解析。
 *   3. formatDate 用 padStart 补零是 JS 里最省事的两位补零写法，
 *      比 `m < 10 ? "0" + m : m` 可读性更好。
 *
 * 调用顺序：本模块是最底层工具，被 chrome.js 和所有 pages/*.js 依赖。
 */

// ── 步骤 1：选择器简写 ──

/**
 * 取单个元素。root 默认 document，传入容器即可限定搜索范围
 * （chrome.js 里 $("#site-search-input", dialog) 就是只在弹层内找）。
 */
export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * 取多个元素并转成真数组。
 * ⚠️ 返回的是数组而不是 NodeList，所以后面可以链式 .map().filter().sort()。
 */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── 步骤 2：el() —— 迷你 DOM 构造器 ──
/**
 * 用 { 属性: 值 } 造一个元素，用法类似 React 的 createElement。
 *
 * 参数：
 *   tag      标签名，如 "a" / "div"
 *   attrs    属性对象，四个键有特殊含义：
 *              class  → className
 *              html   → innerHTML（⚠️ 只对自己信任的字符串用，会解析标签）
 *              text   → textContent（安全，推荐优先用）
 *              onXxx  → addEventListener("xxx", 回调)
 *            其余键值对原样 setAttribute；值为 false / null / undefined 时跳过
 *            （这样就能写 `hidden: isOpen ? false : "hidden"` 来控制显隐）
 *   children 子节点数组，可以是 DOM 节点，也可以是字符串/数字（自动转文本节点）
 *
 * 返回：造好的 DOM 节点（还没插入文档，由调用方 append）
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    // on* + 函数 = 事件监听；k.slice(2) 把 "onclick" 变成 "click"
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    // false / null / undefined 视为"不设置这个属性"，方便条件渲染
    else if (v === false || v == null) continue;
    else node.setAttribute(k, v);
  }

  // [].concat(children) 保证传单个子节点时也能被统一遍历
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    // 有 nodeType 说明已经是 DOM 节点，直接 append；否则包成文本节点
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

// ── 步骤 3：展示层格式化 ──

/**
 * ISO 日期 → "YYYY-MM-DD"。
 * 解析失败时原样返回入参，避免页面出现 "NaN-NaN-NaN"。
 */
export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;   // ⚠️ 非法日期字符串会变成 Invalid Date，getTime() 是 NaN
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");   // getMonth() 从 0 开始，要 +1
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 估算阅读时长（分钟）。
 *
 * 做法：先把 Markdown 的标记符号（# > * ` - 等）替换成空格，避免符号被算成"词"，
 * 再按空白切词统计数量，除以 280（中文场景的经验值：中文按字数算，英文按词数算，
 * 混排文章取 280 左右比较接近体感），最后 Math.max(4, ...) 兜底——
 * 目的是不让很短的随笔显示"1 分钟"这种没信息量的数字。
 */
export function readingMinutes(text = "") {
  const words = String(text).replace(/[#>*`\-[\]()]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(4, Math.ceil(words / 280));
}

/**
 * 大数字缩写：12345 → "12.3k"，1200 → "1.2k"，980 → "980"。
 * replace(/\.0$/, "") 是为了把 "12.0k" 显示成 "12k"。
 */
export function formatCount(n) {
  const num = Number(n) || 0;   // || 0 同时兜住 NaN、undefined、null
  if (num >= 10000) return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(num);
}
