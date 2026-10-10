import { posts, type BlogPost, type BlogBlock } from "../../content/blog/posts";
import { html } from "../shared/http";
import { icon } from "./icons";

const repository = "https://github.com/MustaphaSteph/agent-bus";
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function publishedPosts(all: BlogPost[] = posts, today = new Date().toISOString().slice(0, 10)): BlogPost[] {
  const slugs = new Set<string>();
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  for (const post of all) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug) || slugs.has(post.slug)) throw new Error("Invalid or duplicate blog slug");
    slugs.add(post.slug);
    if (!validDate(post.date) || (post.updated && (!validDate(post.updated) || post.updated < post.date))) throw new Error("Invalid blog date");
    if (![post.title, post.description, post.author].every((s) => s.trim()) || !post.sections.length) throw new Error("Incomplete blog post");
    const ids = new Set<string>();
    for (const section of post.sections) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(section.id) || ids.has(section.id)) throw new Error("Invalid or duplicate section id");
      ids.add(section.id);
      for (const block of section.blocks) {
        if (block.type === "link" && !/^\/(?!\/)|^https:\/\//.test(block.href)) throw new Error("Unsafe blog link");
      }
    }
  }
  return all.filter((p) => !p.draft && p.date <= today && (!p.updated || p.updated <= today)).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

const readingTime = (post: BlogPost) => Math.max(1, Math.ceil(post.sections.map((s) => s.title + " " + s.blocks.map((b) => b.type === "list" ? b.items.join(" ") : b.text).join(" ")).join(" ").split(/\s+/).length / 200));
const dateLabel = (date: string) => new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(date));
const metaLine = (post: BlogPost) => `<span>${escape(post.author)}</span><time datetime="${post.date}">${dateLabel(post.date)}</time><span>${readingTime(post)} min read</span>`;
const tags = (post: BlogPost) => `<div class="blog-tags">${post.tags.map((t) => `<span>${escape(t)}</span>`).join("")}</div>`;
const mark = `<img src="/images/agent-bus-mark.webp" width="28" height="28" alt="">`;

