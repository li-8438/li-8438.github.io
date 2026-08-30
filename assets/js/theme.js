/**
 * theme.js —— 深浅色主题（读取 / 应用 / 切换）
 *
 * 本模块做什么：
 *   1. 把主题写进 documentElement 的 data-theme 属性，供 CSS 变量切换配色
 *   2. 把选择存进 localStorage，刷新后保持
 *   3. 提供 initTheme（进页面时恢复）/ toggleTheme（点击时切换）
 *
 * 学习要点：
 *   1. 主题真正的实现在 CSS 里：main.css 用 :root[data-theme="dark"] 覆盖一批 CSS 变量，
 *      JS 只负责"改一个属性"，配色逻辑完全交给 CSS —— 这是最省事也最好维护的分工。
 *   2. 为什么存在 localStorage 而不是 cookie：主题是纯前端偏好，不需要发给服务器，
 *      localStorage 读写同步、容量大，正合适。
 *   3. ⚠️ 首屏闪白（FOUC）问题：initTheme 在本文件是被 chrome.js 在模块顶层调用的，
 *      而 <script type="module"> 默认 defer，会在 DOM 解析完之后才执行，
 *      所以严格来说会有一帧用默认浅色渲染。要彻底消除就得在 <head> 里加一段内联脚本
 *      提前设好 data-theme。本项目文章页较长、影响可接受，就没加。
 *
 * 调用顺序：chrome.js 的 mountChrome() → initTheme()。
 */

const KEY = "tech-blog-theme";   // localStorage 的键名，改名等于重置所有访客的主题偏好

/**
 * 当前生效的主题。
 * 优先读 DOM 上已经生效的 data-theme（初始化后就是最新的），
 * 再退到 localStorage，最后兜底 light。
 */
export function currentTheme() {
  return document.documentElement.dataset.theme || localStorage.getItem(KEY) || "light";
}

/**
 * 应用主题：除了 "dark" 一律按 light 处理，避免脏数据（比如手改 localStorage 成 "DARK"）把界面搞坏。
 */
export function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;   // 对应 CSS 选择器 :root[data-theme="dark"]
  localStorage.setItem(KEY, next);
}

/** 在 dark / light 之间翻转。 */
export function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** 进页面时调用：恢复上次的偏好，没存过就用浅色。 */
export function initTheme() {
  applyTheme(localStorage.getItem(KEY) || "light");
}
