#!/usr/bin/env bash
#
# Creates the starter issues for the subrails-app repository in one run.
#
# Usage:
#   scripts/create-issues.sh                # create the issues
#   DRY_RUN=1 scripts/create-issues.sh      # print what would be created
#   REPO=owner/repo scripts/create-issues.sh
#
# Requires the GitHub CLI (gh) and an authenticated session.

set -euo pipefail

REPO="${REPO:-Subrails/subrails-app}"
DRY_RUN="${DRY_RUN:-0}"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: the GitHub CLI (gh) is required" >&2
  exit 1
fi
if [ "$DRY_RUN" != "1" ] && ! gh auth status >/dev/null 2>&1; then
  echo "error: run 'gh auth login' first" >&2
  exit 1
fi

# --- labels ---------------------------------------------------------------

ensure_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  gh label create "$name" \
    --repo "$REPO" \
    --color "$color" \
    --description "$description" \
    --force >/dev/null 2>&1 || true
}

ensure_label "type: bug"         "d73a4a" "Something is broken."
ensure_label "type: chore"       "0e8a16" "Maintenance or tooling."
ensure_label "type: docs"        "0075ca" "Documentation."
ensure_label "type: enhancement" "a2eeef" "New feature or improvement."
ensure_label "type: testing"     "fbca04" "Test coverage."
ensure_label "complexity: easy"   "c5def5" "Good first issue, small scope."
ensure_label "complexity: medium" "fef2c0" "Focused change with some depth."

# --- issue creation -------------------------------------------------------

create_issue() {
  local title="$1"
  local labels="$2"
  local body="$3"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $title  (labels: $labels)"
    return 0
  fi
  gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --label "$labels" \
    --body "$body"
}

# --- issues ---------------------------------------------------------------

BODY=$(cat <<'EOF'
## Summary

The landing page (`/`) defines its own editorial typography tokens in
`apps/web/src/app/landing.css` (Fraunces, Archivo, JetBrains Mono) with a
matching type scale and spacing rhythm. The demo page (`/demo`) styles live in
`apps/web/src/app/globals.css` and use different type choices. The two pages
should feel like one product.

## Acceptance Criteria

- [ ] The demo page uses the same font stack as the landing page.
- [ ] Headings, body text, and mono elements share one type scale.
- [ ] The light/dark theme toggle on the landing page also applies to the demo.
- [ ] `pnpm typecheck` and `pnpm build` pass in `apps/web`.

## Tech Stack

Next.js 16, React 19, plain CSS (`landing.css`, `globals.css`).
EOF
)
create_issue \
  "style(web): make the demo page inherit the landing page typography tokens" \
  "type: enhancement,complexity: easy" \
  "$BODY"

BODY=$(cat <<'EOF'
## Summary

`apps/web/src/lib/sdk-clients.ts` builds the SDK contract clients the UI talks
to, but the web app has no test runner and no tests for these wrappers. Add
unit tests that construct each client (`policyClient`, `accountClient`,
`registryClient`, `tokenClient`) with a fixture config and assert the client
type and the resolved contract ids.

## Acceptance Criteria

- [ ] A test runner is wired into `apps/web` (for example `node --test` or
      vitest) and runs in CI via the existing `test` job.
- [ ] Each wrapper in `sdk-clients.ts` has at least one passing test.
- [ ] Tests cover the empty-config case (`""` contract ids).
- [ ] `pnpm test` and `pnpm typecheck` pass at the workspace root.

## Tech Stack

TypeScript, Next.js 16, `@subrails/sdk`.
EOF
)
create_issue \
  "test(web): add unit tests for the SDK client wrappers" \
  "type: testing,complexity: medium" \
  "$BODY"

