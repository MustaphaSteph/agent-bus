// Runtime-independent task policies for the local SQLite bus.
export const TASK_TRANSITIONS = {
  backlog: ["open", "canceled"],
  open: ["backlog", "claimed", "canceled"],
  claimed: ["working", "completed", "open", "canceled", "failed"],
  working: ["blocked", "completed", "failed", "canceled"],
  blocked: ["working", "completed", "failed", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
} as const;

export interface ReportTask {
  id: number;
  title: string;
  state: string;
  mode: string;
  blocked_reason: string | null;
  stale?: boolean;
  final_answer: string | null;
  result: string | null;
  manager_reviewed: boolean;
  review_required: boolean;
  review_state: string;
}

export interface ReportTest {
  status: string;
  command: string;
  output_summary?: string | null;
  git_ref?: string | null;
  cwd?: string | null;
}

export function buildFinalReport<T extends ReportTest>(tasks: ReportTask[], testResults: T[], warnings: string[] = []) {
  const implemented = tasks.filter(task => task.state === "completed").map(task => task.title);
  const notImplemented = tasks.filter(task => !["backlog", "completed", "canceled"].includes(task.state)).map(task => task.title);
  const knownRisks = tasks.filter(task => task.blocked_reason !== null || task.state === "failed" || task.stale === true)
    .map(task => `#${task.id} ${task.title}${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`);
  const testsPassed = tasks.filter(task => task.mode === "test_only" && task.state === "completed")
    .map(task => task.final_answer ?? task.result ?? task.title);
  for (const result of testResults.filter(row => row.status === "passed")) {
    testsPassed.push(`${result.command}${result.output_summary ? ` - ${result.output_summary}` : ""}${result.git_ref ? ` @${result.git_ref}` : ""}${result.cwd ? ` cwd=${result.cwd}` : ""}`);
  }
  const manualTestsNeeded = tasks.filter(task => task.state !== "backlog" &&
    (task.state !== "completed" || task.manager_reviewed === false || (task.review_required && task.review_state !== "approved")))
    .map(task => task.title);
  const safe = notImplemented.length === 0 && knownRisks.length === 0 && manualTestsNeeded.length === 0;
  return {
    implemented, not_implemented: notImplemented, known_risks: knownRisks,
    tests_passed: testsPassed, test_results: testResults, manual_tests_needed: manualTestsNeeded, warnings,
    safe_to_commit: safe, safe_to_push: safe, safe_to_deploy: false as const,
  };
}
