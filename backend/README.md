# Gwanhyn Blog 本地后台

`backend/admin-server.mjs` 是 Gwanhyn Blog 的本地管理后台，只监听 `127.0.0.1`，用来编辑文章、导入 Markdown、预览内容，并在需要时处理 Git 提交和推送。

## 启动

在项目根目录运行：

```bash
npm run admin
```

默认地址：

```text
http://127.0.0.1:8787/admin
```

如果想临时换端口：

```powershell
$env:ADMIN_PORT=8788; npm run admin
```

## 页面布局

后台分成三栏：

- 左侧：任务栏和文章列表。
- 中间：文章信息、文件导入、Markdown 输入和预览。
- 右侧：Git 历史、修正、合并和推送。

每一栏都是独立滚动区，长文章和长历史不会带着整页一起滚。

## 文章字段说明

文章数据保存在：

```text
src/data/posts.json
```

前台读取链路：

```text
src/data/posts.json -> src/content.ts -> src/App.tsx
```

后台保存时会同时写入：

- `markdown`：文章的原始 Markdown，方便后续继续修改。
- `body`：由 Markdown 转出来并清理过的 HTML，用于前台直接显示。

### 字段含义

- `标题`：文章名称，不能为空。
- `地址别名`：文章在网址里的唯一标识，也叫 slug。它会出现在文章链接里，例如 `#post/buildable-blog` 中的 `buildable-blog`。建议只用英文小写、数字和 `-`，例如 `buildable-blog`、`bayes-review`。这个值必须唯一，不能和其他文章重复；后台编辑、删除文章时也会用它定位原文章。后面修改地址别名等于修改文章链接，旧链接将不再指向这篇文章。
- `发布日期`：`YYYY-MM-DD` 格式。
- `分类`：文章所属分类。
- `标签`：逗号分隔的标签。
- `摘要`：首页列表里的短简介，留空时会从正文截取。
- `强调色`：文章卡片颜色。
- `阅读分钟`：显示在前台文章卡片上的估算阅读时间。

### 导入文件

中间栏支持导入：

- `.txt`
- `.md`
- `.markdown`

导入后会按 Markdown 解析，直接写入正文。文本里的第一条 `# 标题` 会被优先当成文章标题。

### Markdown 与数学公式

正文统一按 Markdown 解析，支持常见标题、列表、引用、代码块、表格等基础语法。

数学公式用 KaTeX 渲染：

- 行内公式：`$E=mc^2$`
- 块级公式：

```markdown
$$
\int_a^b f(x)\,dx
$$
```

行内代码和代码块里的 `$` 会当作普通文本，不会被公式解析。后台预览、保存后生成的 `body`、以及前台文章阅读页都会使用同一套公式渲染效果。

### 前台文章目录

前台打开文章详情页时，会优先读取 `markdown` 字段重新渲染正文，并根据 Markdown 标题自动生成右侧目录。目录来自 `#` 到 `####` 级标题，点击目录项会在文章正文区域内跳转；正文和目录各自独立滚动，不会带动主页面滚动。

## 文章结构

```json
{
  "slug": "example-post",
  "title": "Example Post",
  "date": "2026-06-16",
  "category": "Engineering",
  "tags": ["React", "Blog"],
  "excerpt": "Short summary.",
  "body": "<p>Rendered HTML.</p>",
  "markdown": "# Example Post",
  "minutes": 3,
  "accent": "teal"
}
```

`accent` 目前支持：

```text
teal, orange, gold, ink
```

## API

```text
GET    /api/diagnostics
GET    /api/posts
POST   /api/posts
DELETE /api/posts/:slug
POST   /api/markdown/preview
GET    /api/git/status
GET    /api/git/history
POST   /api/git/commit
POST   /api/git/amend
POST   /api/git/squash
POST   /api/git/push
```

`POST /api/posts` 请求体：

```json
{
  "originalSlug": "old-slug",
  "post": {
    "slug": "new-slug",
    "title": "Updated title",
    "date": "2026-06-16",
    "category": "Engineering",
    "tags": ["React"],
    "excerpt": "Summary",
    "markdown": "# Body",
    "minutes": 3,
    "accent": "teal"
  }
}
```

`POST /api/markdown/preview` 请求体：

```json
{
  "markdown": "# Heading\n\nBody text."
}
```

返回值里会带：

```json
{
  "html": "<h1>Heading</h1>\n<p>Body text.</p>\n",
  "text": "Heading Body text."
}
```

## Git 操作

`Save` 只写文章数据文件，不提交 Git。

`Save & Commit` 只做：

```bash
git add -A
git commit -m "<message>"
```

它不会自动 push。

`Push` 是单独的操作按钮，才会执行：

```bash
git push origin master
```

右侧历史栏里的刷新按钮只刷新 Git 历史，不会重新加载文章表单。

## 历史改写

`Amend` 会执行：

```bash
git add -A
git commit --amend
```

如果提交信息为空，则使用：

```bash
git commit --amend --no-edit
```

`Squash` 要求工作区干净，然后执行：

```bash
git reset --soft HEAD~N
git commit -m "<new message>"
```

如果本地历史已经改写，或者本地和远端已经分叉，下一次 push 会自动使用：

```bash
git push --force-with-lease origin master
```

## 注意

- 这是本地工具，不会进 Vite/GitHub Pages 构建。
- 后台只监听 `127.0.0.1`。
- Markdown 输出会先清理脚本、`iframe`、内联事件和 `javascript:` 链接，再写入文章数据。
- 地址别名重复会返回 `409`。
- `Amend` 和 `Squash` 会改写历史，推送前请确认这是你想要的结果。
