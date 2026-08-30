/**
 * about.js —— 关于我页入口
 *
 * 本模块做什么：
 *   1. 装外壳，读取 content/profile.json
 *   2. 一次性渲染四个区块：个人名片 / 技术栈 / 工作经历（时间线）/ 教育背景
 *
 * 学习要点：
 *   1. 这一页是"纯数据渲染"：HTML 里只有一个空的 #about-root，
 *      所有内容都来自 profile.json。改资料不用碰代码，改 JSON 即可。
 *   2. 每个字段都写了 `profile.x || SITE.y` 的兜底：
 *      profile.json 缺字段时退回 config.js 里的站点级默认值，页面不会出现 undefined。
 *   3. avatarSvg() 是函数声明，却在使用之后才定义 —— 这靠"函数声明提升"生效。
 *      ⚠️ 换成 const avatarSvg = () => {} 就会报"在初始化前无法访问"，因为箭头函数不提升。
 *   4. 内联 SVG 而不是 <img src>：好处是颜色、尺寸都能被 CSS 直接控制，也省一次请求。
 *
 * 调用顺序：about.html → 本模块 → chrome.js / content.js / config.js。
 */

import { mountChrome } from "../chrome.js";
import { loadProfile } from "../content.js";
import { $ } from "../dom.js";
import { SITE } from "../config.js";

// ── 步骤 1：装外壳 + 取资料 ──
await mountChrome();

const profile = await loadProfile();

// ── 步骤 2：整页渲染 ──
$("#about-root").innerHTML = `
  <section class="about-grid">
    <div class="profile-panel glass">
      <div class="avatar-wrap">
        <div class="avatar-ring" aria-hidden="true">${avatarSvg()}</div>
      </div>
      <div>
        <h1>${profile.name || SITE.author}</h1>
        <p class="gradient-text profile-role">${profile.headline || SITE.tagline}</p>
        <p class="profile-bio">${profile.bio || ""}</p>
        <div class="profile-meta">
          <span>${profile.location || SITE.location}</span>
          <span>${profile.email || SITE.email}</span>
        </div>
        <div class="profile-actions">
          ${(profile.links || [])   // links 是 [{ label, href }]，全部新窗口打开
            .map((l) => `<a class="ghost-btn" href="${l.href}" target="_blank" rel="noreferrer">${l.label}</a>`)
            .join("")}
        </div>
      </div>
    </div>
  </section>

  <section class="glass info-block">
    <h2>技术栈</h2>
    <div class="skill-pills">${(profile.stack || []).map((s) => `<span class="skill-pill">${s}</span>`).join("")}</div>
  </section>

  <section class="about-bottom">
    <div class="glass info-block">
      <h2>工作经历</h2>
      <div class="timeline">
        ${(profile.experience || [])
          .map(
            // 每行一个小圆点 + 标题 / 公司与时间 / 描述，样式在 .timeline-row
            (x) => `<div class="timeline-row"><i></i><div>
              <strong>${x.title}</strong>
              <span>${x.org} · ${x.period}</span>
              <p>${x.desc}</p>
            </div></div>`
          )
          .join("")}
      </div>
    </div>
    <div class="glass info-block">
      <h2>教育背景</h2>
      ${(profile.education || [])
        .map((x) => `<div class="edu-row"><strong>${x.school}</strong><span>${x.major} · ${x.period}</span></div>`)
        .join("")}
    </div>
  </section>
`;

/**
 * 头像 SVG（一个简笔人像）。
 * 用 viewBox 声明坐标系，宽高都写 88，和外层 .avatar-ring 的尺寸对齐。
 */
function avatarSvg() {
  return `<svg viewBox="0 0 88 88" width="88" height="88" fill="none">
    <circle cx="44" cy="44" r="44" fill="#e8f7f8"/>
    <circle cx="44" cy="36" r="16" fill="#1f3b4d"/>
    <path d="M18 78c4-18 16-28 26-28s22 10 26 28" fill="#163445"/>
    <circle cx="38" cy="34" r="2" fill="#fff"/><circle cx="50" cy="34" r="2" fill="#fff"/>
    <path d="M38 42c4 3 8 3 12 0" stroke="#7dd3c7" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
