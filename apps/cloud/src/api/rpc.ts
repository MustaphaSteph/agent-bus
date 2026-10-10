import type { Env, RpcRequest, RpcResponse, WorkspaceContext } from "../shared/types";
import { HttpError } from "../shared/http";

const READ_ONLY_OPS = new Set([
  "cloud_workspace",
  "human_chat_view",
  "whois",
  "directory",
  "wait_for_agents",
  "subscribers",
  "inbox_status",
  "inbox_previews",
  "get_message",
  "message_status",
  "why_no_reply",
  "thread",
  "recent",
  "list_tasks",
  "tasks",
  "get_task",
  "check_scope_conflicts",
  "wait_for_task",
  "list_task_events",
  "list_test_results",
  "task_result",
  "final_report",
  "review_gate",
  "scopes",
  "message_page",
  "message_thread",
  "timeseries",
  "activity",
  "cockpit",
  "team_board",
  "project_board",
  "list_memories",
  "session_brief",
  "list_decisions",
]);

const MANAGER_ONLY_OPS = new Set([
  "remove_agent",
  "delete_team",
]);

function assertWorkspacePermission(context: WorkspaceContext, op: string): void {
  if (op === "human_chat_post" && context.principal.kind !== "user") {
    throw new HttpError(403, "FORBIDDEN", "Sign in to send a human message.");
  }
  if (context.role === "viewer" && !READ_ONLY_OPS.has(op)) {
    throw new HttpError(403, "FORBIDDEN", `workspace role viewer cannot call mutating operation ${op}`);
  }
  if (context.role === "agent" && MANAGER_ONLY_OPS.has(op)) {
    throw new HttpError(403, "FORBIDDEN", `workspace role agent cannot call manager operation ${op}`);
  }
}

export async function callWorkspace(env: Env, context: WorkspaceContext, op: string, input: unknown): Promise<unknown> {
  assertWorkspacePermission(context, op);
  const id = env.WORKSPACE_BUS.idFromName(context.id);
  const stub = env.WORKSPACE_BUS.get(id);
  const response = await stub.fetch("https://workspace-bus.internal/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, input, context } satisfies RpcRequest),
  });
  const body = (await response.json()) as RpcResponse;
  if (!body.ok) {
    throw new HttpError(response.status >= 400 ? response.status : 400, body.error?.code ?? "BUS_ERROR", body.error?.message ?? "workspace rpc failed");
  }
  return body.result;
}
