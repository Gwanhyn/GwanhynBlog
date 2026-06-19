export type TocHeading = {
  id: string;
  text: string;
  depth: number;
};

export type Post = {
  slug: string;
  title: string;
  date: string;
  category: string;
  tags: string[];
  excerpt: string;
  minutes: number;
  accent: "teal" | "orange" | "gold" | "ink";
};

export type PostDetail = Post & {
  body: string;
  headings: TocHeading[];
};

export const profile = {
  name: "Gwanhyn",
  title: "Student / Builder",
  location: "China",
  bio: "记录工程实践、课程复盘和生活里值得留下的小片段。",
  github: "https://github.com/Gwanhyn",
  email: "mailto:hello@example.com",
  startedAt: "2026"
};

export const focusItems = [
  "用可维护的方式整理课程笔记",
  "给项目补齐可运行的本地开发体验",
  "把读过的文章沉淀成可以复用的索引"
];

const contentBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}content/`;
let postsPromise: Promise<Post[]> | null = null;
const postDetailCache = new Map<string, Promise<PostDetail>>();

async function fetchContent<T>(path: string): Promise<T> {
  const response = await fetch(`${contentBase}${path}`, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Content request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function loadPosts() {
  postsPromise ??= fetchContent<Post[]>("posts-index.json");
  return postsPromise;
}

export function loadPost(slug: string) {
  const safeSlug = encodeURIComponent(slug);
  if (!postDetailCache.has(safeSlug)) {
    postDetailCache.set(safeSlug, fetchContent<PostDetail>(`posts/${safeSlug}.json`));
  }
  return postDetailCache.get(safeSlug)!;
}
