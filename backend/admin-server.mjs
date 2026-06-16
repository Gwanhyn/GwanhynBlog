import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ADMIN_HTML_FILE = path.join(__dirname, "admin.html");
const DATA_FILE = path.join(ROOT, "src", "data", "posts.json");
const FAVICON_FILE = path.join(ROOT, "public", "favicon.svg");
const PORT = Number(process.env.ADMIN_PORT || 8787);
const ACCENTS = new Set(["teal", "orange", "gold", "ink"]);
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

function markdownToHtml(markdown) {
  const source = normalizeMarkdown(markdown);
  if (!source) {
    return "<p></p>";
  }

  return cleanHtml(marked.parse(source));
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
  const excerpt = String(input.excerpt || plainBody.slice(0, 140)).trim();
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
  const [branch, status] = await Promise.all([
    runGit(["branch", "--show-current"]),
    runGit(["status", "--porcelain"])
  ]);

  return {
    branch: branch.stdout || "master",
    dirty: Boolean(status.stdout),
    entries: status.stdout ? status.stdout.split("\n") : [],
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

async function amendLastCommit(message) {
  const commitMessage = String(message || "").trim();
  const add = await runGit(["add", "-A"]);
  const args = ["commit", "--amend"];

  if (commitMessage) {
    args.push("-m", commitMessage);
  } else {
    args.push("--no-edit");
  }

  const commit = await runGit(args);
  historyRewritten = true;
  return { add, commit, status: await gitStatus() };
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

async function squashCommits(payload) {
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

  await ensureCleanWorkingTree();
  const reset = await runGit(["reset", "--soft", `HEAD~${count}`]);
  const commit = await runGit(["commit", "-m", commitMessage]);
  historyRewritten = true;
  return { reset, commit, status: await gitStatus(), history: await gitHistory() };
}

async function pushToRemote(force = false) {
  const shouldForce = Boolean(force || historyRewritten);
  const args = shouldForce
    ? ["push", "--force-with-lease", "origin", "master"]
    : ["push", "origin", "master"];
  const push = await runGit(args);
  historyRewritten = false;
  return { push, forced: shouldForce, status: await gitStatus() };
}

async function publish(message, options = {}) {
  const commitMessage = String(message || "Update blog content").trim();
  const add = await runGit(["add", "-A"]);
  const status = await runGit(["status", "--porcelain"]);
  let commit = {
    command: `git commit -m "${commitMessage}"`,
    stdout: "",
    stderr: "没有需要提交的本地改动。",
    skipped: true
  };

  if (status.stdout) {
    commit = await runGit(["commit", "-m", commitMessage]);
  }

  const pushResult = await pushToRemote(options.force);
  return {
    add,
    status,
    commit,
    push: pushResult.push,
    forced: pushResult.forced,
    gitStatus: pushResult.status
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
    const html = markdownToHtml(payload.markdown || "");
    sendJson(response, 200, { html, text: stripHtml(html) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/posts/")) {
    const slug = decodeURIComponent(url.pathname.slice("/api/posts/".length));
    sendJson(response, 200, await deletePost(slug));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/publish") {
    const payload = JSON.parse(await readRequestBody(request) || "{}");
    sendJson(response, 200, await publish(payload.message, { force: payload.force }));
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