BODY=$(cat <<'EOF'
## Summary

The hosted indexer (Render free tier) spins down after 15 minutes of
inactivity; the first request after idle takes 30 to 50 seconds. The header
status pill in `apps/web/src/components/Header.tsx` shows a generic
"indexer …" label while the health check is pending, which reads as a broken
connection. Surface the cold-start state instead.

## Acceptance Criteria

- [ ] The status pill distinguishes "warming up" (health check in flight or
      first poll slow) from "indexer down" (health check failed).
- [ ] The pill text or tooltip explains the cold start when detected.
- [ ] Existing states ("indexer online", "indexer down") keep their current
      colors and labels.
- [ ] `pnpm typecheck` passes in `apps/web`.

## Tech Stack

TypeScript, React 19, CSS.
EOF
)
create_issue \
  "feat(web): surface indexer cold-start state in the header status pill" \
  "type: enhancement,complexity: medium" \
  "$BODY"

BODY=$(cat <<'EOF'
## Summary

The `docs/` directory is an empty placeholder and the landing page links
("Docs" in the nav, footer links) point at `href="#"`. Once the Phase 11 docs
site exists, publish it and wire the links to real URLs so users can reach the
docs and the contract repo.

## Acceptance Criteria

- [ ] A docs site exists and is published (or a deploy target is chosen).
- [ ] The landing page "Docs" link points at the docs site.
- [ ] Footer links (Contracts, SDK, Docs, GitHub) point at real destinations.
- [ ] The README links to the docs site instead of the placeholder.

## Tech Stack

Next.js 16, markdown docs (or the chosen docs tool).
EOF
)
create_issue \
  "docs(web): publish the docs site and point landing page links at it" \
  "type: docs,complexity: medium" \
  "$BODY"

BODY=$(cat <<'EOF'
## Summary

The landing footer in `apps/web/src/app/page.tsx` renders four links
(Contracts, SDK, Docs, GitHub) that all point at `href="#"`. Replace them with
real targets once they exist: the contract repo, the SDK package, the docs
site, and the GitHub org.

## Acceptance Criteria

- [ ] Every footer link points at a real URL.
- [ ] Links open in a new tab where they point off-site.
- [ ] No `href="#"` placeholders remain on the landing page.

## Tech Stack

Next.js 16, React 19.
EOF
)
create_issue \
  "chore(web): replace placeholder '#' links in the landing footer" \
  "type: chore,complexity: easy" \
  "$BODY"

BODY=$(cat <<'EOF'
## Summary

`indexer/src/config.ts` documents `mandateRegistryId` as "not yet consumed by
the ingest filter". The mandate-registry contract emits events when mandates
are registered; the indexer currently derives mandate state only from the
mandate-policy events. Consume the registry events so mandate listing stays
correct if the registry is the source of truth for membership.

## Acceptance Criteria

- [ ] The ingest filter subscribes to mandate-registry events.
- [ ] Registry events update the mandate rows without double-counting.
- [ ] Existing policy-driven ingestion keeps passing the current tests.
- [ ] New tests cover a registry event followed by a policy event.

## Tech Stack

TypeScript, `@stellar/stellar-sdk`, Hono, Postgres (`pg`), `node --test`.
EOF
)
create_issue \
  "feat(indexer): consume mandate-registry events in the ingest filter" \
  "type: enhancement,complexity: medium" \
  "$BODY"

BODY=$(cat <<'EOF'
## Summary

The README quick start for the web app requires manually copying five
`NEXT_PUBLIC_` values into `apps/web/.env.local`. Add a small script (for
example `scripts/scaffold-web-env.sh`) that writes `apps/web/.env.local` from
the deployed testnet values, so a new contributor can go from clone to running
web app without hand-assembling the file.

## Acceptance Criteria

- [ ] The script writes `apps/web/.env.local` with the testnet defaults when
      the file does not exist.
- [ ] It does not overwrite an existing file without a flag or prompt.
- [ ] The README quick start mentions the script.
- [ ] `pnpm --filter @subrails/web build` succeeds after scaffolding.

## Tech Stack

Bash, Next.js 16.
EOF
)
create_issue \
  "chore(workspace): scaffold apps/web/.env.local from the testnet values" \
  "type: chore,complexity: easy" \
  "$BODY"

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "Dry run complete: no issues were created."
else
  echo
  echo "Done. Review the created issues at https://github.com/$REPO/issues"
fi
