/**
 * markdown.js —— 轻量 Markdown 解析器（零依赖，约 180 行）
 *
 * 本模块做什么：
 *   1. escapeHtml / inline   —— HTML 转义 + 行内语法（图片、链接、代码、粗斜体）
 *   2. slugify               —— 标题文本 → 锚点 id
 *   3. parseFrontMatter      —— 拆出 md 顶部的 YAML Front Matter 与正文
 *   4. renderMarkdown        —— 逐行状态机，把正文渲染成 HTML，同时产出目录 toc
 *
 * 学习要点：
 *   1. 为什么不用 marked.js / markdown-it：这个项目追求"零构建、零依赖、直接丢到 Pages"，
 *      而文章用到的语法很有限。自己写 180 行换掉一个几百 KB 的库，是划算的取舍。
 *      代价是：不支持嵌套列表、不支持表格对齐、不支持引用块里的多行结构 —— 够用即可。
 *   2. ⚠️ 顺序至关重要：先 escapeHtml 再做行内替换。
 *      反过来的话，用户写的 <script> 会原样进入页面（XSS）；
 *      先转义则所有尖括号都变成 &lt; &gt;，只剩我们主动生成的标签是"真"HTML。
 *   3. 解析算法是"逐行状态机"而不是正则一把梭：
 *      while 循环 + 手动推进 i，遇到块级语法（代码块、表格、列表、引用）就进入内层 while
 *      把连续的同类型行一次性吃掉。这种写法天然支持"多行段落""连续列表项合并成一个 <ul>"。
 *   4. 目录 toc 是渲染的副产品：一边生成带 id 的 <h2>/<h3>，一边把 { id, title, level }
 *      收集起来，页面拿它直接渲染侧边目录 + 滚动高亮，不需要二次扫描 DOM。
 *
 * 调用顺序：content.js（loadArticle）→ parseFrontMatter；pages/article.js → renderMarkdown。
 */

/**
 * HTML 转义：把 & < > " 四个字符换成实体。
 * 这是唯一的 XSS 防线 —— 文章正文来自 Markdown 文件，属于"作者可控但也不该被当 HTML 执行"的内容。
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 行内语法替换。调用前必须已经 escapeHtml 过。
 *
 * 各条正则的含义：
 *   !\[alt](url)      → <img>              图片
 *   [文本](url)        → <a target="_blank"> 链接（rel="noreferrer" 防止外站拿到 referrer）
 *   `代码`            → <code>             行内代码
 *   **粗** 或 __粗__   → <strong>
 *   *斜*              → <em>               (^|[^\w*]) 是边界判断：
 *                                          防止把 "2*3*4" 里的星号当成斜体标记
 */
function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

/**
 * 标题 → 锚点 id。
 * 保留中文（\u4e00-\u9fff），其余非字母数字的字符统一换成连字符，最后截 48 字符防止 id 过长。
 */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w一-鿿]+/g, "-")   // 保留中文字段（\u4e00-\u9fff），其余符号统一换成连字符
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// ── Front Matter 解析 ──

/**
 * 拆开 Markdown 顶部的 `---\n key: value \n---\n正文`。
 *
 * 这是一个"够用的 YAML 子集"解析器，只支持三种值：
 *   tags: [RAG, Milvus]  → 数组（去掉两端方括号后按逗号切，再剥掉引号）
 *   published: true      → 布尔
 *   其他                → 字符串（剥掉两端引号）
 *
 * 注意 indexOf(":") 取的是第一个冒号，所以值里可以再出现冒号（如 "http://x" 不会有问题），
 * 但键名里不能有冒号。
 *
 * 参数：raw —— 整个 md 文件的文本
 * 返回：{ data: {...}, content: "正文部分" }
 */
