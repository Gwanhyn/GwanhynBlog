import {
  Archive,
  BookOpen,
  CalendarDays,
  Clock3,
  FolderOpen,
  GitBranch,
  Home,
  Mail,
  Moon,
  Search,
  Sun,
  Tag,
  X,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { focusItems, posts, profile, type Post } from "./content";

type Theme = "light" | "dark";
type View = "home" | "archives" | "categories" | "about";

const navItems: Array<{ view: View; label: string; icon: typeof Home }> = [
  { view: "home", label: "Home", icon: Home },
  { view: "archives", label: "Archives", icon: Archive },
  { view: "categories", label: "Categories", icon: FolderOpen },
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

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("gwanhyn-theme", theme);
  }, [theme]);

  const categories = useMemo(() => {
    const counts = posts.reduce<Record<string, number>>((acc, post) => {
      acc[post.category] = (acc[post.category] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, []);

  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return posts.filter((post) => {
      const matchesCategory = category === "All" || post.category === category;
      const text = [post.title, post.excerpt, post.category, ...post.tags]
        .join(" ")
        .toLowerCase();

      return matchesCategory && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [category, query]);

  const archiveGroups = useMemo(() => {
    return posts.reduce<Record<string, Post[]>>((acc, post) => {
      const year = post.date.slice(0, 4);
      acc[year] = [...(acc[year] ?? []), post];
      return acc;
    }, {});
  }, []);

  const changeView = (nextView: View) => {
    setView(nextView);
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

      <main>
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

        <div className="page-shell">
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
                filteredPosts={filteredPosts}
                query={query}
                setCategory={setCategory}
                setQuery={setQuery}
                onPostOpen={setSelectedPost}
              />
            )}

            {view === "archives" && <ArchiveView archiveGroups={archiveGroups} />}

            {view === "categories" && (
              <CategoriesView
                categories={categories}
                onCategorySelect={(name) => {
                  setCategory(name);
                  changeView("home");
                }}
              />
            )}

            {view === "about" && <AboutView />}
          </section>
        </div>
      </main>

      <footer className="footer">
        <span>© {new Date().getFullYear()} {profile.name}</span>
        <span>Built with React and Vite</span>
      </footer>

      {selectedPost && (
        <ArticleDialog post={selectedPost} onClose={() => setSelectedPost(null)} />
      )}
    </>
  );
}

type HomeViewProps = {
  categories: Array<{ name: string; count: number }>;
  category: string;
  filteredPosts: Post[];
  query: string;
  onPostOpen: (post: Post) => void;
  setCategory: (category: string) => void;
  setQuery: (query: string) => void;
};

function HomeView({
  categories,
  category,
  filteredPosts,
  onPostOpen,
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
          <span>{posts.length}</span>
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
        {filteredPosts.map((post) => (
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

function CategoriesView({
  categories,
  onCategorySelect
}: {
  categories: Array<{ name: string; count: number }>;
  onCategorySelect: (name: string) => void;
}) {
  return (
    <>
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Index</p>
          <h2>分类</h2>
        </div>
      </div>

      <div className="category-grid">
        {categories.map((category) => {
          const categoryPosts = posts.filter((post) => post.category === category.name);
          return (
            <button
              className="category-card"
              type="button"
              key={category.name}
              onClick={() => onCategorySelect(category.name)}
            >
              <span className="category-icon">
                <FolderOpen size={20} />
              </span>
              <strong>{category.name}</strong>
              <span>{category.count} posts</span>
              <small>{categoryPosts.map((post) => post.title).join(" / ")}</small>
            </button>
          );
        })}
      </div>
    </>
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

function ArticleDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <article
        className="article-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="article-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" type="button" aria-label="Close article" onClick={onClose}>
          <X size={18} />
        </button>
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
          dangerouslySetInnerHTML={{ __html: post.body || `<p>${post.excerpt}</p>` }}
        />
      </article>
    </div>
  );
}

export default App;
