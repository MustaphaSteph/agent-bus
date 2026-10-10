# Blog Authoring

Public routes: `/blog`, `/blog/<slug>`, `/sitemap.xml`, `/robots.txt`, `/feed.xml`.
These pages are server-rendered; article content and links work without JavaScript.
JavaScript supplies the shared theme, mobile navigation controls, and active
article-section highlighting. The desktop table of contents stays beside the
article; native anchor links still work without JavaScript.

## Add an Article

Edit `apps/cloud/content/blog/posts.ts`. Each typed post has a unique lowercase
kebab-case slug, title, description, author, tags, publication date, optional
updated date, and sections. Each section has a unique anchor ID, heading, and
paragraph/list/code/link blocks. Text is escaped; raw HTML is not supported.
Links must be root-relative (not protocol-relative) or HTTPS.

Use `draft: true` while writing. Drafts and future-dated posts are excluded from
the index, article routes, related articles, sitemap, RSS and structured data.
Dates are real UTC `YYYY-MM-DD` dates. Only change `updated` for a meaningful
content revision, never on every build. Do not set a future updated date to
schedule a revision: it hides the whole article until that date.

Articles are committed source, not database records. Publish through the normal
reviewed Cloud deployment after explicit approval. Never put tokens, customer
messages, unsupported integrations or invented usage claims into posts.

## Search and Sharing

- Unique titles, descriptions, canonical URLs, OpenGraph and Twitter metadata.
- Blog/BlogPosting and BreadcrumbList JSON-LD. The author is an organization,
  matching the visible byline; no fictitious person profile.
- Sitemap includes the homepage, blog index and published posts. The homepage has
  no fabricated lastmod; article lastmod uses its authored revision date.
- RSS includes article summaries, permalinks and actual publication dates.
- Unknown articles return HTML 404 with noindex, not a soft 200.
- Trailing blog slashes redirect permanently. Canonicals exclude query strings.
- Public URLs derive from the request origin, not forwarded headers. When using
  a custom domain, redirect secondary production hosts to it at the deployment
  layer to avoid multiple public canonical origins.
- Robots excludes app/API/MCP paths from crawling; this is not access control.
  Authentication must continue to protect private routes independently.

The brand mark is used for social cards. Do not claim it is an article photograph
or add misleading rich-result image data. Search appearance is not guaranteed.
References: [Google Article guidance](https://developers.google.com/search/docs/appearance/structured-data/article),
[sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## Verify

From the repository root:

```sh
npx tsx apps/cloud/test/blog-content.ts
```

From `apps/cloud`:

```sh
npm run typecheck
npm test
AGENT_BUS_BROWSER_TEST=1 npm run check
```

The browser suite imports Playwright from `AGENT_BUS_PLAYWRIGHT_PATH` when set,
otherwise from `playwright`, and uses installed Chrome. Blog coverage checks
340/390/768/1440px, both themes, reload persistence, no-JS reading, navigation,
broken images and XML parsing. `AGENT_BUS_BLOG_SCREENSHOTS=1` saves captures to
`/tmp/blog-*.png`. API checks cover redirects, 404s, metadata and feeds.

Keep articles useful and substantial; do not generate thin keyword variations.
After the approved production deploy, verify the live canonical origin and
submit `/sitemap.xml` in the site's search-console account if available.
