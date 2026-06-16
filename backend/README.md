# Gwanhyn Blog Local Admin

`backend/admin-server.mjs` 是 Gwanhyn Blog 的本地可视化管理后台。它只监听 `127.0.0.1`，用于在本机编辑文章、写回数据文件，并在确认后执行 Git 发布。

## 启动

在项目根目录运行：

```bash
npm run admin
```

默认访问地址：

```text
http://127.0.0.1:8787/admin
```

如需临时更换端口：

```bash
ADMIN_PORT=8788 npm run admin
```

Windows PowerShell 可以使用：

```powershell
$env:ADMIN_PORT=8788; npm run admin
```

## 数据流

当前博客文章采用 JSON 数据源：

```text
src/data/posts.json
```

前台入口：

```text
src/content.ts
```

渲染链路：

```text
src/data/posts.json -> src/content.ts -> src/App.tsx
```

后台保存时只写入 `src/data/posts.json`。前台构建时会通过 `src/content.ts` 读取同一份数据，因此保存后的文章会自然进入主页列表、分类和归档视图。

## 后台功能

- `Data Flow` 面板展示当前数据源和渲染链路。
- 左侧文章列表自动读取 `src/data/posts.json`。
- `New` 可以创建新文章。
- 表单支持编辑标题、slug、日期、分类、标签、摘要、阅读分钟数和 accent。
- 正文编辑器使用浏览器内置 `contenteditable` 富文本能力，支持加粗、斜体、标题、列表和引用。
- `Save` 会校验并写回 JSON。
- `Delete` 会从 JSON 中删除当前文章。
- `Publish` 会执行 Git 发布流程。
- `Git History` 面板会展示最近提交、工作区状态和历史重写状态。
- `Save Draft` 只保存文章数据，不创建 Git 提交。
- `Amend` 会把当前工作区改动覆盖到上一条提交。
- `Squash` 会把最近 N 条提交合并为一条新提交。
- `Push` 会在历史被重写后自动使用 `--force-with-lease`。

## 文章数据格式

每篇文章需要符合以下结构：

```json
{
  "slug": "example-post",
  "title": "Example Post",
  "date": "2026-06-16",
  "category": "Engineering",
  "tags": ["React", "Blog"],
  "excerpt": "Short summary.",
  "body": "<p>Article body.</p>",
  "minutes": 3,
  "accent": "teal"
}
```

字段说明：

- `slug`: 文章唯一标识，用于编辑、删除和排序定位。
- `title`: 文章标题，不能为空。
- `date`: `YYYY-MM-DD` 格式日期。
- `category`: 分类名称。
- `tags`: 标签数组。
- `excerpt`: 首页摘要；为空时后端会从正文中截取。
- `body`: 富文本 HTML 正文。
- `minutes`: 阅读分钟数，最小为 `1`。
- `accent`: 文章卡片强调色，可选 `teal`、`orange`、`gold`、`ink`。

## API

后台页面使用以下本地 API：

```text
GET    /api/diagnostics
GET    /api/posts
POST   /api/posts
DELETE /api/posts/:slug
POST   /api/publish
GET    /api/git/status
GET    /api/git/history
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
    "body": "<p>Body</p>",
    "minutes": 3,
    "accent": "teal"
  }
}
```

`POST /api/publish` 请求体：

```json
{
  "message": "Update blog content"
}
```

`GET /api/git/history` 返回最近提交：

```json
{
  "commits": [
    {
      "hash": "full-hash",
      "shortHash": "abc1234",
      "subject": "Update blog content",
      "relativeTime": "2 minutes ago",
      "author": "Gwanhyn"
    }
  ],
  "status": {
    "branch": "master",
    "dirty": false,
    "entries": [],
    "historyRewritten": false
  }
}
```

`POST /api/git/amend` 请求体：

```json
{
  "message": "Update latest blog content"
}
```

`message` 为空时会执行 `git commit --amend --no-edit`。后台会先执行 `git add -A`，因此当前工作区改动会进入被覆盖的上一条提交。

`POST /api/git/squash` 请求体：

```json
{
  "count": 3,
  "message": "Clean blog content updates"
}
```

也可以传入 `targetHash`，后端会计算从该提交到 `HEAD` 的提交数量。Squash 会要求工作区干净，避免把未保存草稿混入历史重写。

`POST /api/git/push` 请求体：

```json
{
  "force": true
}
```

如果后台检测到已经执行过 amend 或 squash，即使 `force` 未传入，也会自动使用：

```bash
git push --force-with-lease origin master
```

## 发布流程

点击后台 `Publish` 后会在项目根目录执行：

```bash
git add -A
git commit -m "<message>"
git push origin master
```

如果没有本地变更，commit 会被跳过，但 push 仍会执行。如果最近执行过 amend 或 squash，后台会自动改用 `git push --force-with-lease origin master`。部署到 GitHub Pages 仍由项目根目录的命令负责：

```bash
npm run deploy
```

## 注意事项

- 后台是本地工具，不会被 Vite 构建进 GitHub Pages。
- 后台只绑定 `127.0.0.1`，不面向公网。
- 正文 HTML 会移除 `<script>` 和内联事件属性，降低误写脚本的风险。
- 保存前请确认 `slug` 唯一；重复 slug 会返回 `409`。
- Squash 会使用 `git reset --soft HEAD~N`，只建议在本地尚未和他人协作的分支上使用。
- Rewrite 后 Push 会使用 `--force-with-lease`，比普通 force push 更安全，但仍然会改写远端历史。
- 发布前建议先运行 `npm run build:pages`，确认静态站点可以正常构建。
