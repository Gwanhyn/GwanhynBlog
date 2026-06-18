import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import katex from "katex";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ADMIN_HTML_FILE = path.join(__dirname, "admin.html");
const DATA_FILE = path.join(ROOT, "src", "data", "posts.json");
const FAVICON_FILE = path.join(ROOT, "public", "favicon.svg");
const KATEX_CSS_FILE = path.join(ROOT, "node_modules", "katex", "dist", "katex.min.css");
const KATEX_FONT_DIR = path.join(ROOT, "node_modules", "katex", "dist", "fonts");
const PORT = Number(process.env.ADMIN_PORT || 8787);
const ACCENTS = new Set(["teal", "orange", "gold", "ink"]);
const MAX_PREVIEW_CHARS = 60_000;
const MAX_PREVIEW_MATH = 64;
const MAX_SAVE_MATH = 240;
const FONT_CONTENT_TYPES = new Map([
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"]
]);
let historyRewritten = false;

marked.setOptions({
  gfm: true,
  breaks: false
});

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

async function sendAdminHtml(response) {
  sendHtml(response, await readFile(ADMIN_HTML_FILE, "utf8"));
}

async function sendFavicon(response) {
  const icon = await readFile(FAVICON_FILE, "utf8");
  response.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=3600"
  });
  response.end(icon);
}

async function sendKatexCss(response) {
  const css = await readFile(KATEX_CSS_FILE, "utf8");
  response.writeHead(200, {
    "content-type": "text/css; charset=utf-8",
    "cache-control": "public, max-age=3600"
  });
  response.end(css);
}