function shell(title: string, description: string, path: string, origin: string, body: string, schema: unknown[], post?: BlogPost, missing = false): Response {
  const url = origin + path;
  const nav = `<a href="/#how-it-works">How it works</a><a href="/#connect">Connect</a><a href="/blog" aria-current="${path === "/blog" ? "page" : "false"}">Blog</a><a href="${repository}">GitHub</a>`;
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="theme-color" id="theme-color" content="#08090b">
${missing ? '<meta name="robots" content="noindex,follow">' : `<link rel="canonical" href="${escape(url)}">`}
<meta property="og:type" content="${post ? "article" : "website"}"><meta property="og:site_name" content="Agent Bus"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${escape(origin)}/images/agent-bus-mark.webp"><meta property="og:image:alt" content="Agent Bus logo"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${escape(origin)}/images/agent-bus-mark.webp">
${post ? `<meta property="article:published_time" content="${post.date}T00:00:00Z"><meta property="article:modified_time" content="${post.updated ?? post.date}T00:00:00Z"><meta name="author" content="${escape(post.author)}">` : ""}
<link rel="alternate" type="application/rss+xml" title="Agent Bus Blog" href="/feed.xml"><link rel="icon" href="/images/agent-bus-mark.webp"><link rel="stylesheet" href="/landing.css?v=theme-1"><link rel="stylesheet" href="/blog.css?v=1">
<script>try{var t=localStorage.getItem("agent-bus.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
${schema.length ? `<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@graph": schema })}</script>` : ""}
</head><body class="blog-page"><a class="blog-skip" href="#main">Skip to content</a>
<header class="site-header" id="site-header"><a class="brand" href="/" aria-label="Agent Bus Cloud home">${mark}<span>agent bus</span><span class="brand-tag">cloud</span></a>
<nav class="desktop-nav" aria-label="Main navigation">${nav}</nav><div class="header-actions"><button type="button" class="theme-toggle icon-button" id="theme-toggle" data-mode="system" aria-label="Theme: match system. Switch to light">${icon("monitor", 18, "t-system")}${icon("sun", 18, "t-light")}${icon("moon", 18, "t-dark")}</button><a class="button button-small" href="/app">Open app</a><button type="button" class="menu-toggle icon-button" aria-expanded="false" aria-controls="mobile-nav" aria-label="Open navigation">${icon("menu")}</button></div></header>
<nav id="mobile-nav" class="mobile-nav" aria-label="Mobile navigation" hidden>${nav}</nav>
<main id="main" class="blog-main">${body}</main><footer class="blog-footer"><a class="brand" href="/">${mark}<span>agent bus</span></a><p>Independent agents. Connected work.</p><nav aria-label="Footer"><a href="/blog">All articles</a><a href="/feed.xml">RSS feed</a><a href="${repository}">GitHub</a></nav></footer><script src="/landing.js?v=theme-1" defer></script>${post ? '<script src="/blog.js?v=1" defer></script>' : ""}</body></html>`, { status: missing ? 404 : 200 });
}

function blockHtml(block: BlogBlock): string {
  switch (block.type) {
    case "paragraph": return `<p>${escape(block.text)}</p>`;
    case "list": return `<ul>${block.items.map((i) => `<li>${escape(i)}</li>`).join("")}</ul>`;
    case "code": return `<figure class="blog-code"><figcaption>${escape(block.label)}</figcaption><pre><code>${escape(block.text)}</code></pre></figure>`;
    case "link": return `<p><a href="${escape(block.href)}">${escape(block.text)}</a></p>`;
  }
}

const crumbs = (origin: string, post?: BlogPost) => ({ "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "Home", item: origin + "/" },
  { "@type": "ListItem", position: 2, name: "Blog", item: origin + "/blog" },
  ...(post ? [{ "@type": "ListItem", position: 3, name: post.title, item: origin + "/blog/" + post.slug }] : []),
] });

function indexPage(origin: string, published: BlogPost[]): Response {
  const title = "Agent Bus Blog | Guides for connected agent teams";
  const description = "Practical guides to connecting AI coding sessions, coordinating tasks, and keeping shared context with Agent Bus.";
  return shell(title, description, "/blog", origin, `<header class="blog-intro"><p class="blog-eyebrow">The Agent Bus blog</p><h1>Better work,<br>together.</h1><p>${description}</p><a class="blog-feed" href="/feed.xml">Follow via RSS ${icon("arrowDown", 14)}</a></header>
<section class="blog-articles" aria-labelledby="articles-title"><div class="blog-section-head"><h2 id="articles-title">Latest articles</h2><span>${published.length} guides</span></div>${published.map((p, i) => `<article class="blog-entry"><div class="blog-entry-art" aria-hidden="true">${i === 0 ? '<img class="logo-dark-only" src="/logos/codex-white.svg" width="52" height="52" alt=""><img class="logo-light-only" src="/logos/codex.svg" width="52" height="52" alt=""><span>+</span><img src="/logos/claude.svg" width="52" height="52" alt="">' : '<img src="/images/agent-bus-mark.webp" width="90" height="90" alt="">'}</div><div>${tags(p)}<h3><a href="/blog/${p.slug}">${escape(p.title)}</a></h3><p>${escape(p.description)}</p><div class="blog-meta">${metaLine(p)}</div></div></article>`).join("")}</section>`, [
    { "@type": "Blog", "@id": origin + "/blog#blog", name: "Agent Bus Blog", url: origin + "/blog", description, blogPost: published.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: origin + "/blog/" + p.slug, datePublished: p.date })) }, crumbs(origin),
  ]);
}

function articlePage(origin: string, post: BlogPost, published: BlogPost[]): Response {
  const path = "/blog/" + post.slug;
  const url = origin + path;
  return shell(post.title + " | Agent Bus Blog", post.description, path, origin,
    `<nav class="blog-breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog">Blog</a></nav><article>
<header class="blog-article-head">${tags(post)}<h1>${escape(post.title)}</h1><p class="blog-deck">${escape(post.description)}</p><div class="blog-meta">${metaLine(post)}${post.updated ? `<span>Updated <time datetime="${post.updated}">${dateLabel(post.updated)}</time></span>` : ""}</div></header>
<div class="blog-reader"><aside><nav class="blog-toc" aria-label="In this article"><h2>In this article</h2>${post.sections.map((s) => `<a href="#${s.id}">${escape(s.title)}</a>`).join("")}</nav></aside><div class="blog-prose">${post.sections.map((s) => `<section aria-labelledby="${s.id}"><h2 id="${s.id}">${escape(s.title)}</h2>${s.blocks.map(blockHtml).join("")}</section>`).join("")}<div class="blog-end"><p>Start with one team.</p><a class="button" href="/#connect">Connect your agents</a></div></div></div></article>
<section class="blog-related" aria-labelledby="related-title"><h2 id="related-title">Keep reading</h2>${published.filter((p) => p.slug !== post.slug).slice(0, 3).map((p) => `<a href="/blog/${p.slug}">${escape(p.title)} ${icon("reply", 16)}</a>`).join("")}</section>`, [
      { "@type": "BlogPosting", "@id": url + "#article", headline: post.title, description: post.description, url, mainEntityOfPage: url, datePublished: post.date + "T00:00:00Z", dateModified: (post.updated ?? post.date) + "T00:00:00Z", author: { "@type": "Organization", name: post.author, url: origin + "/" }, publisher: { "@type": "Organization", name: "Agent Bus", url: origin + "/", logo: { "@type": "ImageObject", url: origin + "/images/agent-bus-mark.webp" } }, inLanguage: "en", keywords: post.tags.join(", "), isPartOf: { "@id": origin + "/blog#blog" } }, crumbs(origin, post),
    ], post);
}

export function blogRoute(request: Request): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!(path === "/blog" || path.startsWith("/blog/") || ["/sitemap.xml", "/robots.txt", "/feed.xml"].includes(path))) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  // Derive public URLs from the request origin, never forwarded headers or query parameters.
  const origin = url.origin;
  const published = publishedPosts();
  let response: Response;
  const canonicalPath = path.replace(/\/+$/, "");
  if (path.startsWith("/blog/") && canonicalPath !== path) response = new Response(null, { status: 308, headers: { Location: canonicalPath + url.search } });
  else if (path === "/blog") response = indexPage(origin, published);
  else if (path === "/sitemap.xml") {
    const latest = published.map((p) => p.updated ?? p.date).sort().at(-1);
    response = new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(origin)}/</loc></url><url><loc>${escape(origin)}/blog</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}</url>${published.map((p) => `<url><loc>${escape(origin)}/blog/${p.slug}</loc><lastmod>${p.updated ?? p.date}</lastmod></url>`).join("")}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
  } else if (path === "/robots.txt") response = new Response(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api/\nDisallow: /mcp/\n\nSitemap: ${origin}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  else if (path === "/feed.xml") response = new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Agent Bus Blog</title><link>${escape(origin)}/blog</link><description>Practical guides for connected agent teams.</description><language>en</language><atom:link href="${escape(origin)}/feed.xml" rel="self" type="application/rss+xml"/>${published.map((p) => `<item><title>${escape(p.title)}</title><link>${escape(origin)}/blog/${p.slug}</link><guid isPermaLink="true">${escape(origin)}/blog/${p.slug}</guid><description>${escape(p.description)}</description><pubDate>${new Date(p.date).toUTCString()}</pubDate>${p.tags.map((t) => `<category>${escape(t)}</category>`).join("")}</item>`).join("")}</channel></rss>`, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
  else {
    const post = published.find((p) => path === "/blog/" + p.slug);
    response = post ? articlePage(origin, post, published) : shell("Article not found | Agent Bus", "This article is not available.", path, origin, '<div class="blog-intro"><p class="blog-eyebrow">404</p><h1>Article not found.</h1><p>This link may have changed, or the article is not published yet.</p><a class="button" href="/blog">Browse all articles</a></div>', [], undefined, true);
  }
  response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return request.method === "HEAD" ? new Response(null, response) : response;
}
