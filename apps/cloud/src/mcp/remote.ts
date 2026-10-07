import type { Env } from "../shared/types";
import { json, readJson } from "../shared/http";
import { callWorkspace } from "../api/rpc";
import { resolveWorkspaceContext } from "../auth/workspaces";
import { AGENT_BUS_TOOL_NAMES, cloudToolStatus } from "./tool-registry";
import { metadataForTool } from "./tool-metadata";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

interface McpToolCallBody {
  tool?: string;
  name?: string;
  arguments?: unknown;
  input?: unknown;
}

function createAgentBusMcpServer(env: Env, workspaceSlug: string) {
  const server = new McpServer({
    name: `agent-bus-cloud-${workspaceSlug}`,
    version: "0.1.0",
  });

  for (const toolName of AGENT_BUS_TOOL_NAMES) {
    const metadata = metadataForTool(toolName);
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: metadata.description,
        inputSchema: metadata.inputSchema,
      },
      async (input, context) => {
        const request = context.http?.req;
        if (!request) throw new Error("missing MCP request context");
        const workspaceContext = await resolveWorkspaceContext(env, request, workspaceSlug);
        const result = await callWorkspace(env, workspaceContext, toolName, input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: { result },
        };
      },
    );
  }

  server.registerTool(
    "cloud_workspace",
    {
      title: "cloud_workspace",
      description: metadataForTool("cloud_workspace").description,
      inputSchema: metadataForTool("cloud_workspace").inputSchema,
    },
    async (_input, context) => {
      const request = context.http?.req;
      if (!request) throw new Error("missing MCP request context");
      const workspaceContext = await resolveWorkspaceContext(env, request, workspaceSlug);
      const result = await callWorkspace(env, workspaceContext, "cloud_workspace", {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { result },
      };
    },
  );

  return server;
}

export async function handleMcpInfo(request: Request, env: Env, workspaceSlug: string): Promise<Response> {
  const context = await resolveWorkspaceContext(env, request, workspaceSlug);
  return json({
    service: "agent-bus-cloud-mcp",
    workspace: workspaceSlug,
    workspace_id: context.id,
    endpoint: `/mcp/${workspaceSlug}`,
    protocol: "remote-mcp",
    note: "Connect MCP-capable clients to the endpoint above. Use this /info endpoint for human-readable diagnostics.",
    tools: cloudToolStatus(),
  });
}

export async function handleMcp(request: Request, env: Env, workspaceSlug: string, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("json") === "1") return handleMcpJson(request, env, workspaceSlug);

  const handler = createMcpHandler(
    () => createAgentBusMcpServer(env, workspaceSlug),
    {
      route: `/mcp/${workspaceSlug}`,
      responseMode: "auto",
    },
  );
  return handler(request, env, ctx);
}

async function handleMcpJson(request: Request, env: Env, workspaceSlug: string): Promise<Response> {
  const context = await resolveWorkspaceContext(env, request, workspaceSlug);
  const body = await readJson<McpToolCallBody>(request);
  const tool = body.tool ?? body.name;
  if (!tool || (!AGENT_BUS_TOOL_NAMES.includes(tool as never) && tool !== "cloud_workspace")) {
    return json({ error: { code: "UNKNOWN_TOOL", message: `unknown agent-bus tool: ${tool ?? "<missing>"}` } }, { status: 400 });
  }
  const result = await callWorkspace(env, context, tool, body.arguments ?? body.input ?? {});
  return json({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
}
