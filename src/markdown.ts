import katex from "katex";
import "katex/dist/katex.min.css";
import { Marked, Renderer } from "marked";

export type TocHeading = {
  id: string;
  text: string;
  depth: number;
};

function normalizeMarkdown(value: string) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function cleanHtml(html: string) {
  const cleaned = String(html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, "");

  return cleaned.trim() || "<p></p>";
}

function isEscaped(source: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function protectCodeSegments(source: string) {
  const segments: string[] = [];
  let output = "";
  let index = 0;

  const stash = (segment: string) => {
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

function restoreCodeSegments(source: string, segments: string[]) {
  return segments.reduce(
    (text, segment, index) => text.split(`@@GWB_CODE_${index}@@`).join(segment),
    source
  );
}

function findMathEnd(source: string, delimiter: "$" | "$$", start: number) {
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

function renderMath(tex: string, displayMode: boolean) {
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

function renderMarkdownMath(markdown: string) {
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

function stripHeadingMarkdown(value: string) {
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

function baseHeadingId(text: string, fallback: string) {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function uniqueHeadingId(text: string, used: Map<string, number>, index: number) {
  const base = baseHeadingId(text, `section-${index + 1}`);
  const count = used.get(base) || 0;
  used.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

export function extractHeadings(markdown: string): TocHeading[] {
  const used = new Map<string, number>();
  const headings: TocHeading[] = [];
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

export function renderMarkdown(markdown: string) {
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
