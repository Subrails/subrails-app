#!/usr/bin/env node
/**
 * Subrails docs static site generator.
 *
 * Zero dependencies: plain Node reads the Markdown content under content/,
 * renders it to HTML, and writes a fully static site to out/. Run with:
 *
 *   node scripts/build.mjs
 *
 * The renderer supports the small, deliberate subset of Markdown this site
 * uses: ATX headings, paragraphs, inline code, bold, links, flat and
 * one-level nested lists, pipe tables, fenced code blocks (with an optional
 * `title=` attribute), GitHub-style callouts (`> [!note]`, `> [!warn]`,
 * `> [!security]`), and horizontal rules. Everything else is out of scope on
 * purpose: the generator is meant to stay tiny and auditable.
 */

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTENT_DIR = join(ROOT, "content");
const STATIC_DIR = join(ROOT, "static");
const OUT_DIR = join(ROOT, "out");

const LIVE_DEMO_URL = "https://subrails-web-three.vercel.app/demo";
const REPO_URL = "https://github.com/Subrails/subrails-app";

// ---------------------------------------------------------------------------
// Navigation. The sidebar is generated from this tree on every page.
// ---------------------------------------------------------------------------

const NAV = [
  {
    id: "overview",
    label: "Overview",
    links: [{ href: "/", label: "Introduction" }],
  },
  {
    id: "protocol",
    label: "Protocol",
    links: [{ href: "/protocol", label: "Protocol mechanics" }],
  },
  {
    id: "contracts",
    label: "Contracts",
    links: [
      { href: "/contracts", label: "Overview" },
      { href: "/contracts/mandate-policy", label: "mandate-policy" },
      { href: "/contracts/subrails-account", label: "subrails-account" },
      { href: "/contracts/mandate-registry", label: "mandate-registry" },
    ],
  },
  {
    id: "guides",
    label: "Guides",
    links: [
      { href: "/guides/subscriber", label: "Subscriber guide" },
      { href: "/guides/merchant", label: "Merchant guide" },
    ],
  },
  {
    id: "developers",
    label: "Developers",
    links: [
      { href: "/developers", label: "Setup and environment" },
      { href: "/developers/sdk", label: "SDK reference" },
      { href: "/developers/indexer", label: "Indexer API" },
    ],
  },
  {
    id: "project",
    label: "Project",
    links: [{ href: "/contributing", label: "Contributing" }],
  },
];

const SITE_NAME = "Subrails docs";

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const files = await walk(CONTENT_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const pages = [];
  for (const file of mdFiles.sort()) {
    const source = await readFile(file, "utf8");
    const page = buildPage(source, file);
    pages.push(page);

    const outFile = join(OUT_DIR, page.relPath, "index.html");
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, page.html);
  }

  // Static assets.
  await copyStatic(await readdir(STATIC_DIR));

  // 404 page (same layout, no active section).
  await writeFile(join(OUT_DIR, "404.html"), layout({ html: notFoundHtml(), active: "", assets: "" }));

  // Link check: every internal link must resolve to a generated page.
  const errors = [];
  for (const page of pages) {
    for (const href of collectInternalLinks(page.raw)) {
      if (!linkResolves(href, page.relPath)) {
        errors.push(`${page.relPath}: broken internal link ${href}`);
      }
    }
  }
  for (const href of ["/docs.css", "/app.js"]) {
    if (!linkResolves(href, "")) {
      errors.push(`broken asset link ${href}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Link check failed:\n${errors.join("\n")}`);
  }

  // Sitemap, only when a canonical site URL is provided (hosting is a
  // follow-up, so there is no domain to hardcode).
  if (process.env.SITE_URL !== undefined && process.env.SITE_URL.trim() !== "") {
    await writeSitemap(pages, process.env.SITE_URL.replace(/\/$/, ""));
  }

  console.log(`built ${pages.length} pages to ${relative(ROOT, OUT_DIR)}`);
  for (const page of pages) {
    console.log(`  /${page.relPath === "" ? "" : page.relPath + "/"}`);
  }
}

