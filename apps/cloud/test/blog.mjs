import assert from "node:assert/strict";

export async function testBlog(origin) {
  const get = async (path, init) => {
    const response = await fetch(origin + path, init);
    return { response, text: await response.text() };
  };
  const index = await get("/blog?utm_source=test");
  const landing = await get("/");
  assert.ok((landing.text.match(/href="\/blog"/g) ?? []).length >= 3, "Blog linked in desktop/mobile/footer navigation");
  assert.equal(index.response.status, 200);
  assert.match(index.text, /<h1>Better work,/);
  assert.ok(index.text.includes(`rel="canonical" href="${origin}/blog"`));
  assert.ok(!index.text.includes("utm_source"));
  const slugs = [...new Set([...index.text.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
  assert.ok(slugs.length >= 2, "Expected launch articles");
  const titles = new Set();
  for (const slug of slugs) {
    const { response, text } = await get("/blog/" + slug);
    assert.equal(response.status, 200);
    assert.equal((text.match(/<h1[ >]/g) ?? []).length, 1);
    assert.ok(text.includes(`rel="canonical" href="${origin}/blog/${slug}"`));
    assert.match(text, /property="og:type" content="article"/);
    assert.match(text, /name="twitter:card"/);
    assert.doesNotMatch(text, /Durable Objects|better-sqlite3|AGENT_BUS_CLOUD_DB/);
    const graph = JSON.parse(text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])["@graph"];
    const article = graph.find((x) => x["@type"] === "BlogPosting");
    assert.ok(article.author.name);
    assert.equal(article.url, `${origin}/blog/${slug}`);
    assert.ok(Date.parse(article.datePublished) <= Date.parse(article.dateModified));
    assert.equal(graph.find((x) => x["@type"] === "BreadcrumbList").itemListElement.length, 3);
    titles.add(text.match(/<title>(.*?)<\/title>/)[1]);
    assert.equal((await get("/blog/" + slug, { method: "HEAD" })).text, "");
    const redirect = await get("/blog/" + slug + "/", { redirect: "manual" });
    assert.equal(redirect.response.status, 308);
    assert.equal(redirect.response.headers.get("location"), "/blog/" + slug);
  }
  assert.equal(titles.size, slugs.length, "Unique page titles");
  for (const path of ["/blog/missing", "/blog/nested/missing", "/blog/%3Cscript%3E"]) {
    const missing = await get(path);
    assert.equal(missing.response.status, 404);
    assert.match(missing.text, /noindex,follow/);
  }
  assert.equal((await get("/blog", { method: "POST" })).response.status, 405);
  assert.equal((await get("/blog/", { redirect: "manual" })).response.status, 308);
  const sitemap = await get("/sitemap.xml");
  assert.match(sitemap.response.headers.get("content-type"), /application\/xml/);
  assert.equal((sitemap.text.match(/<url>/g) ?? []).length, slugs.length + 2);
  for (const slug of slugs) assert.ok(sitemap.text.includes(`${origin}/blog/${slug}`));
  assert.ok(!sitemap.text.includes("/api/") && !sitemap.text.includes("/app<") && !sitemap.text.includes("/mcp/"));
  const robots = await get("/robots.txt");
  assert.ok(robots.text.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.ok(robots.text.includes("Disallow: /api/"));
  const rss = await get("/feed.xml");
  assert.match(rss.response.headers.get("content-type"), /application\/rss\+xml/);
  assert.equal((rss.text.match(/<item>/g) ?? []).length, slugs.length);
  assert.equal((await get("/feed.xml", { method: "HEAD" })).text, "");
  for (const asset of ["/blog.css", "/blog.js", "/landing.css", "/landing.js", "/images/agent-bus-mark.webp"]) assert.equal((await fetch(origin + asset)).status, 200);
  console.log("blog routes, metadata, canonical URLs, sitemap and feed passed");
}