async function sendKatexFont(response, filename) {
  const safeName = path.basename(filename);
  const ext = path.extname(safeName).toLowerCase();
  const contentType = FONT_CONTENT_TYPES.get(ext);

  if (!contentType || safeName !== filename) {
    notFound(response);
    return;
  }

  const font = await readFile(path.join(KATEX_FONT_DIR, safeName));
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable"
  });
  response.end(font);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function readPosts() {
  const raw = await readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writePosts(posts) {
  await writeFile(DATA_FILE, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanHtml(html) {
  const cleaned = String(html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, "");

  return cleaned.trim() || "<p></p>";
}

function normalizeMarkdown(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isEscaped(source, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function protectCodeSegments(source) {
  const segments = [];
  let output = "";
  let index = 0;

  const stash = (segment) => {
    const token = `@@GWB_CODE_${segments.length}@@`;
    segments.push(segment);
    return token;
  };

  while (index < source.length) {
    if (source[index] === "`") {
      let endOfRun = index;
      while (source[endOfRun] === "`") {
        endOfRun += 1;
      }

      const delimiter = source.slice(index, endOfRun);
      const close = source.indexOf(delimiter, endOfRun);
      if (close !== -1) {
        output += stash(source.slice(index, close + delimiter.length));
        index = close + delimiter.length;
        continue;
      }
    }

    if ((index === 0 || source[index - 1] === "\n") && source.startsWith("~~~", index)) {
      let endOfRun = index;
      while (source[endOfRun] === "~") {
        endOfRun += 1;
      }

      const delimiter = source.slice(index, endOfRun);
      const close = source.indexOf(`\n${delimiter}`, endOfRun);
      if (close !== -1) {
        const closeLineEnd = source.indexOf("\n", close + 1);
        const end = closeLineEnd === -1 ? source.length : closeLineEnd;
        output += stash(source.slice(index, end));
        index = end;
        continue;
      }
    }

    output += source[index];
    index += 1;
  }

  return { text: output, segments };
}

function restoreCodeSegments(source, segments) {
  return segments.reduce(
    (text, segment, index) => text.replaceAll(`@@GWB_CODE_${index}@@`, segment),
    source
  );
}

function findMathEnd(source, delimiter, start) {
  for (let index = start; index < source.length; index += 1) {
    if (delimiter === "$" && source[index] === "\n") {
      return -1;
    }

    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) {
      return index;
    }
  }

  return -1;
}

function renderMath(tex, displayMode) {
  const source = tex.trim();

  if (!source) {
    return displayMode ? "$$$$" : "$$";
  }

  try {
    const html = katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false
    });

    return displayMode
      ? `<div class="math-display">${html}</div>`
      : `<span class="math-inline">${html}</span>`;
  } catch {
    const delimiter = displayMode ? "$$" : "$";
    return `<code>${escapeHtml(`${delimiter}${source}${delimiter}`)}</code>`;
  }
}

function renderMarkdownMath(markdown, options = {}) {
  const { text, segments } = protectCodeSegments(markdown);
  let output = "";
  let index = 0;
  let mathCount = 0;
  const maxMath = Number.isFinite(Number(options.maxMath))
    ? Math.max(0, Number(options.maxMath))
    : Infinity;

  const canRenderMath = () => {
    if (mathCount >= maxMath) {
      return false;
    }

    mathCount += 1;
    return true;
  };

  while (index < text.length) {
    if (text.startsWith("$$", index) && !isEscaped(text, index)) {
      const end = findMathEnd(text, "$$", index + 2);
      if (end !== -1 && canRenderMath()) {
        output += `\n\n${renderMath(text.slice(index + 2, end), true)}\n\n`;
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "$" && !isEscaped(text, index)) {
      const next = text[index + 1] || "";
      const end = /\s/.test(next) ? -1 : findMathEnd(text, "$", index + 1);
      const previous = end > index ? text[end - 1] || "" : "";

      if (end !== -1 && !/\s/.test(previous) && canRenderMath()) {
        output += renderMath(text.slice(index + 1, end), false);
        index = end + 1;
        continue;
      }
    }

    output += text[index];
    index += 1;
  }

  return restoreCodeSegments(output, segments);
}

function renderMarkdownToHtml(markdown, options = {}) {
  const source = normalizeMarkdown(markdown);
  if (!source) {
    return { html: "<p></p>", text: "", truncated: false };
  }

  const preview = Boolean(options.preview);
  const maxChars = preview ? Number(options.maxChars || MAX_PREVIEW_CHARS) : 0;
  const truncated = maxChars > 0 && source.length > maxChars;
  const renderSource = truncated
    ? `${source.slice(0, maxChars)}\n\n> 预览内容较长，已截断显示；保存时仍会处理完整正文。`
    : source;
  const maxMath = Number.isFinite(Number(options.maxMath))
    ? Number(options.maxMath)
    : (preview ? MAX_PREVIEW_MATH : MAX_SAVE_MATH);

  try {
    const html = cleanHtml(marked.parse(renderMarkdownMath(renderSource, { maxMath })));
    return { html, text: stripHtml(html), truncated };
  } catch (error) {
    const fallback = cleanHtml(marked.parse(escapeHtml(renderSource)));
    return {
      html: fallback,
      text: stripHtml(fallback),
      truncated,
      warning: error.message || "Markdown 渲染失败，已使用安全文本预览。"
    };
  }
}

function markdownToHtml(markdown, options = {}) {
  return renderMarkdownToHtml(markdown, options).html;
}

function htmlToMarkdown(html) {
  const source = String(html || "");
  const markdown = source
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
      return `\n\n${"#".repeat(Number(level))} ${stripHtml(text)}\n\n`;
    })
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => {
      return `\n\n> ${stripHtml(text)}\n\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${stripHtml(text)}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?(p|ul|ol|strong|b|em|i)[^>]*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decodeHtml(markdown);
}

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `post-${Date.now()}`;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function estimateReadingMinutes(text) {
  const plain = String(text || "").trim();
  const cjkCount = (plain.match(/[\u3400-\u9fff]/g) || []).length;
  const wordCount = (plain.replace(/[\u3400-\u9fff]/g, " ").match(/[a-z0-9]+/gi) || []).length;
  return Math.max(1, Math.round((cjkCount + wordCount) / 320) || 1);
}

function normalizePost(input) {
  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("标题不能为空。");
  }

  const markdown = normalizeMarkdown(input.markdown ?? input.bodyMarkdown ?? htmlToMarkdown(input.body));
  const body = markdownToHtml(markdown);
  const plainBody = stripHtml(body);
  const excerpt = String(input.excerpt || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ""))
    ? String(input.date)
    : new Date().toISOString().slice(0, 10);
  const accent = ACCENTS.has(input.accent) ? input.accent : "teal";
  const minutes = Math.max(
    1,
    Math.round(Number(input.minutes || estimateReadingMinutes(plainBody)))
  );

  return {
    slug: slugify(input.slug || title),
    title,
    date,
    category: String(input.category || "Essay").trim() || "Essay",
    tags: normalizeTags(input.tags),
    excerpt,
    body,
    markdown,
    minutes,
    accent
  };
}

function sortPosts(posts) {
  return [...posts].sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    return byDate || String(a.title).localeCompare(String(b.title));
  });
}

function enrichPostsForEditing(posts) {
  return posts.map((post) => ({
    ...post,
    markdown: normalizeMarkdown(post.markdown || htmlToMarkdown(post.body || ""))
  }));
}

async function savePost(payload) {
  const posts = await readPosts();
  const originalSlug = payload.originalSlug ? slugify(payload.originalSlug) : "";
  const post = normalizePost(payload.post || {});
  const duplicate = posts.find(
    (item) => item.slug === post.slug && item.slug !== originalSlug
  );

  if (duplicate) {
    const error = new Error(`地址别名 "${post.slug}" 已存在。`);
    error.status = 409;
    throw error;
  }

  const index = originalSlug
    ? posts.findIndex((item) => item.slug === originalSlug)
    : posts.findIndex((item) => item.slug === post.slug);

  if (index >= 0) {
    posts[index] = post;
  } else {
    posts.unshift(post);
  }

  const sorted = sortPosts(posts);
  await writePosts(sorted);
  return { post, posts: enrichPostsForEditing(sorted) };
}

async function deletePost(slug) {
  const normalizedSlug = slugify(slug);
  const posts = await readPosts();
  const nextPosts = posts.filter((post) => post.slug !== normalizedSlug);

  if (nextPosts.length === posts.length) {
    const error = new Error(`文章 "${normalizedSlug}" 不存在。`);
    error.status = 404;
    throw error;
  }

  await writePosts(nextPosts);
  return { posts: enrichPostsForEditing(nextPosts) };
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: ROOT, encoding: "utf8" }, (error, stdout, stderr) => {
      const result = {
        command: `git ${args.join(" ")}`,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };

      if (error) {
        error.result = result;
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

function parseGitHistory(output) {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, subject, relativeTime, author] = record.split("\x1f");
      return { hash, shortHash, subject, relativeTime, author };
    });
}

async function gitStatus() {
  const [branch, status, upstreamResult] = await Promise.all([
    runGit(["branch", "--show-current"]),
    runGit(["status", "--porcelain"]),
    runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null)
  ]);
  const upstream = upstreamResult?.stdout || "";
  let ahead = 0;
  let behind = 0;

  if (upstream) {
    const counts = await runGit(["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);
    const [behindCount, aheadCount] = counts.stdout.split(/\s+/).map(Number);
    behind = Number.isFinite(behindCount) ? behindCount : 0;
    ahead = Number.isFinite(aheadCount) ? aheadCount : 0;
  }

  const entries = status.stdout ? status.stdout.split("\n") : [];
  const stagedEntries = entries.filter((entry) => entry[0] && entry[0] !== " " && entry[0] !== "?");
  const unstagedEntries = entries.filter((entry) => entry.startsWith("??") || (entry[1] && entry[1] !== " "));

  return {
    branch: branch.stdout || "master",
    upstream,
    ahead,
    behind,
    diverged: ahead > 0 && behind > 0,
    dirty: Boolean(status.stdout),
    staged: stagedEntries.length > 0,
    unstaged: unstagedEntries.length > 0,
    entries,
    stagedEntries,
    unstagedEntries,
    historyRewritten
  };
}

async function gitHistory(limit = 8) {
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 30);
  const history = await runGit([
    "log",
    `--max-count=${safeLimit}`,
    "--date=relative",
    "--pretty=format:%H%x1f%h%x1f%s%x1f%cr%x1f%an%x1e"
  ]);

  return { commits: parseGitHistory(history.stdout), status: await gitStatus() };
}

async function ensureCleanWorkingTree() {
  const status = await gitStatus();

  if (status.dirty) {
    const error = new Error("合并提交前工作区必须干净。");
    error.status = 409;
    error.details = status.entries;
    throw error;
  }
}

async function stageChanges() {
  const stage = await runGit(["add", "-A"]);
  return { stage, status: await gitStatus(), history: await gitHistory() };
}

async function unstageChanges() {
  const unstage = await runGit(["restore", "--staged", "."]);
  return { unstage, status: await gitStatus(), history: await gitHistory() };
}

async function amendLastCommit(message) {
  const commitMessage = String(message || "").trim();
  const staged = await runGit(["diff", "--cached", "--name-only"]);
  const args = ["commit", "--amend"];

  if (commitMessage) {
    args.push("-m", commitMessage);
  } else {
    args.push("--no-edit");
  }

  const commit = await runGit(args);
  historyRewritten = true;
  return { staged, commit, status: await gitStatus() };
}

async function resolveSquashCount(payload) {
  if (payload.targetHash) {
    const targetHash = String(payload.targetHash).trim();
    await runGit(["rev-parse", "--verify", `${targetHash}^{commit}`]);
    await runGit(["merge-base", "--is-ancestor", targetHash, "HEAD"]);
    const count = await runGit(["rev-list", "--count", `${targetHash}^..HEAD`]);
    return Number(count.stdout);
  }

  return Number(payload.count || 0);
}

async function validateSquashInput(payload) {
  const commitMessage = String(payload.message || "").trim();
  const count = await resolveSquashCount(payload);

  if (!commitMessage) {
    const error = new Error("合并提交需要填写新的提交信息。");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(count) || count < 2) {
    const error = new Error("合并数量至少为 2。");
    error.status = 400;
    throw error;
  }

  const total = Number((await runGit(["rev-list", "--count", "HEAD"])).stdout);
  if (count >= total) {
    const error = new Error("不能在这个面板中合并到根提交。");
    error.status = 400;
    throw error;
  }

  return { commitMessage, count };
}

async function previewSquash(payload) {
  const { commitMessage, count } = await validateSquashInput(payload);
  await ensureCleanWorkingTree();

  const [head, base, history] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["rev-parse", `HEAD~${count}`]),
    runGit([
      "log",
      `--max-count=${count}`,
      "--date=relative",
      "--pretty=format:%H%x1f%h%x1f%s%x1f%cr%x1f%an%x1e"
    ])
  ]);

  return {
    count,
    message: commitMessage,
    head: head.stdout,
    base: base.stdout,
    commits: parseGitHistory(history.stdout),
    result: {
      parent: base.stdout.slice(0, 7),
      subject: commitMessage
    }
  };
}

async function squashCommits(payload) {
  if (!payload.confirmed) {
    const error = new Error("请先预览并确认合并提交。");
    error.status = 428;
    throw error;
  }

  const { commitMessage, count } = await validateSquashInput(payload);
  await ensureCleanWorkingTree();
  const reset = await runGit(["reset", "--soft", `HEAD~${count}`]);
  const commit = await runGit(["commit", "-m", commitMessage]);
  historyRewritten = true;
  return { reset, commit, status: await gitStatus(), history: await gitHistory() };
}

async function pushToRemote(force = false) {
  const status = await gitStatus();
  const shouldForce = Boolean(force || status.historyRewritten || status.diverged);
  const args = shouldForce
    ? ["push", "--force-with-lease", "origin", "master"]
    : ["push", "origin", "master"];
  const push = await runGit(args);
  historyRewritten = false;
  return { push, forced: shouldForce, status: await gitStatus() };
}

async function commitChanges(message) {
  const commitMessage = String(message || "").trim() || "Update blog content";
  const staged = await runGit(["diff", "--cached", "--name-only"]);
  let commit = {
    command: `git commit -m "${commitMessage}"`,
    stdout: "",
    stderr: "暂存区为空。请先 Stage，再 Commit。",
    skipped: true
  };

  if (staged.stdout) {
    commit = await runGit(["commit", "-m", commitMessage]);
  }

  return {
    staged,
    commit,
    gitStatus: await gitStatus()
  };
}

function notFound(response) {
  sendJson(response, 404, { error: "Not found." });
}

async function routeApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/diagnostics") {
    sendJson(response, 200, {
      storage: "JSON",
      dataFile: path.relative(ROOT, DATA_FILE).replaceAll("\\", "/"),
      frontendEntry: "src/content.ts",
      renderFlow: "src/App.tsx imports posts from src/content.ts and renders the home list.",
      localOnly: true
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/posts") {
    sendJson(response, 200, { posts: enrichPostsForEditing(await readPosts()) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/posts") {
    const payload = JSON.parse(await readRequestBody(request));
    sendJson(response, 200, await savePost(payload));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/markdown/preview") {
    const payload = JSON.parse(await readRequestBody(request) || "{}");
    sendJson(response, 200, renderMarkdownToHtml(payload.markdown || "", {
      preview: true,
      maxChars: MAX_PREVIEW_CHARS,
      maxMath: MAX_PREVIEW_MATH
    }));
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/posts/")) {
    const slug = decodeURIComponent(url.pathname.slice("/api/posts/".length));
    sendJson(response, 200, await deletePost(slug));
    return;
  }

  if (request.method === "POST" && (url.pathname === "/api/git/commit" || url.pathname === "/api/publish")) {
    const payload = JSON.parse(await readRequestBody(request) || "{}");
    sendJson(response, 200, await commitChanges(payload.message));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/git/stage") {
    sendJson(response, 200, await stageChanges());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/git/unstage") {
    sendJson(response, 200, await unstageChanges());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/git/status") {
    sendJson(response, 200, await gitStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/git/history") {
    sendJson(response, 200, await gitHistory(url.searchParams.get("limit") || 8));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/git/amend") {
    const payload = JSON.parse(await readRequestBody(request) || "{}");
    sendJson(response, 200, await amendLastCommit(payload.message));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/git/squash") {
    const payload = JSON.parse(await readRequestBody(request) || "{}");
    sendJson(response, 200, await squashCommits(payload));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/git/squash/preview") {
    const payload = JSON.parse(await readRequestBody(request) || "{}");
    sendJson(response, 200, await previewSquash(payload));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/git/push") {
    const payload = JSON.parse(await readRequestBody(request) || "{}");
    sendJson(response, 200, await pushToRemote(payload.force));
    return;
  }

  notFound(response);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/" || url.pathname === "/admin") {
      await sendAdminHtml(response);
      return;
    }

    if (request.method === "GET" && (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")) {
      await sendFavicon(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/katex/katex.min.css") {
      await sendKatexCss(response);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/katex/fonts/")) {
      await sendKatexFont(response, decodeURIComponent(url.pathname.slice("/katex/fonts/".length)));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await routeApi(request, response, url);
      return;
    }

    notFound(response);
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "Internal server error.",
      details: error.result || error.details || undefined
    });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Gwanhyn Blog Admin is running at http://127.0.0.1:${PORT}/admin`);
});
