import { rm, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import katex from "katex";
import { Marked, Renderer } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "src", "data", "posts.json");
const OUTPUT_DIR = path.join(ROOT, "public", "content");
const POSTS_DIR = path.join(OUTPUT_DIR, "posts");
const ACCENTS = new Set(["teal", "orange", "gold", "ink"]);

function findJsonArrayEnd(source) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return -1;
}

function parsePostsJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const trimmed = String(raw || "").trimStart();
    if (!trimmed.startsWith("[")) {
      throw error;
    }

    const offset = raw.length - trimmed.length;
    const end = findJsonArrayEnd(trimmed);
    if (end === -1) {
      throw error;
    }

    const posts = JSON.parse(raw.slice(offset, offset + end));
    console.warn("Warning: ignored trailing content after the first posts JSON array.");
    return posts;
  }
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

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function cleanHtml(html) {
  const cleaned = String(html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, "");

  return cleaned.trim() || "<p></p>";
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plainMarkdown(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_\-[\]()`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateReadingMinutes(text) {
  const plain = String(text || "").trim();
  const cjkCount = (plain.match(/[\u3400-\u9fff]/g) || []).length;
  const wordCount = (plain.replace(/[\u3400-\u9fff]/g, " ").match(/[a-z0-9]+/gi) || []).length;
  return Math.max(1, Math.round((cjkCount + wordCount) / 320) || 1);
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

function renderMarkdownMath(markdown) {
  const { text, segments } = protectCodeSegments(markdown);
  let output = "";
  let index = 0;

  while (index < text.length) {
    if (text.startsWith("$$", index) && !isEscaped(text, index)) {
      const end = findMathEnd(text, "$$", index + 2);
      if (end !== -1) {
        output += `\n\n${renderMath(text.slice(index + 2, end), true)}\n\n`;
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "$" && !isEscaped(text, index)) {
      const next = text[index + 1] || "";
      const end = /\s/.test(next) ? -1 : findMathEnd(text, "$", index + 1);
      const previous = end > index ? text[end - 1] || "" : "";

      if (end !== -1 && !/\s/.test(previous)) {
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

function stripHeadingMarkdown(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\$\$([\s\S]+?)\$\$/g, "$1")
    .replace(/\$([^$\n]+?)\$/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function baseHeadingId(text, fallback) {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function uniqueHeadingId(text, used, index) {
  const base = baseHeadingId(text, `section-${index + 1}`);
  const count = used.get(base) || 0;
  used.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

function extractHeadings(markdown) {
  const used = new Map();
  const headings = [];
  let inFence = false;
  let fenceMark = "";

  normalizeMarkdown(markdown)
    .split("\n")
    .forEach((line) => {
      const fence = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (fence) {
        const mark = fence[2][0];
        if (!inFence) {
          inFence = true;
          fenceMark = mark;
        } else if (mark === fenceMark) {
          inFence = false;
          fenceMark = "";
        }
        return;
      }

      if (inFence) {
        return;
      }

      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!match) {
        return;
      }

      const text = stripHeadingMarkdown(match[2]);
      if (!text) {
        return;
      }

      headings.push({
        id: uniqueHeadingId(text, used, headings.length),
        text,
        depth: match[1].length
      });
    });

  return headings;
}

function renderMarkdown(markdown) {
  const source = normalizeMarkdown(markdown);
  const headings = extractHeadings(source);

  if (!source) {
    return { html: "<p></p>", headings };
  }

  let headingIndex = 0;
  const renderer = new Renderer();
  renderer.heading = function heading(token) {
    const heading = headings[headingIndex];
    headingIndex += 1;

    const depth = Math.min(Math.max(token.depth, 1), 6);
    const id = heading?.id || `section-${headingIndex}`;
    const text = this.parser.parseInline(token.tokens);
    return `<h${depth} id="${escapeAttribute(id)}">${text}</h${depth}>\n`;
  };

  const parser = new Marked({ gfm: true, breaks: false, renderer });
  const html = parser.parse(renderMarkdownMath(source), { async: false });
  return { html: cleanHtml(html), headings };
}

function removeDuplicateTitleHeading(markdown, title) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim());

  if (firstContentIndex === -1) {
    return markdown;
  }

  const match = lines[firstContentIndex].match(/^#\s+(.+?)\s*#*\s*$/);
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  if (match && normalize(match[1]) === normalize(title)) {
    return [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)]
      .join("\n")
      .trim();
  }

  return markdown;
}

function headingsFromHtml(html) {
  return Array.from(String(html || "").matchAll(/<h([1-6])[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h\1>/gi))
    .map((match) => ({
      depth: Number(match[1]),
      id: match[2],
      text: stripHtml(match[3])
    }));
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

function publicPost(post) {
  const title = String(post.title || "").trim();
  const markdown = removeDuplicateTitleHeading(normalizeMarkdown(post.markdown || ""), title);
  const rendered = markdown
    ? renderMarkdown(markdown)
    : { html: cleanHtml(post.body || ""), headings: headingsFromHtml(post.body || "") };
  const text = markdown ? plainMarkdown(markdown) : stripHtml(rendered.html);
  const excerpt = String(post.excerpt || "").trim();

  const summary = {
    slug: String(post.slug || "").trim(),
    title,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(post.date || ""))
      ? String(post.date)
      : new Date().toISOString().slice(0, 10),
    category: String(post.category || "Essay").trim() || "Essay",
    tags: normalizeTags(post.tags),
    excerpt,
    minutes: Math.max(1, Math.round(Number(post.minutes || estimateReadingMinutes(text)))),
    accent: ACCENTS.has(post.accent) ? post.accent : "teal"
  };

  return {
    summary,
    detail: {
      ...summary,
      body: rendered.html,
      headings: rendered.headings
    }
  };
}

async function main() {
  const raw = await readFile(SOURCE_FILE, "utf8");
  const sourcePosts = parsePostsJson(raw);
  const posts = Array.isArray(sourcePosts) ? sourcePosts : [];

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(POSTS_DIR, { recursive: true });

  const summaries = [];
  for (const post of posts) {
    const { summary, detail } = publicPost(post);
    if (!summary.slug || !summary.title) {
      continue;
    }

    summaries.push(summary);
    await writeFile(
      path.join(POSTS_DIR, `${summary.slug}.json`),
      `${JSON.stringify(detail)}\n`,
      "utf8"
    );
  }

  summaries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.title).localeCompare(String(b.title)));
  await writeFile(path.join(OUTPUT_DIR, "posts-index.json"), `${JSON.stringify(summaries)}\n`, "utf8");

  if (!process.argv.includes("--quiet")) {
    console.log(`Generated ${summaries.length} posts in ${path.relative(ROOT, OUTPUT_DIR).replaceAll("\\", "/")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
