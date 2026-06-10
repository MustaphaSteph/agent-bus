export type BusErrorCode =
  | "NAME_TAKEN"
  | "UNKNOWN_AGENT"
  | "ASK_TIMEOUT"
  | "ASK_CYCLE"
  | "ASK_NOT_FOUND"
  | "ASK_RECIPIENT_UNAVAILABLE"
  | "MESSAGE_NOT_FOUND"
  | "THREAD_NOT_FOUND"
  | "TEAM_NOT_FOUND"
  | "AGENT_HAS_ACTIVE_TASKS"
  | "TEAM_HAS_ACTIVE_TASKS"
  | "INVALID_INPUT"
  | "TASK_NOT_FOUND"
  | "TASK_INVALID_TRANSITION"
  | "TASK_NOT_CLAIMABLE"
  | "TASK_FORBIDDEN"
  | "TASK_SCOPE_CONFLICT"
  | "TASK_REVIEW_REQUIRED"
  | "REVIEW_SELF_FORBIDDEN";

export class BusError extends Error {
  readonly code: BusErrorCode;
  constructor(code: BusErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BusError";
  }
}
