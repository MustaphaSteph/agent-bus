import { handleMcp } from "../../src/mcp/remote";
import type { Env, WorkspaceContext } from "../../src/shared/types";
export { WorkspaceBusObject } from "../../src/durable-objects/workspace-bus";

// Isolated runtime test only: supplies an authorized context without real accounts.
const workspace: WorkspaceContext = { id: "delivery-runtime", slug: "delivery", role: "owner", principal: { kind: "user", id: "test", role: "owner" } };
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handleMcp(request, env, "delivery", ctx, workspace);
  },
};
