export interface Env {
  WORKSPACE_BUS: DurableObjectNamespace;
  AGENT_BUS_CLOUD_DB: D1Database;
  AGENT_BUS_CLOUD_ENV: string;
}

export type WorkspaceRole = "owner" | "manager" | "agent" | "viewer";

export interface Principal {
  kind: "anonymous" | "user" | "agent_token";
  id: string;
  workspaceId?: string;
  role: WorkspaceRole;
}

export interface WorkspaceContext {
  id: string;
  slug: string;
  role: WorkspaceRole;
  principal: Principal;
}

export interface RpcRequest {
  op: string;
  input?: unknown;
  context: WorkspaceContext;
}

export interface RpcResponse {
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}
