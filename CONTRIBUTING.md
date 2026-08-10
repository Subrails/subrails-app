# Contributing to Subrails

Thanks for helping out. This guide covers the first hour: setting up a dev
environment, the git workflow, and how to propose a change. Keep it short and
practical.

## Dev environment

Requirements: Node.js 22+, pnpm 11, and a Postgres database for the indexer.

Follow the Quick start section of the [README](README.md) to install
dependencies and build the SDK. That section also covers the indexer and the
web app, including the environment variables each one needs.

```sh
pnpm install
pnpm --filter @subrails/sdk build
```

## Git workflow

- Never run `git add .` or `git add -A`. Stage explicit file paths only
  (`git add packages/sdk/src/clients/token.ts`), so an accidental stray file
  never lands in a commit.
- One logical commit per unit of work. A fix, a feature, and a docs change
  belong in separate commits, even if they touch the same PR.
- Use the conventional commit format: `type(scope): description`, for example
  `fix(sdk): clamp the interval in createMandate`, `feat(indexer): ingest
  mandate-registry events`, `docs(web): correct the quick start`.
- Push promptly and open small pull requests. A PR that is easy to review gets
  reviewed faster.

## Before opening a pull request

Run the same gates the CI runs, from the workspace root:

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

All four should pass locally. The CI runs these same jobs (`lint`, `typecheck`,
`test`, `build`) on Node 22 and Node 24.

## How to propose a change

- For anything non-trivial, open an issue first and describe the problem or the
  change you have in mind. It avoids wasted work when the maintainers have a
  different direction in mind.
- For a small, obvious fix (a typo, a broken link, a one-line correction) a
  pull request directly is fine.
- Reference the issue in the pull request body (for example `Closes #42`).
- If your change adds or alters behavior, add or update tests in the same
  commit.

## Scope

The packages and conventions differ slightly:

- `packages/sdk` and `indexer` run their tests with `node --test`; new test
  files go in `test/` next to the code.
- `apps/web` has no test runner yet; keep changes there focused and verify with
  `pnpm typecheck` and a local build.
