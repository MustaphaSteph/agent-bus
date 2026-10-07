import type { Env } from "../shared/types";
import { json, readJson } from "../shared/http";
import { callWorkspace } from "../api/rpc";
import { resolveWorkspaceContext } from "../auth/workspaces";
import { AGENT_BUS_TOOL_NAMES, cloudToolStatus } from "./tool-registry";

interface McpToolCallBody {
  tool?: string;
  name?: string;
  arguments?: unknown;
  input?: unknown;
}

export async function handleMcp(request: Request, env: Env, workspaceSlug: string): Promise<Response> {
  const context = await resolveWorkspaceContext(env, request, workspaceSlug);

  if (request.method === "GET") {
    return json({
      service: "agent-bus-cloud-mcp",
      workspace: workspaceSlug,
      endpoint: `/mcp/${workspaceSlug}`,
      protocol: "remote-mcp",
      note: "This route is the Agent Bus Cloud MCP surface. The implementation currently exposes direct JSON dispatch while the createMcpHandler adapter is wired.",
      tools: cloudToolStatus(),
    });
  }

  const body = await readJson<McpToolCallBody>(request);
  const tool = body.tool ?? body.name;
  if (!tool || !AGENT_BUS_TOOL_NAMES.includes(tool as never)) {
    return json({ error: { code: "UNKNOWN_TOOL", message: `unknown agent-bus tool: ${tool ?? "<missing>"}` } }, { status: 400 });
  }
  const result = await callWorkspace(env, context, tool, body.arguments ?? body.input ?? {});
  return json({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
}
