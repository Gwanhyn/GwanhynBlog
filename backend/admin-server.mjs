import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "src", "data", "posts.json");
const PORT = Number(process.env.ADMIN_PORT || 8787);
const ACCENTS = new Set(["teal", "orange", "gold", "ink"]);

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

async function publish(message) {
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

  const push = await runGit(["push", "origin", "master"]);
  return { add, status, commit, push };
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
    sendJson(response, 200, await publish(payload.message));
    return;
  }

  notFound(response);
}

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
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
        .publish-box {
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
        <aside class="panel">
          <h2>Data Flow</h2>
          <div class="diagnostics" id="diagnostics"></div>
          <div class="post-list" id="postList"></div>
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
      const state = { posts: [], originalSlug: "" };
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
        commit: document.querySelector("#commitInput")
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
        const data = await api("/api/posts", {
          method: "POST",
          body: JSON.stringify({ originalSlug: state.originalSlug, post: readForm() })
        });
        state.posts = data.posts;
        selectPost(data.post);
        showToast("Saved to src/data/posts.json.");
      });

      document.querySelector("#deleteButton").addEventListener("click", async () => {
        if (!state.originalSlug || !window.confirm("Delete this post?")) return;
        const data = await api("/api/posts/" + encodeURIComponent(state.originalSlug), {
          method: "DELETE"
        });
        state.posts = data.posts;
        selectPost(state.posts[0] || emptyPost());
        showToast("Deleted.");
      });

      document.querySelector("#publishButton").addEventListener("click", async () => {
        const data = await api("/api/publish", {
          method: "POST",
          body: JSON.stringify({ message: fields.commit.value })
        });
        showToast([
          data.add.command,
          data.commit.skipped ? data.commit.stderr : data.commit.stdout,
          data.push.stdout || data.push.stderr || data.push.command
        ].filter(Boolean).join("\n"));
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

    if (url.pathname.startsWith("/api/")) {
      await routeApi(request, response, url);
      return;
    }

    notFound(response);
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "Internal server error.",
      details: error.result || undefined
    });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Gwanhyn Blog Admin is running at http://127.0.0.1:${PORT}/admin`);
});
