import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "src", "data", "posts.json");
const FAVICON_FILE = path.join(ROOT, "public", "favicon.svg");
const PORT = Number(process.env.ADMIN_PORT || 8787);
const ACCENTS = new Set(["teal", "orange", "gold", "ink"]);
let historyRewritten = false;

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

function cleanHtml(html) {
  return String(html || "<p></p>")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
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

function normalizePost(input) {
  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("Title is required.");
  }

  const body = cleanHtml(input.body);
  const plainBody = stripHtml(body);
  const excerpt = String(input.excerpt || plainBody.slice(0, 120)).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ""))
    ? String(input.date)
    : new Date().toISOString().slice(0, 10);
  const accent = ACCENTS.has(input.accent) ? input.accent : "teal";
  const minutes = Math.max(1, Math.round(Number(input.minutes || 3)));

  return {
    slug: slugify(input.slug || title),
    title,
    date,
    category: String(input.category || "Essay").trim() || "Essay",
    tags: normalizeTags(input.tags),
    excerpt,
    body,
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

async function savePost(payload) {
  const posts = await readPosts();
  const originalSlug = payload.originalSlug ? slugify(payload.originalSlug) : "";
  const post = normalizePost(payload.post || {});
  const duplicate = posts.find(
    (item) => item.slug === post.slug && item.slug !== originalSlug
  );

  if (duplicate) {
    const error = new Error(`Slug "${post.slug}" already exists.`);
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
  return { post, posts: sorted };
}

async function deletePost(slug) {
  const normalizedSlug = slugify(slug);
  const posts = await readPosts();
  const nextPosts = posts.filter((post) => post.slug !== normalizedSlug);

  if (nextPosts.length === posts.length) {
    const error = new Error(`Post "${normalizedSlug}" was not found.`);
    error.status = 404;
    throw error;
  }

  await writePosts(nextPosts);
  return { posts: nextPosts };
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
    const error = new Error("Working tree must be clean before squashing history.");
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
    const error = new Error("A new commit message is required for squash.");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(count) || count < 2) {
    const error = new Error("Squash count must be at least 2.");
    error.status = 400;
    throw error;
  }

  const total = Number((await runGit(["rev-list", "--count", "HEAD"])).stdout);
  if (count >= total) {
    const error = new Error("Cannot squash all commits from the root commit in this panel.");
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
    stderr: "No local changes to commit.",
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
    sendJson(response, 200, { posts: await readPosts() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/posts") {
    const payload = JSON.parse(await readRequestBody(request));
    sendJson(response, 200, await savePost(payload));
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

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Gwanhyn Blog Admin</title>
    <style>
      :root {
        color: #182326;
        background: #f4f7f6;
        font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      }

      * { box-sizing: border-box; }
      body {
        min-width: 320px;
        min-height: 100vh;
        margin: 0;
        background:
          radial-gradient(circle at 12% 18%, rgba(80, 128, 142, 0.15), transparent 28%),
          radial-gradient(circle at 82% 0%, rgba(247, 135, 54, 0.12), transparent 24%),
          #f4f7f6;
      }

      button, input, textarea, select { font: inherit; }
      button { cursor: pointer; }

      .shell {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 32px 0;
      }

      .topbar,
      .panel,
      .post-row,
      .editor,
      .toast {
        border: 1px solid rgba(24, 35, 38, 0.1);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.72);
        box-shadow: 0 18px 60px rgba(24, 35, 38, 0.1);
        backdrop-filter: blur(20px);
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px;
      }

      h1, h2, p { margin: 0; }
      h1 { font-size: 1.35rem; }
      h2 { font-size: 1rem; }
      .muted { color: #657477; }

      .actions,
      .toolbar,
      .field-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .button,
      .icon-button {
        min-height: 38px;
        border: 1px solid rgba(24, 35, 38, 0.12);
        border-radius: 8px;
        padding: 0 12px;
        color: #182326;
        background: rgba(255, 255, 255, 0.78);
        font-weight: 750;
      }

      .button.primary {
        color: #fff;
        border-color: transparent;
        background: #50808e;
      }

      .button.danger {
        color: #9f1f2f;
      }

      .grid {
        display: grid;
        grid-template-columns: 330px minmax(0, 1fr);
        gap: 18px;
        margin-top: 18px;
        align-items: start;
      }

      .sidebar-stack {
        display: grid;
        gap: 18px;
      }

      .panel {
        padding: 18px;
      }

      .diagnostics {
        display: grid;
        gap: 8px;
        margin-top: 12px;
        color: #657477;
        font-size: 0.92rem;
      }

      .post-list {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }

      .post-row {
        width: 100%;
        padding: 14px;
        text-align: left;
      }

      .post-row.active {
        border-color: rgba(80, 128, 142, 0.55);
        box-shadow: 0 14px 36px rgba(80, 128, 142, 0.18);
      }

      .post-row strong {
        display: block;
        color: #182326;
        line-height: 1.4;
      }

      .post-row span {
        display: block;
        margin-top: 6px;
        color: #657477;
        font-size: 0.88rem;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        border: 1px solid rgba(24, 35, 38, 0.1);
        border-radius: 999px;
        padding: 0 10px;
        color: #3d4c4f;
        background: rgba(255, 255, 255, 0.66);
        font-size: 0.82rem;
        font-weight: 750;
      }

      .status-pill.warning {
        color: #9f5b1f;
        background: rgba(247, 135, 54, 0.14);
      }

      .history-panel {
        overflow: hidden;
      }

      .history-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
      }

      .history-actions {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }

      .history-action-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
      }

      .timeline {
        position: relative;
        display: grid;
        gap: 12px;
        margin-top: 16px;
        padding-left: 18px;
      }

      .timeline::before {
        position: absolute;
        inset: 5px auto 5px 5px;
        width: 1px;
        content: "";
        background: rgba(80, 128, 142, 0.26);
      }

      .commit-card {
        position: relative;
        border: 1px solid rgba(24, 35, 38, 0.1);
        border-radius: 8px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.58);
      }

      .commit-card::before {
        position: absolute;
        top: 16px;
        left: -17px;
        width: 9px;
        height: 9px;
        border: 2px solid #50808e;
        border-radius: 999px;
        content: "";
        background: #f4f7f6;
      }

      .commit-card strong {
        display: block;
        color: #182326;
        line-height: 1.35;
      }

      .commit-card span {
        display: block;
        margin-top: 6px;
        color: #657477;
        font-size: 0.82rem;
      }

      .loading {
        position: relative;
        pointer-events: none;
        opacity: 0.7;
      }

      .loading::after {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(80, 128, 142, 0.22);
        border-top-color: #50808e;
        border-radius: 999px;
        content: "";
        animation: spin 800ms linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .form {
        display: grid;
        gap: 14px;
      }

      label {
        display: grid;
        gap: 7px;
        color: #3d4c4f;
        font-size: 0.92rem;
        font-weight: 700;
      }

      input,
      textarea,
      select,
      .editor {
        width: 100%;
        border: 1px solid rgba(24, 35, 38, 0.12);
        border-radius: 8px;
        padding: 11px 12px;
        color: #182326;
        background: rgba(255, 255, 255, 0.72);
        outline: 0;
      }

      textarea {
        min-height: 82px;
        resize: vertical;
      }

      .field-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .toolbar {
        margin-bottom: 10px;
      }

      .icon-button {
        width: 38px;
        padding: 0;
      }

      .editor {
        min-height: 300px;
        overflow: auto;
        line-height: 1.8;
      }

      .editor:focus {
        border-color: rgba(80, 128, 142, 0.65);
        box-shadow: 0 0 0 4px rgba(80, 128, 142, 0.12);
      }

      .publish-box {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
      }

      .toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        max-width: min(440px, calc(100% - 40px));
        padding: 14px 16px;
        color: #182326;
        white-space: pre-wrap;
      }

      .hidden { display: none; }

      @media (max-width: 860px) {
        .grid,
        .field-row,
        .publish-box,
        .history-action-row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <h1>Gwanhyn Blog Admin</h1>
          <p class="muted">Local visual editor</p>
        </div>
        <div class="actions">
          <button class="button" id="refreshButton" type="button">Refresh</button>
          <button class="button primary" id="newButton" type="button">New</button>
        </div>
      </header>

      <div class="grid">
        <aside class="sidebar-stack">
          <section class="panel">
            <h2>Data Flow</h2>
            <div class="diagnostics" id="diagnostics"></div>
            <div class="post-list" id="postList"></div>
          </section>

          <section class="panel history-panel" id="historyPanel">
            <div class="history-head">
              <div>
                <h2>Git History</h2>
                <p class="muted" id="gitStatusText">Loading history...</p>
              </div>
              <span class="status-pill" id="gitBranchBadge">master</span>
            </div>

            <div class="history-actions">
              <button class="button" id="draftButton" type="button">Save Draft</button>
              <div class="history-action-row">
                <input id="amendMessageInput" placeholder="Amend message, optional" />
                <button class="button" id="amendButton" type="button">Amend</button>
              </div>
              <div class="history-action-row">
                <input id="squashCountInput" type="number" min="2" value="2" />
                <button class="button" id="squashButton" type="button">Squash</button>
              </div>
              <input id="squashMessageInput" placeholder="New squash commit message" />
              <button class="button primary" id="gitPushButton" type="button">Push</button>
            </div>

            <div class="timeline" id="gitTimeline"></div>
          </section>
        </aside>

        <section class="panel">
          <form class="form" id="editorForm">
            <div class="field-row">
              <label>Title<input id="titleInput" required /></label>
              <label>Slug<input id="slugInput" /></label>
              <label>Date<input id="dateInput" type="date" required /></label>
            </div>
            <div class="field-row">
              <label>Category<input id="categoryInput" /></label>
              <label>Tags<input id="tagsInput" placeholder="React, Notes" /></label>
              <label>
                Accent
                <select id="accentInput">
                  <option value="teal">teal</option>
                  <option value="orange">orange</option>
                  <option value="gold">gold</option>
                  <option value="ink">ink</option>
                </select>
              </label>
            </div>
            <div class="field-row">
              <label>Minutes<input id="minutesInput" type="number" min="1" step="1" /></label>
              <label style="grid-column: span 2;">Excerpt<textarea id="excerptInput"></textarea></label>
            </div>

            <div>
              <div class="toolbar" aria-label="Editor toolbar">
                <button class="icon-button" type="button" data-command="bold" title="Bold">B</button>
                <button class="icon-button" type="button" data-command="italic" title="Italic">I</button>
                <button class="icon-button" type="button" data-block="h2" title="Heading">H</button>
                <button class="icon-button" type="button" data-command="insertUnorderedList" title="List">•</button>
                <button class="icon-button" type="button" data-command="formatBlock" data-value="blockquote" title="Quote">“</button>
              </div>
              <div class="editor" id="bodyEditor" contenteditable="true"></div>
            </div>

            <div class="actions">
              <button class="button primary" type="submit">Save</button>
              <button class="button danger" id="deleteButton" type="button">Delete</button>
            </div>
          </form>

          <div class="publish-box" style="margin-top: 18px;">
            <input id="commitInput" value="Update blog content" />
            <button class="button primary" id="publishButton" type="button">Publish</button>
          </div>
        </section>
      </div>
    </main>
    <div class="toast hidden" id="toast"></div>

    <script>
      const state = {
        posts: [],
        originalSlug: "",
        gitHistory: [],
        gitStatus: null,
        busy: false
      };
      const fields = {
        title: document.querySelector("#titleInput"),
        slug: document.querySelector("#slugInput"),
        date: document.querySelector("#dateInput"),
        category: document.querySelector("#categoryInput"),
        tags: document.querySelector("#tagsInput"),
        accent: document.querySelector("#accentInput"),
        minutes: document.querySelector("#minutesInput"),
        excerpt: document.querySelector("#excerptInput"),
        body: document.querySelector("#bodyEditor"),
        commit: document.querySelector("#commitInput"),
        amendMessage: document.querySelector("#amendMessageInput"),
        squashCount: document.querySelector("#squashCountInput"),
        squashMessage: document.querySelector("#squashMessageInput")
      };

      function showToast(message) {
        const toast = document.querySelector("#toast");
        toast.textContent = message;
        toast.classList.remove("hidden");
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 4200);
      }

      async function api(path, options = {}) {
        const response = await fetch(path, {
          headers: { "content-type": "application/json" },
          ...options
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Request failed.");
        }
        return data;
      }

      function setBusy(isBusy) {
        state.busy = isBusy;
        document.querySelector("#historyPanel").classList.toggle("loading", isBusy);
      }

      function escapeHtml(value) {
        return String(value || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function today() {
        return new Date().toISOString().slice(0, 10);
      }

      function emptyPost() {
        return {
          slug: "",
          title: "",
          date: today(),
          category: "Essay",
          tags: [],
          excerpt: "",
          body: "<p></p>",
          minutes: 3,
          accent: "teal"
        };
      }

      function selectPost(post) {
        state.originalSlug = post.slug || "";
        fields.title.value = post.title || "";
        fields.slug.value = post.slug || "";
        fields.date.value = post.date || today();
        fields.category.value = post.category || "Essay";
        fields.tags.value = (post.tags || []).join(", ");
        fields.accent.value = post.accent || "teal";
        fields.minutes.value = post.minutes || 3;
        fields.excerpt.value = post.excerpt || "";
        fields.body.innerHTML = post.body || "<p></p>";
        renderList();
      }

      function readForm() {
        return {
          title: fields.title.value,
          slug: fields.slug.value,
          date: fields.date.value,
          category: fields.category.value,
          tags: fields.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
          accent: fields.accent.value,
          minutes: Number(fields.minutes.value || 3),
          excerpt: fields.excerpt.value,
          body: fields.body.innerHTML
        };
      }

      function renderList() {
        const list = document.querySelector("#postList");
        list.innerHTML = state.posts.map((post) => (
          '<button class="post-row ' + (post.slug === state.originalSlug ? "active" : "") + '" type="button" data-slug="' + escapeHtml(post.slug) + '">' +
            "<strong>" + escapeHtml(post.title) + "</strong>" +
            "<span>" + escapeHtml(post.date) + " · " + escapeHtml(post.category) + "</span>" +
          "</button>"
        )).join("");

        list.querySelectorAll("[data-slug]").forEach((button) => {
          button.addEventListener("click", () => {
            const post = state.posts.find((item) => item.slug === button.dataset.slug);
            if (post) selectPost(post);
          });
        });
      }

      function renderGitPanel() {
        const status = state.gitStatus || {};
        const badge = document.querySelector("#gitBranchBadge");
        const statusText = document.querySelector("#gitStatusText");
        const timeline = document.querySelector("#gitTimeline");
        const dirtyText = status.dirty ? "Unsaved Git changes" : "Clean working tree";
        const rewriteText = status.historyRewritten ? " · rewrite pending" : "";

        badge.textContent = status.branch || "master";
        badge.classList.toggle("warning", Boolean(status.dirty || status.historyRewritten));
        statusText.textContent = dirtyText + rewriteText;

        timeline.innerHTML = state.gitHistory.map((commit) => (
          '<article class="commit-card" title="' + escapeHtml(commit.hash) + '">' +
            "<strong>" + escapeHtml(commit.subject) + "</strong>" +
            "<span>" + escapeHtml(commit.shortHash) + " · " + escapeHtml(commit.relativeTime) + " · " + escapeHtml(commit.author) + "</span>" +
          "</article>"
        )).join("");
      }

      async function loadGit() {
        const data = await api("/api/git/history?limit=8");
        state.gitHistory = data.commits || [];
        state.gitStatus = data.status || null;
        renderGitPanel();
      }

      async function saveCurrentPost() {
        const data = await api("/api/posts", {
          method: "POST",
          body: JSON.stringify({ originalSlug: state.originalSlug, post: readForm() })
        });
        state.posts = data.posts;
        selectPost(data.post);
        await loadGit();
        return data;
      }

      async function load() {
        const [diagnostics, postsData] = await Promise.all([
          api("/api/diagnostics"),
          api("/api/posts")
        ]);
        state.posts = postsData.posts;
        document.querySelector("#diagnostics").innerHTML = [
          "Storage: " + diagnostics.storage,
          "Data: " + diagnostics.dataFile,
          "Flow: " + diagnostics.renderFlow
        ].map(escapeHtml).join("<br />");
        renderList();
        selectPost(state.posts[0] || emptyPost());
        await loadGit();
      }

      document.querySelector("#newButton").addEventListener("click", () => selectPost(emptyPost()));
      document.querySelector("#refreshButton").addEventListener("click", () => load().then(() => showToast("Reloaded.")));

      document.querySelectorAll("[data-command]").forEach((button) => {
        button.addEventListener("click", () => {
          document.execCommand(button.dataset.command, false, button.dataset.value || null);
          fields.body.focus();
        });
      });

      document.querySelector("[data-block]").addEventListener("click", () => {
        document.execCommand("formatBlock", false, "h2");
        fields.body.focus();
      });

      document.querySelector("#editorForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        await saveCurrentPost();
        showToast("Saved to src/data/posts.json.");
      });

      document.querySelector("#draftButton").addEventListener("click", async () => {
        try {
          setBusy(true);
          await saveCurrentPost();
          showToast("Draft saved without committing.");
        } catch (error) {
          showToast(error.message);
        } finally {
          setBusy(false);
        }
      });

      document.querySelector("#deleteButton").addEventListener("click", async () => {
        if (!state.originalSlug || !window.confirm("Delete this post?")) return;
        const data = await api("/api/posts/" + encodeURIComponent(state.originalSlug), {
          method: "DELETE"
        });
        state.posts = data.posts;
        selectPost(state.posts[0] || emptyPost());
        await loadGit();
        showToast("Deleted.");
      });

      document.querySelector("#publishButton").addEventListener("click", async () => {
        const data = await api("/api/publish", {
          method: "POST",
          body: JSON.stringify({
            message: fields.commit.value,
            force: Boolean(state.gitStatus && state.gitStatus.historyRewritten)
          })
        });
        await loadGit();
        showToast([
          data.add.command,
          data.commit.skipped ? data.commit.stderr : data.commit.stdout,
          data.push.stdout || data.push.stderr || data.push.command
        ].filter(Boolean).join("\n"));
      });

      document.querySelector("#amendButton").addEventListener("click", async () => {
        try {
          setBusy(true);
          const data = await api("/api/git/amend", {
            method: "POST",
            body: JSON.stringify({ message: fields.amendMessage.value })
          });
          await loadGit();
          showToast(data.commit.stdout || data.commit.stderr || "Amended latest commit.");
        } catch (error) {
          showToast(error.message);
        } finally {
          setBusy(false);
        }
      });

      document.querySelector("#squashButton").addEventListener("click", async () => {
        const count = Number(fields.squashCount.value || 2);
        const message = fields.squashMessage.value.trim() || window.prompt("New squash commit message", "Update blog content");
        if (!message) return;

        try {
          setBusy(true);
          const data = await api("/api/git/squash", {
            method: "POST",
            body: JSON.stringify({ count, message })
          });
          state.gitHistory = data.history.commits || [];
          state.gitStatus = data.status || data.history.status || null;
          renderGitPanel();
          showToast(data.commit.stdout || "Squashed recent commits.");
        } catch (error) {
          showToast(error.message);
        } finally {
          setBusy(false);
        }
      });

      document.querySelector("#gitPushButton").addEventListener("click", async () => {
        try {
          setBusy(true);
          const data = await api("/api/git/push", {
            method: "POST",
            body: JSON.stringify({
              force: Boolean(state.gitStatus && state.gitStatus.historyRewritten)
            })
          });
          await loadGit();
          showToast((data.forced ? "Force-with-lease push complete.\n" : "Push complete.\n") + (data.push.stdout || data.push.stderr || data.push.command));
        } catch (error) {
          showToast(error.message);
        } finally {
          setBusy(false);
        }
      });

      load().catch((error) => showToast(error.message));
    </script>
  </body>
</html>`;

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/" || url.pathname === "/admin") {
      sendHtml(response, ADMIN_HTML);
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
