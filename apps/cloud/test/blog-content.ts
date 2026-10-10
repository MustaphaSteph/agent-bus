import assert from "node:assert/strict";
import { posts } from "../content/blog/posts";
import { publishedPosts, blogRoute } from "../src/web/blog";

const post = structuredClone(posts[0]!);
assert.equal(publishedPosts([post], "2026-10-09").length, 0);
assert.equal(publishedPosts([{ ...post, draft: true }], "2026-10-10").length, 0);
assert.equal(publishedPosts([post], "2026-10-10").length, 1);
assert.throws(() => publishedPosts([post, post]), /duplicate/);
assert.throws(() => publishedPosts([{ ...post, slug: "<script>" }]), /slug/);
assert.throws(() => publishedPosts([{ ...post, date: "2026-02-30" }]), /date/);
assert.throws(() => publishedPosts([{ ...post, updated: "2026-01-01" }]), /date/);
const unsafe = structuredClone(post);
unsafe.sections[0]!.blocks.push({ type: "link", href: "javascript:alert(1)", text: "Bad" });
assert.throws(() => publishedPosts([unsafe]), /Unsafe/);
assert.equal(blogRoute(new Request("https://example.com/api/workspaces")), null);
const injection = blogRoute(new Request("https://example.com/blog/%3Cscript%3E?next=evil", { headers: { "x-forwarded-host": "evil.test" } }))!;
assert.equal(injection.status, 404);
assert.ok(!(await injection.text()).includes("evil.test"));
const original = posts[0]!;
try {
  posts[0] = { ...post, title: '</script><script>alert("x")</script>', date: "2020-01-01" };
  const response = blogRoute(new Request("https://example.com/blog/" + post.slug))!;
  const content = await response.text();
  assert.ok(!content.includes('<script>alert("x")</script>'));
  assert.ok(content.includes("&lt;/script&gt;"));
  const schema = JSON.parse(content.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!);
  assert.equal(schema["@graph"][0].headline, posts[0].title);
  const feed = await blogRoute(new Request("https://example.com/feed.xml"))!.text();
  assert.ok(feed.includes("&lt;/script&gt;"));
} finally { posts[0] = original; }
console.log("blog content validation, drafts, dates and unsafe links passed");