/** Builds one page: frontmatter + markdown rendered into the shared layout. */
function buildPage(source, file) {
  const { meta, body } = parseFrontmatter(source);
  const rel = relative(CONTENT_DIR, file).replace(/\.md$/, "");
  const relPath = rel === "index" ? "" : rel;
  const href = `/${relPath === "" ? "" : `${relPath}/`}`;
  const depth = relPath === "" ? 0 : relPath.split(sep).length;
  const assets = depth === 0 ? "" : "../".repeat(depth);

  const { html, raw } = renderMarkdown(body);
  const title = meta.title ?? "Documentation";
  const description = meta.description ?? "";
  const eyebrow = meta.eyebrow ?? "";

  // Content links are written as absolute site paths ("/protocol"); rewrite
  // them relative to this page so the site also works under a subpath.
  const contentHtml = `${eyebrow === "" ? "" : `<p class="eyebrow">${escapeHtml(eyebrow)}</p>`}${html.replace(/href="\/([^"]*)"/g, (_m, path) => `href="${assetHref(`/${path}`, assets)}"`)}`;

  const pageHtml = layout({
    html: contentHtml,
    active: href,
    assets,
    title,
    description,
  });

  return {
    relPath,
    href,
    title,
    html: pageHtml,
    raw: body,
  };
}

// ---------------------------------------------------------------------------
// Layout.
// ---------------------------------------------------------------------------

