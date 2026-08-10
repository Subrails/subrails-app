---
title: Contributing
description: Where to find the contribution guides for the Subrails repositories.
section: project
eyebrow: Project
---

# Contributing

Both repositories keep their contribution guides next to the code. This page points at them and summarizes the ground rules.

## The guides

- This repository (`subrails-app`: SDK, indexer, web app, docs): [CONTRIBUTING.md](https://github.com/Subrails/subrails-app/blob/main/CONTRIBUTING.md)
- The contracts repository (`subrails-contract`: mandate-policy, subrails-account, mandate-registry): its own `CONTRIBUTING.md` at the repository root.

## Ground rules

- **Never `git add .`.** Stage explicit file paths only, so a stray file never lands in a commit.
- **One logical commit per unit of work**, in conventional format: `type(scope): description`.
- **Run the same gates CI runs** before opening a pull request:

``` title=from the workspace root
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

- **Open small pull requests** and reference the issue they close.
- **If a change alters behavior, add or update tests in the same commit.** The SDK and the indexer run `node --test`; the web app has no test runner yet, so keep changes there focused and verify with typecheck and a local build.

> [!note] Docs edits
>
> This site is a standalone static site in the same repository (`docs/`). Content is plain Markdown under `docs/content/`, rendered by the zero-dependency build script; run `node scripts/build.mjs` from `docs/` to rebuild. When you change a contract function, error code, or event, update the matching reference page in the same commit, since the docs deliberately mirror the current source.
