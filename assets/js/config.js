/**
 * config.js —— 站点全局配置（路径前缀 + 站点元信息的唯一来源）
 *
 * 本模块做什么：
 *   1. 声明 BASE_PATH：站点部署在子目录时，所有链接统一加的前缀
 *   2. 声明 SITE：站名、标语、作者、GitHub 等全站共用的元信息
 *   3. 提供三个路径构造函数 withBase / asset / contentUrl，把"站内路径"拼成"可访问 URL"
 *
 * 学习要点：
 *   1. 为什么路径不能硬编码：本地预览的根是 http://127.0.0.1:4173/，
 *      而 GitHub Pages 项目仓库的根是 https://用户名.github.io/仓库名/。
 *      直接写 "/assets/css/main.css" 在后者会 404（真正在找站点根域下的 assets）。
 *      把前缀收进 BASE_PATH，就能做到"一处改、全站生效"。
 *   2. 判断要不要改 BASE_PATH 的规则：
 *      仓库名 = <用户名>.github.io → 站点就在根域，BASE_PATH 保持 ""；
 *      仓库名是普通项目名        → 站点在子目录，BASE_PATH 改成 "/仓库名"（注意开头有斜杠、结尾没有）。
 *   3. 这是浏览器原生 ES Module（HTML 里 <script type="module">），
 *      export / import 不需要 webpack、vite 之类的打包器，浏览器直接支持。
 *
 * 调用顺序：所有页面 JS → 本模块（被 dom/content/chrome/pages 共同依赖，是最底层的模块）。
 */

// ── 步骤 1：部署路径前缀 ──
// ⚠️ 换仓库名后第一件事就是改这里；忘记改的典型症状是：首页能开、CSS 和 JSON 全部 404。
export const BASE_PATH = "";

// ── 步骤 2：站点元信息 ──
// 这里的值会被导航栏（SITE.name）、页脚、文章页作者行、关于我页的兜底文案读取。
// 想改站名 / GitHub 链接，改这里就够了，不要去各个页面里搜字符串。
export const SITE = {
  name: "Tech Blog",
  tagline: "全栈开发工程师 | 技术架构师 | 大模型探索者",   // 显示在文章页作者行
  description: "分享全栈开发、大模型工程化、架构设计与技术思考。",
  author: "Tech Blog",                                    // 文章页头像取 author.slice(0, 1) 作首字母
  location: "中国 · 北京",                                 // 关于我页 profile.json 缺字段时的兜底
  github: "https://github.com",                           // 导航栏右上角 GitHub 按钮
  email: "hello@example.com",
};

// ── 步骤 3：三个路径构造函数 ──

/**
 * 把站内绝对路径拼成带前缀的可访问路径。
 *
 * 参数：path —— 以 "/" 开头的站内路径，如 "/articles.html"；不写斜杠也会自动补上。
 * 返回：BASE_PATH + path，如 "/仓库名/articles.html"。
 *
 * 为什么所有 href 都要过一遍这里：一旦漏掉某个链接，页面在子目录部署时就是死链，
 * 而且这种问题本地预览永远测不出来（本地 BASE_PATH 为空，看不出差别）。
 */
export function withBase(path = "/") {
  // 统一补前导斜杠，避免出现 "仓库名articles.html" 这种拼接错误
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${clean}`;
}

/**
 * 静态资源（css / js / svg）路径。
 * 参数写相对 assets 的路径，如 asset("css/main.css")。
 */
export function asset(path) {
  // replace(/^\/+/, "") 去掉调用方多写的前导斜杠，防止拼出 "/assets//css/main.css"
  return withBase(`/assets/${path.replace(/^\/+/, "")}`);
}

/**
 * 内容数据（JSON / Markdown）路径。
 * 单独拆一个函数的原因：content/ 是"数据层"，将来要接 CDN、加版本号或换目录，
 * 只需要动这一个函数，不会波及 CSS/JS 之类的资源路径。
 */
export function contentUrl(path) {
  return withBase(`/content/${path.replace(/^\/+/, "")}`);
}
