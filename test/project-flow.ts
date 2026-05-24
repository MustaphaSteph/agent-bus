import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "project-flow-"));
process.env.AGENT_BUS_DIR = tmp;

const {
  register,
  send,
  whois,
  askBest,
  ask,
  inbox,
  reply,
  recentMessages,
  createTask,
  listTasks,
  PROJECT_WILDCARD,
} = await import("../src/bus.js");
const { closeDb } = await import("../src/db.js");
const { deriveProject } = await import("../src/util/project.js");

console.log("deriveProject(cwd):", deriveProject(process.cwd()));

// Two projects share the bus. Plus one legacy (NULL project) agent.
register({ name: "alice-vorec", project: "vorec" });
register({ name: "bob-vorec", project: "vorec", capabilities: ["react"] });
register({ name: "alice-bgai", project: "bgai", capabilities: ["react"] });
register({ name: "legacy" }); // no project = NULL

const msg1 = send({ from: "alice-vorec", to: "bob-vorec", content: "in vorec" });
console.log("msg from vorec agent carries project:", msg1.project === "vorec" ? "OK" : "FAIL");

const msg2 = send({ from: "legacy", to: "alice-bgai", content: "from legacy" });
console.log("msg from legacy agent has NULL project:", msg2.project === null ? "OK" : "FAIL");

// whois scoped to vorec should include vorec agents + legacy (NULL).
const vorecWhois = whois({ project: "vorec" });
const vorecNames = vorecWhois.map((a) => a.name).sort();
console.log(
  "whois(vorec):",
  vorecNames.join(","),
  vorecNames.includes("alice-vorec") && vorecNames.includes("bob-vorec") && vorecNames.includes("legacy") && !vorecNames.includes("alice-bgai") ? "OK" : "FAIL",
);

const allWhois = whois({ project: PROJECT_WILDCARD });
console.log("whois(*) returns all 4:", allWhois.length === 4 ? "OK" : "FAIL (" + allWhois.length + ")");

// ask_best in vorec — bob-vorec is the in-project match.
let askError: string | null = null;
const replier = setTimeout(async () => {
  const pend = await inbox({ agent: "bob-vorec" });
  const a = pend.find((m) => m.kind === "ask");
  if (a) reply({ from: "bob-vorec", ask_id: a.id, answer: "vorec-react-answer" });
}, 200);
try {
  const r = await askBest({
    from: "alice-vorec",
    capability: "react",
    question: "memo?",
    timeout_s: 5,
  });
  console.log(
    "ask_best(react) routed in vorec to:",
    r.from_agent === "bob-vorec" ? "bob-vorec OK" : "FAIL " + r.from_agent,
  );
} catch (e) {
  askError = (e as Error).message;
  console.log("FAIL: ask_best threw", askError);
}
clearTimeout(replier);

// ask_best for a capability that exists only in another project — should fail loud.
try {
  await askBest({
    from: "alice-vorec",
    capability: "rust-runtime",
    question: "?",
    timeout_s: 1,
  });
  console.log("FAIL: ask_best should have rejected unknown capability");
} catch (e) {
  const msg = (e as Error).message;
  console.log(
    "ask_best unknown capability fails loud:",
    msg.includes("rust-runtime") && msg.includes("vorec") ? "OK" : "FAIL — " + msg,
  );
}

// listTasks scope — task in vorec only visible to vorec listing.
createTask({ requested_by: "alice-vorec", title: "build feature X" });
createTask({ requested_by: "alice-bgai", title: "bgai task" });
createTask({ requested_by: "legacy", title: "legacy task" }); // NULL project

const vorecTasks = listTasks({ project: "vorec" });
console.log(
  "list_tasks(vorec):",
  vorecTasks.length === 1 && vorecTasks[0]?.project === "vorec" ? "OK" : "FAIL (" + vorecTasks.length + ")",
);

const allTasks = listTasks({ project: PROJECT_WILDCARD });
console.log("list_tasks(*) returns all 3:", allTasks.length === 3 ? "OK" : "FAIL (" + allTasks.length + ")");

// recent messages scoped to vorec — should include msg1 (vorec) and NULL legacy.
const vorecRecent = recentMessages({ project: "vorec" });
const includesVorecMsg = vorecRecent.find((m) => m.id === msg1.id);
const includesLegacyMsg = vorecRecent.find((m) => m.id === msg2.id);
console.log(
  "recent(vorec) includes vorec msg + legacy NULL msg:",
  includesVorecMsg && includesLegacyMsg ? "OK" : "FAIL",
);

closeDb();
rmSync(tmp, { recursive: true, force: true });
console.log("\nproject flow sanity passed");
