/**
 * content.js —— 内容数据层（读 JSON / 读 Markdown / 派生统计与推荐 / 本地点赞）
 *
 * 本模块做什么：
 *   1. loadCatalog / loadProfile / loadSite  —— 拉取三份 JSON，带内存缓存
 *   2. loadArticle                            —— 取单篇文章（元数据 + Markdown 正文），带缓存
 *   3. uniqueValues / uniqueTags              —— 从目录派生"分类/标签 + 文章数"
 *   4. relatedArticles                        —— 按标签与分类相似度推荐相关文章
 *   5. getLikes / toggleLike                  —— 用 localStorage 实现的本地点赞
 *
 * 学习要点：
 *   1. "没有后端"是这个站的核心设计：文章就是 content/ 下的 Markdown + 一份索引 JSON，
 *      页面用 fetch 把它们读进来，在浏览器里渲染。代价是首屏要等一次网络请求，
 *      换来的是零运维、可直接托管在 GitHub Pages。
 *   2. 为什么到处写 { cache: "no-store" }：静态站最怕浏览器/GitHub Pages 缓存住旧的
 *      articles.json，导致"我明明发了新文章却看不到"。no-store 强制每次都问服务器。
 *   3. 缓存分两级：模块级变量（catalogCache/articleCache）+ HTTP 缓存。
 *      前者保证同一次访问里，切页面不会重复请求同一份数据。
 *   4. 排序用 String(date).localeCompare：日期是 "YYYY-MM-DD" 格式，
 *      这种格式的字典序恰好等于时间序，直接比字符串就行，不必转成 Date 对象。
 *
 * 调用顺序：pages/*.js → 本模块 → config.js（contentUrl）/ markdown.js（parseFrontMatter）。
 */

import { contentUrl } from "./config.js";
import { parseFrontMatter } from "./markdown.js";

// ── 缓存容器 ──
// 模块级变量：ES Module 在同一个页面里只会被求值一次，所以这里的缓存是"页面级单例"。
let catalogCache = null;              // 文章目录（数组），null 表示还没加载过
const articleCache = new Map();       // slug → 文章全文对象，用 Map 是因为键是动态字符串

// ── 步骤 1：三份 JSON 的加载 ──

/**
 * 加载文章目录（content/articles.json）。
 *
 * 处理了三件事：
 *   1. 命中缓存直接返回，避免重复请求
 *   2. 过滤 published: false 的草稿（只有显式写 false 才隐藏，没写该字段默认可见）
 *   3. 按日期倒序排（新的在前），所以首页/列表页不用再单独排序
 */
export async function loadCatalog() {
  if (catalogCache) return catalogCache;
  const res = await fetch(contentUrl("articles.json"), { cache: "no-store" });
  // ⚠️ fetch 只在网络失败时 reject，404 / 500 都会正常 resolve，必须自己判断 res.ok
  if (!res.ok) throw new Error("无法加载文章目录 content/articles.json");
  const data = await res.json();
  catalogCache = (data.articles || [])
    .filter((a) => a.published !== false)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return catalogCache;
}

