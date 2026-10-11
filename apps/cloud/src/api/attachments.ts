import type { Env } from "../shared/types";
import { HttpError, json } from "../shared/http";
import { cleanFilename, imageContentType, MAX_FILE_BYTES } from "../shared/attachments";
import type { AttachmentRow } from "../durable-objects/attachments";
import { resolveWorkspaceContext } from "../auth/workspaces";
import { callWorkspace } from "./rpc";

async function boundedBody(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES) throw new HttpError(413, "TOO_LARGE", "Files can be up to 10 MB.");
  if (!request.body) throw new HttpError(400, "EMPTY_FILE", "Choose a non-empty file.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FILE_BYTES) { await reader.cancel(); throw new HttpError(413, "TOO_LARGE", "Files can be up to 10 MB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!length) throw new HttpError(400, "EMPTY_FILE", "Choose a non-empty file.");
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}

export async function attachmentRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/files(?:\/([a-f0-9-]{36}))?$/);
  if (!match) return null;
  const context = await resolveWorkspaceContext(env, request, match[1]!);
  const id = match[2];
  if (id && (request.method === "GET" || request.method === "HEAD")) {
    let file: AttachmentRow;
    try { file = await callWorkspace(env, context, "attachment_get", { id }) as AttachmentRow; }
    catch { throw new HttpError(404, "NOT_FOUND", "File not found."); }
    const object = request.method === "HEAD" ? await env.CHAT_FILES.head(file.object_key) : await env.CHAT_FILES.get(file.object_key);
    if (!object) throw new HttpError(404, "NOT_FOUND", "File not found.");
    const preview = url.searchParams.get("preview") === "1" && file.content_type.startsWith("image/");
    return new Response(request.method === "GET" ? (object as R2ObjectBody).body : null, { headers: {
      "content-type": preview ? file.content_type : "application/octet-stream",
      "content-length": String(file.size),
      "content-disposition": `${preview ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16))}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    } });
  }
  if ((id && request.method !== "DELETE") || (!id && request.method !== "POST")) return new Response(null, { status: 405, headers: { Allow: id ? "GET, HEAD, DELETE" : "POST" } });
  if (context.principal.kind !== "user" || context.role === "viewer") throw new HttpError(403, "FORBIDDEN", "Sign in with write access to attach files.");
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "FORBIDDEN", "Upload from this workspace page.");
  if (id) return json(await callWorkspace(env, context, "attachment_delete", { id }));
  const name = cleanFilename(url.searchParams.get("name") || "attachment");
  const data = await boundedBody(request);
  const reservation = await callWorkspace(env, context, "attachment_reserve", {
    name, size: data.length, content_type: imageContentType(data),
    team: url.searchParams.get("team"), project: url.searchParams.get("project") || null, area: url.searchParams.get("area") || null,
  }) as AttachmentRow;
  try {
    await env.CHAT_FILES.put(reservation.object_key, data);
    const attachment = await callWorkspace(env, context, "attachment_ready", { id: reservation.id });
    return json({ attachment }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    await callWorkspace(env, context, "attachment_delete", { id: reservation.id }).catch(() => {});
    throw error;
  }
}
