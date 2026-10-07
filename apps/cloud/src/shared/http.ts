export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

export function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

export function notFound(): Response {
  return json({ error: { code: "NOT_FOUND", message: "route not found" } }, { status: 404 });
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

function classifyError(message: string): { status: number; code: string } {
  if (message === "login required" || message.includes("not accessible") || message.includes("invalid workspace token")) {
    return { status: 401, code: "UNAUTHORIZED" };
  }
  if (
    message === "not allowed" ||
    message.includes("cannot call") ||
    message.includes("only workspace owners")
  ) {
    return { status: 403, code: "FORBIDDEN" };
  }
  if (message.includes("not found")) return { status: 404, code: "NOT_FOUND" };
  if (message.includes("cannot remove the last workspace owner") || message.includes("cannot demote the last workspace owner")) {
    return { status: 409, code: "CONFLICT" };
  }
  if (
    message.includes("required") ||
    message.includes("valid ") ||
    message.includes("invalid ") ||
    message.includes("must be") ||
    message.includes("expected application/json") ||
    message.includes("already registered") ||
    message.includes("already exists")
  ) {
    return message.includes("already registered") || message.includes("already exists")
      ? { status: 409, code: "CONFLICT" }
      : { status: 400, code: "BAD_REQUEST" };
  }
  return { status: 500, code: "INTERNAL_ERROR" };
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  const { status, code } = classifyError(message);
  return json({ error: { code, message } }, { status });
}

export async function readJson<T = unknown>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("expected application/json");
  }
  return (await request.json()) as T;
}
