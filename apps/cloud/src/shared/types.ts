export interface Env {
  WORKSPACE_BUS: DurableObjectNamespace;
  AGENT_BUS_CLOUD_DB: D1Database;
  AGENT_BUS_CLOUD_ENV: string;
  AGENT_BUS_CLOUD_AUTH_SECRET?: string;
  AUTH_SIGNUP_ENABLED?: string;
  AUTH_PUBLIC_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  CHAT_FILES: R2Bucket;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER?: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}

export type WorkspaceRole = "owner" | "manager" | "agent" | "viewer";

export interface Principal {
  kind: "anonymous" | "user" | "agent_token" | "oauth";
  id: string;
  workspaceId?: string;
  role: WorkspaceRole;
  displayName?: string;
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
