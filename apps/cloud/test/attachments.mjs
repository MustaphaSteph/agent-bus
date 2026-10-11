import assert from "node:assert/strict";

export const testPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6S5sAAAAASUVORK5CYII=", "base64");

export async function testAttachments({ origin, scope, rpc, headers }, token) {
  const base = origin + "/api/workspaces/demo";
  const upload = (name, data, extraScope = {}, customHeaders = headers) => fetch(base + "/files?" + new URLSearchParams({ ...scope, ...extraScope, name }), { method: "POST", headers: customHeaders, body: data });
  const post = (ids, extra = {}, customHeaders = headers) => fetch(base + "/chat", { method: "POST", headers: customHeaders,
    body: JSON.stringify({ ...scope, content: "", attachment_ids: ids, request_id: crypto.randomUUID(), ...extra }) });
  const pngResponse = await upload("design.png", testPng);
  assert.equal(pngResponse.status, 201, await pngResponse.clone().text());
  const png = (await pngResponse.json()).attachment;
  assert.equal(png.content_type, "image/png");
  const mdResponse = await upload("plan.md", "# Plan\nBuild the shared inbox.");
  const md = (await mdResponse.json()).attachment;
  const image = await fetch(origin + png.url + "?preview=1", { headers });
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), testPng);
  assert.equal((await fetch(origin + png.url)).status, 401);
  const tokenHeaders = { authorization: `Bearer ${token}` };
  assert.equal((await fetch(origin + png.url, { headers: tokenHeaders })).status, 404, "agent saw unshared draft");

  assert.equal((await upload("empty.txt", "")).status, 400);
  assert.equal((await upload("large.zip", new Uint8Array(10485761))).status, 413);
  assert.equal((await upload("cross.txt", "denied", {}, { ...headers, origin: "https://evil.example" })).status, 403);
  assert.equal((await upload("agent.txt", "denied", {}, tokenHeaders)).status, 403);
  assert.equal((await post([png.id], { project: "different-project" })).status, 400);
  assert.equal((await post([png.id, png.id])).status, 400);
  assert.equal((await post(Array.from({ length: 6 }, () => crypto.randomUUID()))).status, 400);
  assert.equal((await post([crypto.randomUUID()])).status, 400);

  const spoof = await upload("../../fake.html", "<script>alert(1)</script>", {}, { ...headers, "content-type": "image/png" });
  const html = (await spoof.json()).attachment;
  assert.equal(html.name, "fake.html");
  assert.equal(html.content_type, "application/octet-stream");
  const inert = await fetch(origin + html.url + "?preview=1", { headers });
  assert.equal(inert.headers.get("content-type"), "application/octet-stream");
  assert(inert.headers.get("content-disposition").startsWith("attachment;"));
  assert(inert.headers.get("content-security-policy").includes("sandbox"));
  assert.equal(inert.headers.get("x-content-type-options"), "nosniff");
  assert.equal(inert.headers.get("cache-control"), "private, no-store");
  const deleted = await fetch(origin + html.url, { method: "DELETE", headers });
  assert.equal(deleted.status, 200);
  assert.equal((await post([html.id])).status, 400);
  assert.equal((await fetch(origin + html.url, { headers })).status, 404);

  const login = await fetch(origin + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "chat-viewer@example.com", password: "test-password-only" }) });
  const viewerHeaders = { ...headers, cookie: login.headers.get("set-cookie") };
  assert.equal((await upload("viewer.md", "no", {}, viewerHeaders)).status, 403);
  assert.equal((await fetch(origin + png.url, { headers: viewerHeaders })).status, 404);
  assert.equal((await fetch(origin + png.url, { method: "DELETE", headers: viewerHeaders })).status, 403);
  const otherWorkspace = await fetch(origin + "/api/workspaces", { method: "POST", headers, body: JSON.stringify({ slug: "files-other", name: "Other files" }) });
  assert.equal(otherWorkspace.status, 201);
  assert.equal((await fetch(origin + png.url.replace("/demo/", "/files-other/"), { headers })).status, 404);
  for (const op of ["attachment_reserve", "attachment_ready", "attachment_delete", "attachment_get"]) {
    const response = await fetch(base + "/rpc", { method: "POST", headers, body: JSON.stringify({ op, input: { id: png.id } }) });
    assert.equal(response.status, 403, "internal attachment operation exposed through RPC");
  }

  const requestId = crypto.randomUUID();
  const sent = await post([png.id, md.id], { request_id: requestId });
  assert.equal(sent.status, 201, await sent.clone().text());
  const result = (await sent.json()).result;
  const retry = await post([png.id, md.id], { request_id: requestId });
  assert.equal(retry.status, 201);
  assert.deepEqual((await retry.json()).result.ids, result.ids);
  assert.equal((await post([png.id])).status, 400, "attachment could be reused in another message");
  assert.equal((await fetch(origin + png.url, { method: "DELETE", headers })).status, 400);
  assert.equal((await fetch(origin + png.url, { headers: viewerHeaders })).status, 200);
  const agentDownload = await fetch(origin + md.url, { headers: tokenHeaders });
  assert.equal(agentDownload.status, 200);
  assert.equal(await agentDownload.text(), "# Plan\nBuild the shared inbox.");
  const inbox = await rpc("inbox", { agent: "chat-codex", ...scope });
  const message = inbox.messages.find(message => result.ids.includes(message.id));
  assert.deepEqual(message.attachments.map(file => file.id), [png.id, md.id]);
  const full = await rpc("get_message", { message_id: message.id });
  assert.equal(full.message.attachments[1].name, "plan.md");
  const view = await fetch(base + "/chat?" + new URLSearchParams(scope), { headers });
  assert((await view.json()).result.messages.some(message => message.attachments.some(file => file.id === png.id)));
  console.log("attachments API passed: upload, download, image sniffing, limits, isolation, role checks, drafts, file-only sends, idempotency, and agent delivery");
}
