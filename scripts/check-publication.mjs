import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const allowedRoots = new Set(['.github', '.githooks', 'docs', 'scripts', 'skills', 'src', 'test']);
const allowedFiles = new Set(['.gitignore', 'LICENSE', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'llms.txt', 'package.json', 'package-lock.json', 'tsconfig.json']);
const forbiddenPath = /(?:cloud|wrangler|\.dev\.vars|(?:^|\/)\.env(?:\.|$)|\.pem$|\.key$)/i;
const forbiddenText = /agent-bus-cloud|AGENT_BUS_CLOUD|cloud_workspace|workers\.dev|DurableObject|WORKSPACE_BUS|AUTH_PUBLIC_ORIGIN|OAUTH_KV|check:cloud|cloud claude-channel/;
const textFile = /\.(?:ts|js|mjs|json|yaml|yml|toml|md|txt|html|css|sh|map)$/;
const violations = new Set();

function inspect(path, read, packed = false) {
  const root = path.split('/')[0];
  if (forbiddenPath.test(path) || !(allowedFiles.has(path) || allowedRoots.has(root) || (packed && root === 'dist'))) {
    violations.add(`Disallowed path: ${path}`);
  }
  if (path.startsWith('skills/') && !path.startsWith('skills/agent-bus/')) violations.add(`Unexpected skill: ${path}`);
  // The gate must name forbidden markers to detect them, but ships no app code.
  if (path === 'scripts/check-publication.mjs') return;
  if (textFile.test(path) && forbiddenText.test(read().toString('utf8'))) violations.add(`Private implementation marker: ${path}`);
}

for (const path of run('ls-files', '-z').toString().split('\0').filter(Boolean)) inspect(path, () => readFileSync(path));
// Guard the next publication without rewriting existing repository history.
const entries = run('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean);
for (const line of entries) {
    const tab = line.indexOf('\t');
    const [mode, hash, stage] = line.slice(0, tab).split(' ');
    const path = line.slice(tab + 1);
    if (!['100644', '100755'].includes(mode) || stage !== '0') { violations.add(`Unsupported Git entry: ${path}`); continue; }
    inspect(path, () => run('cat-file', 'blob', hash));
}
const [archive] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
for (const file of archive.files) inspect(file.path, () => readFileSync(file.path), true);
const paths = new Set(archive.files.map(file => file.path));
for (const path of ['dist/cli/index.js', 'dist/mcp/server.js', 'skills/agent-bus/SKILL.md']) assert(paths.has(path), `Missing package entry: ${path}`);
assert(forbiddenPath.test('apps/cloud/src/worker.ts'));
assert(forbiddenText.test('AGENT_BUS_CLOUD_TOKEN'));
assert(!forbiddenPath.test('src/cli/delivery.ts'));
if (violations.size) throw new Error([...violations].join('\n'));
console.log(`Publication check passed: ${entries.length} current index entries and ${archive.files.length} package entries are Local-only. Historical commits are not audited.`);
