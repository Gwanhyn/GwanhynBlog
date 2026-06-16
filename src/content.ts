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

export const profile = {
  name: "Gwanhy",
  title: "Student / Builder",
  location: "China",
  bio: "记录工程实践、课程复盘和生活里值得留下的小片段。",
  github: "https://github.com/Gwanhyn",
  email: "mailto:hello@example.com",
  startedAt: "2026"
};

export const posts: Post[] = [
  {
    slug: "buildable-blog",
    title: "把博客工程化：从静态产物回到源码",
    date: "2026-06-16",
    category: "Engineering",
    tags: ["Vite", "React", "Blog"],
    excerpt:
      "重新整理个人站点的构建链路，让内容、样式和交互都能在 dev/build/run 三个入口下稳定工作。",
    minutes: 4,
    accent: "teal"
  },
  {
    slug: "os-lab-review",
    title: "一次系统实验后的复盘清单",
    date: "2026-05-28",
    category: "Learning",
    tags: ["OS", "Notes"],
    excerpt:
      "把实验中容易混淆的边界条件、调试路径和最终结论收束成一份短清单，方便后续回看。",
    minutes: 6,
    accent: "orange"
  },
  {
    slug: "reading-papers",
    title: "用更小的步子读论文",
    date: "2026-05-12",
    category: "AI",
    tags: ["Paper", "Method"],
    excerpt:
      "不急着通读全文，先用问题、假设、实验和可复现点拆开阅读压力，慢慢建立自己的判断。",
    minutes: 5,
    accent: "gold"
  },
  {
    slug: "project-readme",
    title: "给项目留一份清楚的 README",
    date: "2026-04-20",
    category: "Engineering",
    tags: ["Docs", "Workflow"],
    excerpt:
      "README 不只是入口文件，也是在未来某天帮自己快速找回上下文的工作台。",
    minutes: 3,
    accent: "ink"
  },
  {
    slug: "weekly-note",
    title: "周末备忘：把生活也写进日志",
    date: "2026-04-02",
    category: "Essay",
    tags: ["Life", "Journal"],
    excerpt:
      "除了课程和项目，也给那些很小但真实的瞬间留一点位置，让博客不只像资料柜。",
    minutes: 2,
    accent: "teal"
  }
];

export const focusItems = [
  "用可维护的方式整理课程笔记",
  "给项目补齐可运行的本地开发体验",
  "把读过的文章沉淀成可以复用的索引"
];
