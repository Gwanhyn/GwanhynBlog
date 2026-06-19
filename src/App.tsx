import {
  Archive,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Clock3,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Home,
  Mail,
  Moon,
  Search,
  Sun,
  Tag,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  focusItems,
  loadPost,
  loadPosts,
  profile,
  resourceItems,
  type Post,
  type PostDetail,
  type TocHeading
} from "./content";

type Theme = "light" | "dark";
type View = "home" | "archives" | "categories" | "about" | "post";

const navItems: Array<{ view: View; label: string; icon: typeof Home }> = [
  { view: "home", label: "Home", icon: Home },
  { view: "archives", label: "Archives", icon: Archive },
  { view: "categories", label: "Resources", icon: FolderOpen },
  { view: "about", label: "About", icon: UserRound }
];

function getInitialTheme(): Theme {
  const saved = window.localStorage.getItem("gwanhyn-theme");
  if (saved === "light" || saved === "dark") {
    return saved;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(`${date}T00:00:00`));
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const [route, value] = hash.split("/");
  return { route, value: value ? decodeURIComponent(value) : "" };
}

const SITE_STARTED_AT = new Date("2026-06-19T13:27:10+08:00").getTime();

function formatDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}D ${String(hours).padStart(2, "0")}H ${String(minutes).padStart(2, "0")}M ${String(seconds).padStart(2, "0")}S`;
}

function App() {
  const homeScrollPosition = useRef(0);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [posts, setPosts] = useState<Post[]>([]);
  const [contentStatus, setContentStatus] = useState<"loading" | "ready" | "error">("loading");
  const [contentError, setContentError] = useState("");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("gwanhyn-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    loadPosts()
      .then((items) => {
        if (cancelled) return;
        setPosts(items);
        setContentStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setContentError(error instanceof Error ? error.message : "内容索引加载失败。");
        setContentStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const syncFromHash = () => {
      const { route, value } = parseHash();
      if (route === "post" && value) {
        const post = posts.find((item) => item.slug === value);
        if (post) {
          setSelectedPost(post);
          setView("post");
          return;
        }

        if (!posts.length && contentStatus === "loading") {
          setSelectedPost(null);
          setView("post");
          return;
        }
      }

      if (route === "archives" || route === "categories" || route === "about" || route === "home") {
        setSelectedPost(null);
        setView(route);
        return;
      }

      setSelectedPost(null);
      setView("home");
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [contentStatus, posts]);

  const categories = useMemo(() => {
    const counts = posts.reduce<Record<string, number>>((acc, post) => {
      acc[post.category] = (acc[post.category] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [posts]);

  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return posts.filter((post) => {
      const matchesCategory = category === "All" || post.category === category;
      const text = [post.title, post.excerpt, post.category, ...post.tags]
        .join(" ")
        .toLowerCase();

      return matchesCategory && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [category, posts, query]);

  const archiveGroups = useMemo(() => {
    return posts.reduce<Record<string, Post[]>>((acc, post) => {
      const year = post.date.slice(0, 4);
      acc[year] = [...(acc[year] ?? []), post];
      return acc;
    }, {});
  }, [posts]);

  const totalWords = useMemo(
    () => posts.reduce((sum, post) => sum + Number(post.wordCount || 0), 0),
    [posts]
  );

  const changeView = (nextView: View, options: { restoreHomeScroll?: boolean } = {}) => {
    setView(nextView);
    if (nextView !== "post") {
      setSelectedPost(null);
    }
    window.location.hash = nextView === "home" ? "home" : nextView;
    const top = options.restoreHomeScroll ? homeScrollPosition.current : 0;
    window.setTimeout(() => window.scrollTo({ top, behavior: "auto" }), 0);
  };

  const openPost = (post: Post) => {
    homeScrollPosition.current = window.scrollY;
    setSelectedPost(post);
    setView("post");
    window.location.hash = `post/${encodeURIComponent(post.slug)}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => changeView("home")}
          title="Gwanhyn Blog"
        >
          <span className="brand-mark">G</span>
          <span>Gwanhyn Blog</span>
        </button>

        <nav className="nav-links" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={view === item.view ? "nav-link active" : "nav-link"}
                type="button"
                key={item.view}
                onClick={() => changeView(item.view)}
                title={item.label}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          className="icon-button"
          type="button"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <main className={view === "post" ? "post-main" : undefined}>
        {view !== "post" && (
          <section className="hero">
            <div className="hero-overlay" />
            <div className="hero-content">
              <p className="eyebrow">Personal notes and engineering logs</p>
              <h1>Gwanhyn Blog</h1>
              <p className="hero-subtitle">Never give up. Keep shipping, keep learning.</p>
              <div className="hero-actions" aria-label="Hero links">
                <button className="hero-button" type="button" onClick={() => changeView("home")}>
                  <BookOpen size={18} />
                  <span>Read Notes</span>
                </button>
                <a className="hero-button subtle" href={profile.github}>
                  <GitBranch size={18} />
                  <span>GitHub</span>
                </a>
              </div>
            </div>
          </section>
        )}

        <div className={view === "post" ? "page-shell reading-shell" : "page-shell"}>
          <aside className="sidebar" aria-label="Author profile">
            <section className="profile-panel">
              <div className="avatar" aria-hidden="true">
                G
              </div>
              <h2>{profile.name}</h2>
              <p className="role">{profile.title}</p>
              <p>{profile.bio}</p>
              <div className="profile-meta">
                <span>{profile.location}</span>
                <span>Since {profile.startedAt}</span>
              </div>
              <div className="profile-links">
                <a href={profile.github} title="GitHub">
                  <GitBranch size={17} />
                  <span>GitHub</span>
                </a>
                <a href={profile.email} title="Email">
                  <Mail size={17} />
                  <span>Email</span>
                </a>
              </div>
            </section>

            <section className="side-panel">
              <h3>Stats</h3>
              <dl className="stats">
                <div>
                  <dt>Posts</dt>
                  <dd>{posts.length}</dd>
                </div>
                <div>
                  <dt>Categories</dt>
                  <dd>{categories.length}</dd>
                </div>
                <div>
                  <dt>Tags</dt>
                  <dd>{new Set(posts.flatMap((post) => post.tags)).size}</dd>
                </div>
              </dl>
            </section>
          </aside>

          <section className="content-area">
            {view === "home" && (
              <HomeView
                categories={categories}
                category={category}
                contentError={contentError}
                contentStatus={contentStatus}
                filteredPosts={filteredPosts}
                postsCount={posts.length}
                query={query}
                setCategory={setCategory}
                setQuery={setQuery}
                onPostOpen={openPost}
              />
            )}

            {view === "archives" && <ArchiveView archiveGroups={archiveGroups} />}

            {view === "categories" && (
              <ResourcesView />
            )}

            {view === "about" && <AboutView />}

            {view === "post" && selectedPost && (
              <ArticleView post={selectedPost} onBack={() => changeView("home", { restoreHomeScroll: true })} />
            )}

            {view === "post" && !selectedPost && (
              <ContentState
                message={contentStatus === "loading" ? "文章索引加载中" : "没有找到这篇文章"}
                detail={contentStatus === "error" ? contentError : "请稍后重试，或返回首页重新选择文章。"}
              />
            )}
          </section>
        </div>
      </main>

      <SiteFooter postsCount={posts.length} totalWords={totalWords} />

    </>
  );
}