function layout(opts) {
  const { html, active, assets, title = "Documentation", description } = opts;
  const fullTitle = title === SITE_NAME ? SITE_NAME : `${title} \u00b7 ${SITE_NAME}`;
  const assetsPrefix = assets === "" ? "" : assets;
  // Page hrefs carry a trailing slash; nav hrefs do not. Compare normalized.
  // An empty `active` (the 404 page) means no section is highlighted.
  const normActive = active === "" ? null : active.replace(/\/$/, "");
  const isActiveHref = (href) => normActive !== null && href.replace(/\/$/, "") === normActive;
  const current = NAV.find((s) => s.links.some((l) => isActiveHref(l.href)));

  const sidebar = NAV.map((section) => {
    const links = section.links
      .map(
        (link) =>
          `<li><a class="sidebar-link${isActiveHref(link.href) ? " active" : ""}" href="${assetHref(link.href, assetsPrefix)}">${escapeHtml(link.label)}</a></li>`,
      )
      .join("\n");
    return `<div class="sidebar-section"><div class="sidebar-section-label">${escapeHtml(section.label)}</div><ul>\n${links}\n</ul></div>`;
  }).join("\n");

  const mobileLinks = NAV.map((section) => {
    const isActive = section.links.some((l) => isActiveHref(l.href));
    const primary = section.links[0];
    return `<a class="mobile-link${isActive ? " active" : ""}" href="${assetHref(primary.href, assetsPrefix)}">${escapeHtml(section.label)}</a>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <script>try{var t=localStorage.getItem("subrails.docs.theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${assetsPrefix}docs.css" />
  <script src="${assetsPrefix}app.js" defer></script>
</head>
<body>
  <div class="docs">
    <header class="docs-header">
      <div class="docs-header-inner">
        <a class="brand" href="${assetHref("/", assetsPrefix)}">subrails<span class="brand-dot">.</span><span class="brand-sub">docs</span></a>
        <nav class="header-nav" aria-label="Primary">
          <a href="${LIVE_DEMO_URL}" target="_blank" rel="noreferrer">Live demo</a>
          <a href="${REPO_URL}" target="_blank" rel="noreferrer">GitHub</a>
          <button type="button" class="theme-toggle" aria-label="Switch color theme">DARK</button>
        </nav>
      </div>
    </header>

    <div class="docs-body">
      <aside class="docs-sidebar" aria-label="Sections">
        <div class="mobile-nav">
          <div class="mobile-nav-links">${mobileLinks}</div>
          <div class="mobile-section">${escapeHtml(current?.label ?? "")}</div>
        </div>
        <nav class="sidebar-nav">
${sidebar}
        </nav>
      </aside>

      <main class="docs-content">
${html}
      </main>
    </div>

    <footer class="docs-footer">
      <div>
        <div class="foot-brand">subrails</div>
        <p class="foot-meta">Recurring authorization on Stellar. Not audited. Testnet only. See the introduction before relying on anything here.</p>
      </div>
      <div class="foot-links">
        <a href="${LIVE_DEMO_URL}" target="_blank" rel="noreferrer">Live demo</a>
        <a href="${REPO_URL}" target="_blank" rel="noreferrer">Repository</a>
        <a href="${assetHref("/contributing", assetsPrefix)}">Contributing</a>
      </div>
    </footer>
  </div>
</body>
</html>
`;
}

function notFoundHtml() {
  return `<p class="eyebrow">404</p>
<h1>Page not found</h1>
<p class="lede">Nothing is documented at this address.</p>
<p>Try the <a href="./">introduction</a>, or pick a section from the sidebar. If you followed a link from somewhere else, it may point at a page that has moved.</p>`;
}

/** Turns an absolute href ("/protocol") into one that works from a nested page. */
function assetHref(href, assetsPrefix) {
  if (href === "/") {
    // From a nested page the root is exactly the prefix depth, which already
    // ends in "/"; from the root page it is "./".
    return assetsPrefix === "" ? "./" : assetsPrefix;
  }
  return `${assetsPrefix}${href.replace(/^\//, "")}`;
}

// ---------------------------------------------------------------------------
// Frontmatter and Markdown.
// ---------------------------------------------------------------------------

/** Splits leading `---` frontmatter off the source. */
function parseFrontmatter(source) {
  if (!source.startsWith("---")) {
    return { meta: {}, body: source };
  }
  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    return { meta: {}, body: source };
  }
  const raw = source.slice(3, end);
  const body = source.slice(end + 4).replace(/^\n/, "");
  const meta = {};
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match !== null) {
      meta[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }
  return { meta, body };
}

/** Renders a markdown body to an HTML fragment. Returns html and the raw text. */
function renderMarkdown(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  const rawParts = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code block. Everything after the backticks is the info string:
    // an optional language, and an optional title="..." attribute.
    const fence = /^```(.*)$/.exec(line);
    if (fence !== null) {
      const collected = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        collected.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      const info = parseFenceInfo(fence[1] ?? "");
      const code = escapeHtml(collected.join("\n"));
      rawParts.push(collected.join("\n"));
      html.push(
        `<figure class="codeblock"><figcaption class="codeblock-bar"><span class="codeblock-label">${escapeHtml(info.title)}</span><button type="button" class="codeblock-copy">copy</button></figcaption><pre><code>${code}</code></pre></figure>`,
      );
      continue;
    }

    // Callout or blockquote.
    if (line.startsWith(">")) {
      const { block, next } = collectQuote(lines, i);
      html.push(renderQuote(block));
      rawParts.push(block.join("\n"));
      i = next;
      continue;
    }

    // Table. The separator row is `| --- | --- |`; the hyphen must be a
    // literal in the character class (a `:-` range would exclude it).
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const table = collectTable(lines, i);
      html.push(renderTable(table));
      rawParts.push(table.map((r) => r.join(" | ")).join("\n"));
      i += table.length;
      continue;
    }

    // Heading.
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      rawParts.push(line);
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^-{3,}\s*$/.test(line)) {
      html.push("<hr />");
      i += 1;
      continue;
    }

    // List.
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const { items, next } = parseList(lines, i);
      html.push(renderList(items));
      rawParts.push(items.map((it) => it.text).join("\n"));
      i = next;
      continue;
    }

    // Paragraph: accumulate until a blank line or a block-starting line.
    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3})\s/.test(lines[i]) && !/^```/.test(lines[i]) && !lines[i].startsWith(">") && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^-{3,}\s*$/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    rawParts.push(paragraph.join("\n"));
  }

  return { html: html.join("\n"), raw: rawParts.join("\n") };
}

