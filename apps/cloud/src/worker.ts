import type { Env } from "./shared/types";
import { json, notFound } from "./shared/http";
import { handleApi } from "./api/routes";
import { handleMcp, handleMcpInfo } from "./mcp/remote";
import { dashboardPage, landingPage } from "./web/pages";
import { WorkspaceBusObject } from "./durable-objects/workspace-bus";

export { WorkspaceBusObject };

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/") return landingPage();
    if (url.pathname === "/app") return dashboardPage(request, env);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);

    const mcpInfoMatch = url.pathname.match(/^\/mcp\/(?<workspace>[^/]+)\/info$/);
    if (mcpInfoMatch?.groups?.workspace) {
      return handleMcpInfo(request, env, mcpInfoMatch.groups.workspace);
    }

    const mcpMatch = url.pathname.match(/^\/mcp\/(?<workspace>[^/]+)$/);
    if (mcpMatch?.groups?.workspace) {
      return handleMcp(request, env, mcpMatch.groups.workspace, ctx);
    }

    return notFound();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "login required" || message.includes("not accessible") ? 401 : 500;
    return json({ error: { code: status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR", message } }, { status });
  }
}

export default {
  fetch: route,
} satisfies ExportedHandler<Env>;
