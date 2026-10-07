import type { Env, RpcRequest, RpcResponse, WorkspaceContext } from "../shared/types";

export async function callWorkspace(env: Env, context: WorkspaceContext, op: string, input: unknown): Promise<unknown> {
  const id = env.WORKSPACE_BUS.idFromName(context.id);
  const stub = env.WORKSPACE_BUS.get(id);
  const response = await stub.fetch("https://workspace-bus.internal/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, input, context } satisfies RpcRequest),
  });
  const body = (await response.json()) as RpcResponse;
  if (!body.ok) {
    throw new Error(body.error?.message ?? "workspace rpc failed");
  }
  return body.result;
}