function parseFenceInfo(info) {
  let rest = info.trim();
  let lang = "";
  if (!rest.startsWith("title=")) {
    const langMatch = /^(\S+)/.exec(rest);
    if (langMatch !== null) {
      lang = langMatch[1];
      rest = rest.slice(langMatch[1].length).trim();
    }
  }
  let title = "code";
  // Explicit form: title="..." or title=word, with an optional trailing
  // lang= attribute, e.g. `title=signature lang=rust`.
  const explicit = /^title=(?:"([^"]*)"|(\S+))(?:\s+lang=(\S+))?$/.exec(rest);
  if (explicit !== null) {
    title = explicit[1] ?? explicit[2] ?? "code";
    if (explicit[3] !== undefined) {
      lang = explicit[3];
    }
  } else {
    // Fallback: an unquoted title that may contain spaces, e.g.
    // `title=workspace layout`. A trailing ` lang=` is still honored.
    const loose = /^title=(\S.*?)(?:\s+lang=(\S+))?$/.exec(rest);
    if (loose !== null) {
      title = loose[1];
      if (loose[2] !== undefined) {
        lang = loose[2];
      }
    }
  }
  return { title, lang };
}

/** Collects a run of consecutive `>` lines. */
function collectQuote(lines, start) {
  const block = [];
  let i = start;
  while (i < lines.length && lines[i].startsWith(">")) {
    block.push(lines[i]);
    i += 1;
  }
  return { block, next: i };
}

function renderQuote(block) {
  const first = /^>\s*\[!(note|warn|security)\]\s*(.*)$/.exec(block[0]);
  if (first !== null) {
    const variant = first[1];
    const title = first[2];
    const bodyLines = block.slice(1).map((l) => l.replace(/^>\s?/, ""));
    const body = renderQuoteBody(bodyLines);
    const titleHtml = title === "" ? "" : `<p class="callout-title">${escapeHtml(title)}</p>`;
    return `<aside class="callout callout-${variant}" data-variant="${variant}">${titleHtml}<div class="callout-body">${body}</div></aside>`;
  }
  const body = renderQuoteBody(block.map((l) => l.replace(/^>\s?/, "")));
  return `<blockquote>${body}</blockquote>`;
}

function renderQuoteBody(lines) {
  // Blank quote lines split paragraphs.
  const paragraphs = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }
  return paragraphs.map((p) => `<p>${renderInline(p)}</p>`).join("");
}

/** Collects a pipe table starting at `start`; returns rows of cells. */
function collectTable(lines, start) {
  const rows = [];
  let i = start;
  while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
    rows.push(splitTableRow(lines[i]));
    i += 1;
    if (rows.length === 1 && i < lines.length && TABLE_SEP_RE.test(lines[i])) {
      rows.push(splitTableRow(lines[i]));
      i += 1;
    }
  }
  return rows;
}

/** A pipe-table separator row, e.g. `| --- | --- |`. */
const TABLE_SEP_RE = /^\s*\|?[\s:|=-]+\|?\s*$/;

