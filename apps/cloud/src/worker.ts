import type { Env } from "./shared/types";
import { errorResponse, notFound } from "./shared/http";
import { handleApi } from "./api/routes";
import { handleMcp, handleMcpInfo } from "./mcp/remote";
import { dashboardPage, landingPage } from "./web/pages";
import { blogRoute } from "./web/blog";
import { WorkspaceBusObject } from "./durable-objects/workspace-bus";

export { WorkspaceBusObject };

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  try {
    const blog = blogRoute(request);
    if (blog) return blog;
    if (url.pathname === "/") return landingPage();
    if (url.pathname === "/app") return await dashboardPage(request, env);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);

    const mcpInfoMatch = url.pathname.match(/^\/mcp\/(?<workspace>[^/]+)\/info$/);
    if (mcpInfoMatch?.groups?.workspace) {
      return await handleMcpInfo(request, env, mcpInfoMatch.groups.workspace);
    }

    const mcpMatch = url.pathname.match(/^\/mcp\/(?<workspace>[^/]+)$/);
    if (mcpMatch?.groups?.workspace) {
      return await handleMcp(request, env, mcpMatch.groups.workspace, ctx);
    }

    return notFound();
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  fetch: route,
} satisfies ExportedHandler<Env>;
