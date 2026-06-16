import postsData from "./data/posts.json";

export type Post = {
  slug: string;
  title: string;
  date: string;
  category: string;
  tags: string[];
  excerpt: string;
  body: string;
  minutes: number;
  accent: "teal" | "orange" | "gold" | "ink";
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

export const posts = postsData as Post[];

export const focusItems = [
  "用可维护的方式整理课程笔记",
  "给项目补齐可运行的本地开发体验",
  "把读过的文章沉淀成可以复用的索引"
];
