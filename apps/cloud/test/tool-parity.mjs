import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localMcpToolNames() {
  const source = readFileSync(resolve("..", "..", "src", "mcp", "server.ts"), "utf8");
  const start = source.indexOf("const TOOLS = [");
  const end = source.indexOf("] as const;", start);
  assert(start !== -1 && end !== -1, "could not locate local MCP TOOLS registry");
  const block = source.slice(start, end);
  return [...block.matchAll(/^  \{\n    name: "([^"]+)"/gm)].map((match) => match[1]);
}

function cloudArray(name) {
  const source = readFileSync(resolve("src", "mcp", "tool-registry.ts"), "utf8");
  const start = source.indexOf(`export const ${name}`);
  assert(start !== -1, `could not locate ${name}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  assert(open !== -1 && close !== -1, `could not parse ${name}`);
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function cloudDispatchCases() {
  const source = readFileSync(resolve("src", "durable-objects", "workspace-bus.ts"), "utf8");
  const start = source.indexOf("private async dispatch(");
  const end = source.indexOf("\n  private toolPlanned", start);
  assert(start !== -1 && end !== -1, "could not locate cloud workspace dispatch switch");
  return [...source.slice(start, end).matchAll(/case "([^"]+)":/g)].map((match) => match[1]);
}

function diff(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

const localTools = localMcpToolNames();
const cloudTools = cloudArray("AGENT_BUS_TOOL_NAMES");
const implementedTools = cloudArray("CLOUD_IMPLEMENTED_TOOLS");
const dispatchCases = cloudDispatchCases();

assert(localTools.length === 65, `expected 65 local MCP tools, got ${localTools.length}`);
assert(cloudTools.length === localTools.length, `expected ${localTools.length} cloud tools, got ${cloudTools.length}`);
assert(diff(localTools, cloudTools).length === 0, `cloud registry is missing local tools: ${diff(localTools, cloudTools).join(", ")}`);
assert(diff(cloudTools, localTools).length === 0, `cloud registry has unknown local tools: ${diff(cloudTools, localTools).join(", ")}`);
assert(diff(cloudTools, implementedTools).length === 0, `cloud implemented set is missing registry tools: ${diff(cloudTools, implementedTools).join(", ")}`);
assert(diff(implementedTools, dispatchCases).length === 0, `cloud implemented tools are not dispatchable: ${diff(implementedTools, dispatchCases).join(", ")}`);
assert(implementedTools.includes("cloud_workspace"), "cloud_workspace diagnostic tool is not marked implemented");

console.log("agent-bus cloud tool parity passed");
