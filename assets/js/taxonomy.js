/**
 * taxonomy.js —— 三级分类体系（分类树定义 + 归档链接 + 过滤）
 *
 * 本模块做什么：
 *   1. TAXONOMY      —— 用一份嵌套数据描述"栏目 → 分类 → 子分类"三级树
 *   2. articlesHref  —— 把分类条件拼成 /articles.html?section=..&topic=..&subtopic=..
 *   3. filterArticles —— 按分类条件过滤文章目录
 *   4. categoryLabel —— 取一个"最具体"的分类名用于展示
 *
 * 学习要点：
 *   1. 分类是"数据驱动"的：侧边栏不是手写 HTML，而是遍历这棵树生成的（见 articles.js 的 renderSide）。
 *      加一个新分类 = 往 TAXONOMY 里加一个对象，界面自动多一行、自动算好文章数。
 *   2. 分类用"名字"而不是"id"做匹配：articles.json 里文章写的是 section/topic/subtopic 的中文名，
 *      和 TAXONOMY 里的 name 直接比对，改 id 不影响匹配，改 name 则要同步改两边
 *      （⚠️ 这是本项目最容易踩的坑：改了树里的中文名，老文章就从这个分类里"消失"了）。
 *   3. 状态放在 URL 参数里而不是 JS 变量里：好处是可分享、可前进后退、刷新不丢。
 *
 * 调用顺序：pages/articles.js（侧边栏 + 过滤）、pages/home.js（首页两个入口卡片）。
 */

/** 侧栏分类树。文章用 section / topic / subtopic 三个字段挂载到这棵树上。 */
export const TAXONOMY = [
  {
    id: "notes",
    name: "学习笔记",
    children: [
      { id: "python", name: "Python" },
      {
        id: "data",
        name: "数据与存储",
        children: [
          { id: "mysql", name: "MySQL" },
          { id: "redis", name: "Redis" },
          { id: "vector-db", name: "向量数据库" },
        ],
      },
      {
        id: "model",
        name: "模型基础",
        children: [
          { id: "ml", name: "机器学习与深度学习" },
          { id: "nlp", name: "NLP" },
        ],
      },
      {
        id: "llm",
        name: "LLM 应用",
        children: [
          { id: "prompt", name: "提示词工程" },
          { id: "rag", name: "RAG" },
          { id: "agent", name: "Agent" },
        ],
      },
      {
        id: "tooling",
        name: "工程工具",
        children: [
          { id: "git", name: "Git" },
          { id: "docker", name: "Docker" },
          { id: "k8s", name: "Kubernetes" },
        ],
      },
    ],
  },
  {
    id: "essays",
    name: "行业思考",
    children: [
      {
        id: "arch",
        name: "架构与选型",
        children: [
          { id: "backend-arch", name: "后端架构" },
          { id: "data-arch", name: "数据架构" },
          { id: "deploy-cost", name: "部署与成本" },
        ],
      },
      {
        id: "ai-landing",
        name: "AI 落地",
        children: [
          { id: "capability", name: "能力边界" },
          { id: "product", name: "产品形态" },
          { id: "eval-risk", name: "评估与风险" },
        ],
      },
      {
        id: "career",
        name: "行业与职业",
        children: [
          { id: "industry", name: "行业观察" },
          { id: "skills", name: "能力模型" },
          { id: "method", name: "工作方法" },
        ],
      },
    ],
  },
];

/**
 * 生成归档页链接，如 articlesHref({ section: "学习笔记", topic: "LLM 应用" })。
 *
 * 用 URLSearchParams 而不是手写 `?a=1&b=2`：
 * 它会替你做 URL 编码，中文分类名（"学习笔记"）不会拼出非法 URL。
 * 条件为空就不带该参数，最终退化成 /articles.html（等价于"全部"）。
 */
export function articlesHref({ section = "", topic = "", subtopic = "" } = {}) {
  const p = new URLSearchParams();
  if (section) p.set("section", section);
  if (topic) p.set("topic", topic);
  if (subtopic) p.set("subtopic", subtopic);
  const q = p.toString();
  return q ? `/articles.html?${q}` : "/articles.html";
}

/**
 * 按分类条件过滤文章。
 *
 * 逻辑是"AND"：传了几个条件就要求几个字段都对上。
 * 空字符串视为"不限制"（if (section && ...) 的短路效果），
 * 所以只传 { section } 就是"该栏目下的全部文章"。
 */
export function filterArticles(list, { section, topic, subtopic } = {}) {
  return list.filter((a) => {
    if (section && a.section !== section) return false;
    if (topic && a.topic !== topic) return false;
    if (subtopic && a.subtopic !== subtopic) return false;
    return true;
  });
}

/**
 * 取一个用于展示的分类名：优先用最具体的子分类，逐级向上兜底。
 * 文章卡片的封面角标、搜索结果的小字都用它。
 */
export function categoryLabel(article) {
  return article.subtopic || article.topic || article.section || "";
}
