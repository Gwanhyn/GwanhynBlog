# Gwanhyn Blog

一个基于 React、TypeScript 和 Vite 的个人博客应用。当前分支把借鉴仓库中的静态生成产物收敛为可开发、可构建、可预览的源码项目。

## Scripts

```bash
npm run dev
npm run build
npm run build:pages
npm run deploy
npm run admin
npm run run
```

- `dev`: 启动本地开发服务器。
- `build`: 类型检查并生成生产构建到 `dist/`。
- `build:pages`: 使用 `/GwanhynBlog/` 作为 base 构建 GitHub Pages 产物。
- `deploy`: 构建并发布 `dist/` 到 `gh-pages` 分支。
- `admin`: 启动只绑定本机的可视化博客后台。
- `run`: 预览已经构建好的 `dist/`。

## Content

站点内容目前集中在 `src/data/posts.json`，`src/content.ts` 负责导出类型、作者信息和文章数据。页面样式集中在 `src/styles.css`。

## Local Admin

```bash
npm run admin
```

打开 `http://127.0.0.1:8787/admin`，可以在本地后台编辑文章元数据和正文。保存会写回 `src/data/posts.json`；发布会执行 `git add -A`、`git commit` 和 `git push origin master`。

后台实现与操作细节见 `backend/README.md`。