export function parseFrontMatter(raw) {
  const src = raw.replace(/^﻿/, "");   // 去掉 BOM：Windows 编辑器保存的 UTF-8 文件常在开头带 BOM
                                       // （正则里那个不可见字符就是 \uFEFF，写成转义形式更易读）
  if (!src.startsWith("---")) return { data: {}, content: src };   // 没有 Front Matter，整篇当正文
  const end = src.indexOf("\n---", 3);
  if (end < 0) return { data: {}, content: src };                  // 只有开头没有结尾，视为没写
  const fm = src.slice(3, end).trim();                             // Front Matter 内容
  const content = src.slice(end + 4).replace(/^\s*\n/, "");        // +4 跳过 "\n---"，再吃掉第一个空行

  const data = {};
  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      // 数组：切分 → 去空白 → 剥引号 → 丢掉空串（处理 "[a, b,]" 这种尾逗号）
      val = val
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (val === "true" || val === "false") {
      val = val === "true";
    } else {
      val = val.replace(/^["']|["']$/g, "");
    }
    data[key] = val;
  }
  return { data, content };
}

// ── 正文渲染 ──

/**
 * Markdown → HTML。
 *
 * 参数：md —— 正文（已去掉 Front Matter）
 * 返回：{ html: "...", toc: [{ id, title, level }] }
 *
 * 实现是"逐行看，命中哪种块级语法就吃掉一段"：
 *   ``` 围栏代码块 → 一直吃到下一个 ```
 *   | 表格        → 表头 + 分隔行 + 若干数据行
 *   # 标题        → <h1/2/3> 并登记进 toc
 *   ---          → <hr>
 *   > 引用        → 连续 > 行合并成一个 <blockquote>
 *   - / * / +    → 连续列表项合并成一个 <ul>
 *   1. 2. 3.     → 连续列表项合并成一个 <ol>
 *   空行         → 跳过（段落的分隔符）
 *   其余         → 段落，一直吃到遇到下一个块级语法或空行为止
 */
export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");   // 统一换行符：Windows 的 \r\n 会干扰正则
  const out = [];                                        // 收集生成的 HTML 片段
  const toc = [];                                        // 收集目录项
  let i = 0;
  const used = new Set();                                // 已经用过的锚点 id，用于去重

  /**
   * 生成不重复的锚点 id。
   * 两节同名（比如两处都叫"总结"）时，第二个会变成 "总结-2"、"总结-3"。
   */
  const uniqueId = (title) => {
    let id = slugify(title) || "section";   // 纯符号标题 slugify 后可能是空串，兜底 "section"
    let n = 2;
    let candidate = id;
    while (used.has(candidate)) candidate = `${id}-${n++}`;
    used.add(candidate);
    return candidate;
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── 代码块：``` 开头，语言名跟在后面 ──
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();                 // ```python → "python"
      const buf = [];
      i += 1;
      // ⚠️ 这里不处理转义：代码块内部整体 escapeHtml，所以展示 <div> 是安全的
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;   // 跳过收尾的 ```
      out.push(
        // 外壳是"Mac 窗口"样式：三个圆点 + 语言名，样式在 .code-shell / .code-toolbar
        `<div class="code-shell"><div class="code-toolbar"><span><i></i><i></i><i></i></span><b>${escapeHtml(lang || "CODE")}</b></div><pre><code>${escapeHtml(buf.join("\n"))}</code></pre></div>`
      );
      continue;
    }

    // ── 表格：当前行以 | 开头结尾，且下一行是分隔行（| :-- | --: |） ──
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-/.test(lines[i + 1])) {
      // 把一行 "| a | b |" 变成 ["a", "b"]，每个单元格都走 inline() 以便支持 **粗体**
      const parseRow = (row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => inline(c.trim()));
      const head = parseRow(line);
      i += 2;   // 跳过表头行和分隔行（分隔行的对齐信息本解析器忽略）
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        body.push(parseRow(lines[i]));
        i += 1;
      }
      // .table-wrap 提供横向滚动，防止宽表格在手机上撑破布局
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }

    // ── 标题：只认 # ## ###（三级），更深层级按普通段落处理 ──
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;      // # 的个数就是层级
      const title = heading[2].trim();
      const id = uniqueId(title);
      toc.push({ id, title, level });       // 目录项：article.js 用它渲染左侧 TOC
      // class="anchored-heading" 给 CSS 留出 scroll-margin 的挂载点
      out.push(`<h${level} id="${id}" class="anchored-heading">${inline(title)}</h${level}>`);
      i += 1;
      continue;
    }

    // ── 分割线：单独一行 --- ──
    if (/^---+$/.test(line.trim())) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    // ── 引用块：连续多行 > 合并成一个 <blockquote>（行间用空格连成一段） ──
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // ── 无序列表：连续行合并成一个 <ul>（⚠️ 不支持嵌套缩进） ──
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ul>${buf.join("")}</ul>`);
      continue;
    }

    // ── 有序列表：同上，只是容器换成 <ol> ──
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol>${buf.join("")}</ol>`);
      continue;
    }

    // ── 空行：段落之间的分隔，直接跳过 ──
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // ── 兜底：普通段落。一直吃到空行或下一个块级语法标记 ──
    const buf = [line];
    i += 1;
    // 这个正则列出所有"块级语法的开头"，命中就说明本段落结束了
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|---$|>\s|[-*+]\s|\d+\.\s|\|)/.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    // 段落内的换行合并成空格：Markdown 规范里软换行不产生 <br>
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  return { html: out.join("\n"), toc };
}