function splitTableRow(line) {
  // Split on unescaped pipes only, so a literal `\|` inside a cell survives.
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function renderTable(rows) {
  const [header, ...rest] = rows;
  const body = rest.filter((row, idx) => !(idx === 0 && row.every((c) => /^:?-{2,}:?$/.test(c))));
  const headHtml = `<thead><tr>${header.map((c) => `<th scope="col">${renderInline(c)}</th>`).join("")}</tr></thead>`;
  const bodyHtml = `<tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("\n")}</tbody>`;
  return `<table>${headHtml}${bodyHtml}</table>`;
}

/** Parses a flat (or one-level nested) list starting at `start`. */
function parseList(lines, start) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    const itemMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
    if (itemMatch === null) {
      break;
    }
    const indent = itemMatch[1].length;
    if (items.length > 0 && indent < items[items.length - 1].indent) {
      break;
    }
    items.push({ indent, text: itemMatch[3], ordered: /^\d+\.$/.test(itemMatch[2]) });
    i += 1;
    // Optional single nested list attached to this item.
    if (i < lines.length && /^\s{2,}([-*]|\d+\.)\s+/.test(lines[i])) {
      const { items: nested, next } = parseList(lines, i);
      items[items.length - 1].nested = nested;
      i = next;
    }
  }
  return { items, next: i };
}

function renderList(items) {
  const ordered = items[0]?.ordered ?? false;
  const tag = ordered ? "ol" : "ul";
  const lis = items
    .map((item) => {
      const nested = item.nested === undefined ? "" : renderList(item.nested);
      return `<li>${renderInline(item.text)}${nested}</li>`;
    })
    .join("\n");
  return `<${tag}>${lis}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Inline rendering: code spans, bold, italic, links.
// ---------------------------------------------------------------------------

function renderInline(text) {
  const codeSpans = [];
  const pills = [];
  let withPlaceholders = text.replace(/`([^`]+)`/g, (_m, code) => {
    const key = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(code);
    return key;
  });
  // Raw pill spans (e.g. error-code badges in tables) are tokenized too so
  // the escape pass cannot mangle them.
  withPlaceholders = withPlaceholders.replace(/<span class="pill(?:\s+pill-([a-z]+))?">([^<]+)<\/span>/g, (_m, tone, body) => {
    const key = `\u0000PILL${pills.length}\u0000`;
    const cls = tone === undefined ? "pill" : `pill pill-${tone}`;
    pills.push(`<span class="${cls}">${body}</span>`);
    return key;
  });

  let out = escapeHtml(withPlaceholders)
    // Bold (may wrap inline code placeholders).
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic.
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    // Links [text](url). The label is already escaped; the URL is escaped
    // here so a quote or ampersand cannot break out of the attribute.
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeHtml(url)}">${label}</a>`);

  // Restore code spans as <code>, then pills.
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx) => `<code>${escapeHtml(codeSpans[Number(idx)])}</code>`);
  out = out.replace(/\u0000PILL(\d+)\u0000/g, (_m, idx) => pills[Number(idx)]);
  return out;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function copyStatic(entries) {
  for (const entry of entries) {
    await copyFile(join(STATIC_DIR, entry), join(OUT_DIR, entry));
  }
}

/** Collects internal absolute links from raw markdown, ignoring code fences. */
function collectInternalLinks(raw) {
  const links = new Set();
  const withoutFences = raw.replace(/```[\s\S]*?```/g, "");
  const re = /\]\((\/[^)\s]+)\)/g;
  let match;
  while ((match = re.exec(withoutFences)) !== null) {
    links.add(match[1]);
  }
  return [...links];
}

/** Whether an absolute href resolves to a generated page or asset. */
function linkResolves(href, fromRelPath) {
  if (href === "/") {
    return true;
  }
  if (href === "/docs.css" || href === "/app.js" || href === "/404.html") {
    return true;
  }
  const clean = href.replace(/^\//, "").replace(/\/$/, "").replace(/#.*$/, "").replace(/\?.*$/, "");
  const target = join(OUT_DIR, clean, "index.html");
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function writeSitemap(pages, siteUrl) {
  const urls = pages
    .map((p) => `  <url><loc>${siteUrl}/${p.href.replace(/^\//, "")}</loc></url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  await writeFile(join(OUT_DIR, "sitemap.xml"), xml);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
