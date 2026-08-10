#!/usr/bin/env node
/**
 * Post-build verification for the docs site. Runs against out/ and content/:
 *
 *   node scripts/build.mjs
 *   node scripts/check.mjs
 *
 * Asserts, for every generated page: a single <h1>, a rendered sidebar with
 * all nav links, no leftover Markdown artifacts, no em or en dashes, valid
 * relative asset references, and that every internal link resolves. Also
 * scans content/ for the words this project deliberately avoids.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT = join(ROOT, "out");
const CONTENT = join(ROOT, "content");

const BANNED_WORDS = ["seamless", "robust", "powerful", "unlock", "revolutioniz"];
const NAV_HREFS = [
  "/",
  "/protocol",
  "/contracts",
  "/contracts/mandate-policy",
  "/contracts/subrails-account",
  "/contracts/mandate-registry",
  "/guides/subscriber",
  "/guides/merchant",
  "/developers",
  "/developers/sdk",
  "/developers/indexer",
  "/contributing",
];

const errors = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Resolves a relative href from a page file to an absolute path. */
function resolveHref(pageFile, href) {
  const base = href.split(/[?#]/)[0];
  if (base === "") {
    return null;
  }
  const target = resolve(dirname(pageFile), base);
  if (existsSync(target) && statSync(target).isDirectory()) {
    // A directory href (trailing slash): the page lives at index.html inside.
    return join(target, "index.html");
  }
  return target;
}

const pages = walk(OUT).filter((f) => f.endsWith(".html"));

for (const page of pages) {
  const rel = relative(OUT, page);
  const html = readFileSync(page, "utf8");

  // Exactly one <h1> (plus the one inside the 404 page, which is its own file).
  const h1s = (html.match(/<h1>/g) ?? []).length;
  if (h1s !== 1) {
    errors.push(`${rel}: expected exactly one <h1>, found ${h1s}`);
  }

  // Sidebar must contain every nav link. Extract the sidebar hrefs and
  // resolve them relative to the page, then compare against the expected set.
  const sidebarHtml = html.match(/<nav class="sidebar-nav">([\s\S]*?)<\/nav>/);
  if (sidebarHtml === null) {
    errors.push(`${rel}: sidebar-nav missing`);
  } else {
    const resolved = [...sidebarHtml[1].matchAll(/href="([^"]+)"/g)]
      .map((m) => resolveHref(page, m[1]))
      .filter((t) => t !== null);
    for (const href of NAV_HREFS) {
      const expected = join(OUT, href.replace(/^\//, ""), "index.html");
      if (!resolved.includes(expected)) {
        errors.push(`${rel}: sidebar is missing nav link ${href}`);
      }
    }
  }

  // No leftover Markdown artifacts.
  for (const artifact of ["**", "](http", "[!note]", "[!warn]", "[!security]", "\\|"]) {
    if (html.includes(artifact)) {
      errors.push(`${rel}: leftover markdown artifact ${JSON.stringify(artifact)}`);
    }
  }

  // No em or en dashes anywhere in the rendered text.
  if (/[\u2014\u2013]/.test(html)) {
    errors.push(`${rel}: contains an em or en dash`);
  }

  // Every relative href/src (assets, page links, the brand link) must
  // resolve. Absolute URLs, anchors, and mailto: links are skipped.
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = m[1];
    if (href === "" || href.startsWith("/") || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) {
      // Leading-"/" hrefs are root-relative site paths; valid on the
      // deployed root (the build rewrites content links to relative form).
      continue;
    }
    const target = resolveHref(page, href);
    if (target !== null && !existsSync(target) && !existsSync(join(target, "index.html"))) {
      errors.push(`${rel}: broken reference ${href}`);
    }
  }
}

// Content word scan.
for (const file of walk(CONTENT).filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(file, "utf8").toLowerCase();
  for (const word of BANNED_WORDS) {
    if (text.includes(word)) {
      errors.push(`${relative(ROOT, file)}: contains banned word "${word}"`);
    }
  }
  if (/[\u2014\u2013]/.test(readFileSync(file, "utf8"))) {
    errors.push(`${relative(ROOT, file)}: contains an em or en dash`);
  }
}

if (errors.length > 0) {
  console.error(`check failed with ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}
console.log(`check passed: ${pages.length} pages, all nav links, links, assets, and content scan clean`);