/** 加载关于我的资料（content/profile.json）。不缓存，因为一页只会读一次。 */
export async function loadProfile() {
  const res = await fetch(contentUrl("profile.json"), { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载 profile.json");
  return res.json();
}

let siteCache = null;
/** 加载站点配置（content/site.json）：首页精选文章 slug + 「现在在写什么」。 */
export async function loadSite() {
  if (siteCache) return siteCache;
  const res = await fetch(contentUrl("site.json"), { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载 site.json");
  siteCache = await res.json();
  return siteCache;
}

/**
 * 按 slug 顺序取出指定的精选文章。
 *
 * 为什么要有这个函数：site.json 里只存了 4 个 slug 字符串，
 * 需要回到目录里换成完整的文章对象才能渲染卡片。
 * 用 Map 做一次索引（slug → 文章）再查，避免对每个 slug 都 find 一遍（O(n²) → O(n)）。
 * filter(Boolean) 会静默丢掉目录里已不存在的 slug —— 写错 slug 不会报错，只是少一张卡片。
 */
export function featuredArticles(catalog, slugs = []) {
  const map = new Map(catalog.map((a) => [a.slug, a]));
  return slugs.map((slug) => map.get(slug)).filter(Boolean);
}

// ── 步骤 2：单篇文章 ──

/**
 * 加载一篇文章的全文。
 *
 * 拼接规则：目录里查到元数据 → 用 meta.file（缺省则按 slug 推 articles/<slug>.md）找正文文件
 *          → 抓纯文本 → parseFrontMatter 拆出 Front Matter 与正文
 *
 * 合并顺序 { ...meta, ...parsed.data, tags, content } 的含义：
 *   articles.json 是"索引"，md 的 Front Matter 是"正文自带信息"，后者优先级更高，
 *   这样只改 md 不更新索引也能生效；tags 单独处理是因为要处理两边都没写的情况。
 *
 * 容错：正文 404 时不抛错，而是返回一句占位提示 —— 索引里有但文件没传上去时，
 *       页面还能正常打开，只是正文位置显示"正文文件缺失。"，比整页白屏好排查。
 */
export async function loadArticle(slug) {
  if (articleCache.has(slug)) return articleCache.get(slug);
  const catalog = await loadCatalog();
  const meta = catalog.find((a) => a.slug === slug);
  if (!meta) return null;   // 目录里没有（未发布或 slug 写错）→ 交给页面显示"文章不存在"
  const file = meta.file || `articles/${slug}.md`;
  const res = await fetch(contentUrl(file), { cache: "no-store" });
  if (!res.ok) return { ...meta, content: "> 正文文件缺失。" };
  const raw = await res.text();
  const parsed = parseFrontMatter(raw);
  const article = {
    ...meta,
    ...parsed.data,
    tags: parsed.data.tags || meta.tags || [],
    content: parsed.content,
  };
  articleCache.set(slug, article);
  return article;
}

// ── 步骤 3：派生统计 ──

/**
 * 统计某个单值字段的取值分布，如 uniqueValues(catalog, "category")
 * → [{ name: "大模型", count: 3 }, ...]。
 *
 * 用 Map 而不是对象：Map 保序（插入顺序），且键可以是任意值，不会有原型链上的意外键。
 */
export function uniqueValues(list, key) {
  const map = new Map();
  for (const item of list) {
    const val = item[key];
    if (!val) continue;   // 空值不参与统计，避免出现一个空的分类卡片
    map.set(val, (map.get(val) || 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count }));
}

/**
 * 统计标签分布。与 uniqueValues 的差别：tags 是数组，要双层遍历。
 * 排序规则：先按文章数降序，数量相同时按标签名排序（localeCompare 保证中文排序稳定）。
 */
export function uniqueTags(list) {
  const map = new Map();
  for (const item of list) {
    for (const tag of item.tags || []) {
      map.set(tag, (map.get(tag) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ── 步骤 4：相关文章推荐 ──

/**
 * 计算"相关文章"：一个极简的加权打分。
 *
 * 打分规则（权重是拍出来的经验值，不是算法推导）：
 *   每个共同标签 +1 分   → 标签重合越多越相关，这是最强的信号
 *   topic 相同     +2 分 → 同一分类，比单个标签更说明问题
 *   section 相同   +1 分 → 同一栏目，最弱的信号
 *
 * 然后：过滤掉 0 分的（完全不沾边的），按分数降序，取前 limit 篇。
 * 返回的是文章对象数组（.map(x => x.a) 把中间结果 { a, score } 还原成文章本身）。
 */
export function relatedArticles(catalog, current, limit = 3) {
  return catalog
    .filter((a) => a.slug !== current.slug)          // 先排除自己
    .map((a) => {
      const tagScore = (a.tags || []).filter((t) => (current.tags || []).includes(t)).length;
      const topicScore = a.topic && a.topic === current.topic ? 2 : 0;
      const sectionScore = a.section && a.section === current.section ? 1 : 0;
      return { a, score: tagScore + topicScore + sectionScore };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a);
}

// ── 步骤 5：本地点赞（localStorage 版） ──

const LIKE_KEY = "tech-blog-likes";   // 存的是 { "文章slug": true/false }

/**
 * 读取点赞状态。
 * 用 try/catch 包住 JSON.parse：localStorage 里的值可能被用户手动改坏，
 * 一旦解析失败就当"没点过赞"，不能让整页 JS 崩掉。
 */
export function getLikes(slug) {
  try {
    const data = JSON.parse(localStorage.getItem(LIKE_KEY) || "{}");
    return Boolean(data[slug]);
  } catch {
    return false;
  }
}

/**
 * 切换点赞状态并返回切换后的值。
 * ⚠️ 这是纯本地的"情绪开关"，不会同步到服务器，换个浏览器/清了缓存就没了 ——
 *    静态站没有后端，这是刻意接受的取舍（README 里把它归为"已舍弃真实统计"）。
 */
export function toggleLike(slug) {
  const data = JSON.parse(localStorage.getItem(LIKE_KEY) || "{}");
  data[slug] = !data[slug];
  localStorage.setItem(LIKE_KEY, JSON.stringify(data));
  return Boolean(data[slug]);
}
