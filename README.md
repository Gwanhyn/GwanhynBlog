# Gwanhyn Blog

一个基于 React、TypeScript 和 Vite 的个人博客应用。当前分支把借鉴仓库中的静态生成产物收敛为可开发、可构建、可预览的源码项目。

## Scripts

```bash
npm run dev
npm run build
npm run build:pages
npm run deploy
npm run run
```

- `dev`: 启动本地开发服务器。
- `build`: 类型检查并生成生产构建到 `dist/`。
- `build:pages`: 使用 `/GwanhyBlog/` 作为 base 构建 GitHub Pages 产物。
- `deploy`: 构建并发布 `dist/` 到 `gh-pages` 分支。
- `run`: 预览已经构建好的 `dist/`。

## Content

站点内容目前集中在 `src/content.ts`，可以直接替换文章标题、摘要、分类和标签。页面样式集中在 `src/styles.css`。
