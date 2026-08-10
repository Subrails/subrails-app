# Subrails documentation site

The deep reference for the Subrails protocol: how it works, every contract
function and error code, SDK and indexer guides, and plain-language guides for
subscribers and merchants. Separate from the repository README, which stays
focused on the quick start.

## Stack

A standalone static site with zero dependencies. Content is plain Markdown in
`content/`; `scripts/build.mjs` (a small Node script, no packages) renders it
to a fully static site in `out/`. There is no install step and no lockfile:
the build runs on any Node 22+.

## Build and preview

```sh
cd docs
node scripts/build.mjs    # renders content/ to out/
node scripts/check.mjs    # verifies the built site (links, nav, content rules)
node scripts/serve.mjs    # optional preview server on http://localhost:4173
```

The build fails if any internal link does not resolve, and `check.mjs`
verifies the rendered pages (one h1 per page, complete sidebar, no leftover
markdown artifacts, no em or en dashes, no banned words in content).

`SITE_URL=https://docs.example node scripts/build.mjs` additionally writes a
`sitemap.xml` with that canonical base URL.

## Layout

- `content/`: one Markdown file per page, with a small frontmatter block
  (`title`, `description`, `section`, `eyebrow`).
- `scripts/build.mjs`: the renderer and layout generator. It supports the
  deliberate Markdown subset the content uses: headings, paragraphs, inline
  code, bold, links, lists, pipe tables, fenced code blocks (with an optional
  `title=` attribute), `> [!note]` / `> [!warn]` / `> [!security]` callouts,
  and horizontal rules. It also checks that every internal link resolves.
- `static/`: `docs.css` (the design system) and `app.js` (theme toggle and
  code-block copy buttons).
- `out/`: build output, gitignored.

## Deploy

The site is a separate deployable from `apps/web`. Point any static host at
the `out/` directory (for example a Vercel project with the root directory
set to `docs`, the build command `node scripts/build.mjs`, and the output
directory `out`), mirroring how `apps/web` is deployed.