type HomeViewProps = {
  categories: Array<{ name: string; count: number }>;
  category: string;
  contentError: string;
  contentStatus: "loading" | "ready" | "error";
  filteredPosts: Post[];
  postsCount: number;
  query: string;
  onPostOpen: (post: Post) => void;
  setCategory: (category: string) => void;
  setQuery: (query: string) => void;
};

function HomeView({
  categories,
  category,
  contentError,
  contentStatus,
  filteredPosts,
  onPostOpen,
  postsCount,
  query,
  setCategory,
  setQuery
}: HomeViewProps) {
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-kicker">Recent Posts</p>
          <h2>最新记录</h2>
        </div>
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts"
          />
        </label>
      </div>

      <div className="chip-row" aria-label="Category filter">
        <button
          className={category === "All" ? "chip active" : "chip"}
          type="button"
          onClick={() => setCategory("All")}
        >
          All
          <span>{postsCount}</span>
        </button>
        {categories.map((item) => (
          <button
            className={category === item.name ? "chip active" : "chip"}
            type="button"
            key={item.name}
            onClick={() => setCategory(item.name)}
          >
            {item.name}
            <span>{item.count}</span>
          </button>
        ))}
      </div>

      <div className="post-list">
        {contentStatus === "loading" && (
          <ContentState message="文章索引加载中" detail="首页只加载轻量索引，文章正文会在点击后按需读取。" />
        )}

        {contentStatus === "error" && (
          <ContentState message="文章索引加载失败" detail={contentError} />
        )}

        {contentStatus === "ready" && !filteredPosts.length && (
          <ContentState message="没有匹配的文章" detail="可以换个关键词或分类再试。" />
        )}

        {contentStatus === "ready" && filteredPosts.map((post) => (
          <article className={`post-card accent-${post.accent}`} key={post.slug}>
            <div className="post-card-main">
              <div className="post-meta">
                <span>
                  <CalendarDays size={15} />
                  {formatDate(post.date)}
                </span>
                <span>
                  <Clock3 size={15} />
                  {post.minutes} min
                </span>
              </div>
              <button
                className="post-title-button"
                type="button"
                onClick={() => onPostOpen(post)}
              >
                {post.title}
              </button>
              <p>{post.excerpt}</p>
              <div className="tag-row">
                {post.tags.map((tag) => (
                  <span key={tag}>
                    <Tag size={13} />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="post-category">
              <FolderOpen size={16} />
              <span>{post.category}</span>
            </div>
            <button className="read-button" type="button" onClick={() => onPostOpen(post)}>
              <BookOpen size={16} />
              <span>Read</span>
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

function ArchiveView({ archiveGroups }: { archiveGroups: Record<string, Post[]> }) {
  return (
    <>
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Timeline</p>
          <h2>归档</h2>
        </div>
      </div>

      <div className="timeline">
        {Object.entries(archiveGroups)
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([year, yearPosts]) => (
            <section className="timeline-year" key={year}>
              <h3>{year}</h3>
              <div className="timeline-items">
                {yearPosts.map((post) => (
                  <article className="timeline-item" key={post.slug}>
                    <time>{formatDate(post.date)}</time>
                    <div>
                      <h4>{post.title}</h4>
                      <p>{post.category}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
      </div>
    </>
  );
}

function ContentState({ message, detail }: { message: string; detail: string }) {
  return (
    <div className="content-state">
      <strong>{message}</strong>
      <span>{detail}</span>
    </div>
  );
}

function ResourcesView() {
  return (
    <>
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Resources</p>
          <h2>功能索引</h2>
        </div>
      </div>

      <div className="resource-grid">
        {resourceItems.map((item) => (
          <a className="resource-card" href={item.href} key={item.href} target="_blank" rel="noreferrer">
            <span className="resource-icon">
              <ExternalLink size={20} />
            </span>
            <span className="resource-label">{item.label}</span>
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </a>
        ))}
      </div>
    </>
  );
}

function useFooterStats() {
  const [stats, setStats] = useState({ visitors: 1, views: 1 });
  const [uptime, setUptime] = useState(() => formatDuration(Math.max(0, Math.floor((Date.now() - SITE_STARTED_AT) / 1000))));

  useEffect(() => {
    const visitorKey = "gwanhyn-visitor-id";
    const viewsKey = "gwanhyn-page-views";
    if (!window.localStorage.getItem(visitorKey)) {
      window.localStorage.setItem(visitorKey, globalThis.crypto?.randomUUID?.() || String(Date.now()));
    }
    const views = Number(window.localStorage.getItem(viewsKey) || "0") + 1;
    window.localStorage.setItem(viewsKey, String(views));
    setStats({ visitors: 1, views });
  }, []);

  useEffect(() => {
    const update = () => setUptime(formatDuration(Math.max(0, Math.floor((Date.now() - SITE_STARTED_AT) / 1000))));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return { ...stats, uptime };
}

function SiteFooter({ postsCount, totalWords }: { postsCount: number; totalWords: number }) {
  const { visitors, views, uptime } = useFooterStats();

  return (
    <footer className="site-footer">
      <div className="footer-column footer-left">
        <span>POWERED BY <a href="https://vite.dev/" target="_blank" rel="noreferrer">VITE</a> / <a href="https://react.dev/" target="_blank" rel="noreferrer">REACT</a></span>
        <span>THEME <a href={profile.github} target="_blank" rel="noreferrer">GWANHYN BLOG</a></span>
      </div>
      <div className="footer-column footer-center">
        <span>© {new Date().getFullYear()} {profile.name.toUpperCase()}</span>
        <span>{postsCount} POSTS / {totalWords.toLocaleString("zh-CN")} WORDS</span>
        <span>UPTIME {uptime}</span>
      </div>
      <div className="footer-column footer-right">
        <span>VISITORS {visitors.toLocaleString("zh-CN")}</span>
        <span>PAGE VIEWS {views.toLocaleString("zh-CN")}</span>
      </div>
    </footer>
  );
}

function AboutView() {
  return (
    <>
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">About</p>
          <h2>关于这个站点</h2>
        </div>
      </div>

      <section className="about-panel">
        <p>
          这里会保留学习路径、工程记录和阶段性复盘。站点已经从生成后的静态页面迁移为
          React/Vite 应用，后续可以继续接入 Markdown、CMS 或自己的内容接口。
        </p>
        <div className="focus-list">
          {focusItems.map((item) => (
            <div className="focus-item" key={item}>
              <BookOpen size={18} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ArticleView({ post, onBack }: { post: Post; onBack: () => void }) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [article, setArticle] = useState<PostDetail | null>(null);
  const [articleStatus, setArticleStatus] = useState<"loading" | "ready" | "error">("loading");
  const [articleError, setArticleError] = useState("");
  const [activeHeadingId, setActiveHeadingId] = useState("");
  const tocHeadings = useMemo(
    () => (article?.headings || []).filter((heading) => heading.depth >= 1 && heading.depth <= 4),
    [article]
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setArticle(null);
    setArticleStatus("loading");
    setArticleError("");
    let cancelled = false;

    loadPost(post.slug)
      .then((detail) => {
        if (cancelled) return;
        setArticle(detail);
        setArticleStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setArticleError(error instanceof Error ? error.message : "文章内容加载失败。");
        setArticleStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [post.slug]);

  useEffect(() => {
    if (!article) {
      return undefined;
    }

    const updateActiveHeading = () => {
      const headings = Array.from(articleRef.current?.querySelectorAll<HTMLElement>("[id]") || [])
        .filter((element) => tocHeadings.some((heading) => heading.id === element.id));

      if (!headings.length) {
        setActiveHeadingId("");
        return;
      }

      const anchorLine = 112;
      const current = headings.reduce((closest, heading) => {
        const closestDistance = Math.abs(closest.getBoundingClientRect().top - anchorLine);
        const headingDistance = Math.abs(heading.getBoundingClientRect().top - anchorLine);
        return headingDistance < closestDistance ? heading : closest;
      }, headings[0]);
      setActiveHeadingId(current.id);
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);
    return () => {
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [article, tocHeadings]);

  const scrollToHeading = (heading: TocHeading) => {
    const target = Array.from(articleRef.current?.querySelectorAll<HTMLElement>("[id]") || [])
      .find((element) => element.id === heading.id);

    if (!target) {
      return;
    }

    const offset = target.getBoundingClientRect().top + window.scrollY - 104;
    window.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
    setActiveHeadingId(heading.id);
  };

  return (
    <section className="article-screen">
      <div className="article-page-heading">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={17} />
          <span>Back</span>
        </button>
      </div>
      <div className="article-layout">
        <div className="article-main-scroll">
          <article className="article-page" ref={articleRef}>
            <div className="post-meta">
              <span>
                <CalendarDays size={15} />
                {formatDate(post.date)}
              </span>
              <span>
                <FolderOpen size={15} />
                {post.category}
              </span>
            </div>
            <h2 id="article-title">{post.title}</h2>
            <div className="tag-row">
              {post.tags.map((tag) => (
                <span key={tag}>
                  <Tag size={13} />
                  {tag}
                </span>
              ))}
            </div>
            <div
              className="article-body"
              dangerouslySetInnerHTML={{
                __html: articleStatus === "ready" && article
                  ? article.body
                  : ""
              }}
            />
            {articleStatus === "loading" && (
              <ContentState message="文章内容加载中" detail="正在按需读取预渲染内容，不会阻塞首页。" />
            )}
            {articleStatus === "error" && (
              <ContentState message="文章内容加载失败" detail={articleError} />
            )}
          </article>
        </div>

        <aside className="article-toc" aria-label="文章目录">
          <div className="toc-heading">目录</div>
          <div className="toc-list">
            {tocHeadings.length ? (
              tocHeadings.map((heading) => (
                <button
                  className={`toc-item depth-${heading.depth}${activeHeadingId === heading.id ? " active" : ""}`}
                  key={heading.id}
                  type="button"
                  data-heading-id={heading.id}
                  aria-current={activeHeadingId === heading.id ? "true" : undefined}
                  onClick={() => scrollToHeading(heading)}
                >
                  {heading.text}
                </button>
              ))
            ) : (
              <p className="toc-empty">{articleStatus === "loading" ? "加载中" : "暂无标题"}</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default App;
