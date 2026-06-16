# Gwanhyn Blog Local Admin

`backend/admin-server.mjs` provides the local-only admin backend for Gwanhyn Blog. It binds to `127.0.0.1`, reads and writes the blog JSON data file, renders Markdown previews, and exposes guarded Git actions for publishing local changes.

## Start

Run from the project root:

```bash
npm run admin
```

Default address:

```text
http://127.0.0.1:8787/admin
```

Temporary port override in PowerShell:

```powershell
$env:ADMIN_PORT=8788; npm run admin
```

## Layout

The admin page uses a fixed three-column workspace:

- Left: task rail and article list.
- Middle: article metadata, TXT/MD import, Markdown input, and Markdown preview.
- Right: Git history, rewrite controls, refresh, and push.

Each column owns its own scroll area, so the full page does not move while editing long content or browsing long Git history.

## Article Editing

Articles are stored in:

```text
src/data/posts.json
```

Frontend render flow:

```text
src/data/posts.json -> src/content.ts -> src/App.tsx
```

The editor writes both fields:

- `markdown`: source text for future editing.
- `body`: sanitized HTML generated from Markdown for frontend rendering.

TXT, MD, and Markdown files can be imported from the middle panel. Imported text is treated as Markdown regardless of file extension. The editor can infer a title from the first `# Heading`, create a slug, create an excerpt, and estimate reading minutes.

## Article Schema

```json
{
  "slug": "example-post",
  "title": "Example Post",
  "date": "2026-06-16",
  "category": "Engineering",
  "tags": ["React", "Blog"],
  "excerpt": "Short summary.",
  "body": "<p>Rendered HTML.</p>",
  "markdown": "Markdown source.",
  "minutes": 3,
  "accent": "teal"
}
```

Valid `accent` values:

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
POST   /api/publish
GET    /api/git/status
GET    /api/git/history
POST   /api/git/amend
POST   /api/git/squash
POST   /api/git/push
```

`POST /api/posts` request body:

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

`POST /api/markdown/preview` request body:

```json
{
  "markdown": "# Heading\n\nBody text."
}
```

The response includes rendered, sanitized HTML and plain text:

```json
{
  "html": "<h1>Heading</h1>\n<p>Body text.</p>\n",
  "text": "Heading Body text."
}
```

## Git Workflow

`Save` writes `src/data/posts.json` only.

`Save and Publish` runs:

```bash
git add -A
git commit -m "<message>"
git push origin master
```

If there are no local changes, commit is skipped and push still runs.

The Git History panel has its own refresh button. It calls only `GET /api/git/history`, so refreshing history does not reload the editor or article list.

## History Rewriting

`Amend` runs:

```bash
git add -A
git commit --amend
```

If the message field is empty, it uses:

```bash
git commit --amend --no-edit
```

`Squash` requires a clean working tree, then runs:

```bash
git reset --soft HEAD~N
git commit -m "<new message>"
```

After amend or squash, the backend marks history as rewritten. The next push uses:

```bash
git push --force-with-lease origin master
```

## Notes

- This backend is a local tool and is not included in the Vite/GitHub Pages build.
- The server binds only to `127.0.0.1`.
- Markdown output is sanitized by removing scripts, iframes, inline event handlers, and `javascript:` links before saving.
- Duplicate slugs return `409`.
- Squash and amend rewrite Git history. Use them only when you intend to rewrite the local branch before pushing.
