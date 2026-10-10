import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(root, '../../public');
const deployed = path.join(publicRoot, 'motion');
const assets = path.join(root, 'assets');
await mkdir(assets, { recursive: true });
const sources = {
  'agent-bus-mark.webp': 'images/agent-bus-mark.webp',
  'claude.svg': 'logos/claude.svg',
  'codex.svg': 'logos/codex-white.svg',
  'kimi.png': 'logos/kimi.png',
  'cursor.svg': 'logos/cursor.svg',
  'gemini.png': 'logos/gemini.png',
  'opencode.svg': 'logos/opencode.svg',
};
for (const [name, source] of Object.entries(sources)) await copyFile(path.join(publicRoot, source), path.join(assets, name));
for (const name of ['gsap.min.js', 'MotionPathPlugin.min.js']) await copyFile(path.join(root, 'node_modules/gsap/dist', name), path.join(assets, name));
for (const weight of [400, 600, 700]) await copyFile(path.join(root, `node_modules/@fontsource/manrope/files/manrope-latin-${weight}-normal.woff2`), path.join(assets, `manrope-${weight}.woff2`));
await copyFile(path.join(root, 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'), path.join(assets, 'mono-400.woff2'));
for (const font of ['manrope', 'ibm-plex-mono']) await copyFile(path.join(root, `node_modules/@fontsource/${font}/LICENSE`), path.join(assets, `${font}-LICENSE.txt`));

const phases = [
  ['Connect', 'Independent sessions. Shared context.'],
  ['Request', 'A request reaches the right session.'],
  ['Claim', 'One task. An explicit owner.'],
  ['Review', 'A second session checks the work.'],
  ['Memory', 'The decision stays with the project.'],
];

function composition(compact) {
  const width = compact ? 600 : 1440;
  const height = compact ? 600 : 420;
  const routes = compact ? {
    request: 'M154 233 H183 Q199 233 199 249 V286 Q199 302 215 302 H248',
    claim: 'M352 302 H384 Q400 302 400 286 V249 Q400 233 416 233 H446',
    verify: 'M300 353 V413',
    memory: 'M338 443 H388 Q404 443 404 459 V498 Q404 514 420 514 H450 V532',
    return: 'M220 532 H44 Q28 532 28 516 V249 Q28 233 44 233 H82',
    cursor: 'M172 160 H220 Q236 160 236 176 V218',
    gemini: 'M428 160 H380 Q364 160 364 176 V218',
    opencode: 'M548 377 V443 Q548 459 532 459 H404',
  } : {
    request: 'M177 152 H412',
    claim: 'M564 152 H805',
    verify: 'M564 152 H615 Q631 152 631 136 V104 Q631 88 647 88 H1175 Q1191 88 1191 104 V136 Q1191 152 1207 152 H1223',
    memory: 'M1327 152 H1392 Q1408 152 1408 168 V330 Q1408 346 1392 346',
    return: 'M48 346 H40 Q24 346 24 330 V168 Q24 152 40 152 H73',
    cursor: 'M859 324 V346',
    gemini: 'M1024 324 V346',
    opencode: 'M1214 324 V346',
  };
  const pathMarkup = Object.entries(routes).map(([key, d]) => `<path class="route route-${key}" id="path-${key}" d="${d}"/><path class="trace trace-${key}" id="trace-${key}" d="${d}"/>`).join('\n');
  const node = (id, title, asset, role) => `<section class="agent ${id}" id="${id}"><div class="logo-wrap"><img src="assets/${asset}" alt="" width="72" height="72"/><span class="node-focus" id="focus-${id}"></span></div><h2>${title}</h2><p>${role}</p></section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Agent Bus coordination illustration</title><link rel="stylesheet" href="composition.css"/><script src="assets/gsap.min.js" defer></script><script src="assets/MotionPathPlugin.min.js" defer></script><script src="composition.js" defer></script><script src="embed.js" defer></script></head>
<body class="${compact ? 'compact' : 'wide'}"><main id="root" data-composition-id="agent-bus" data-width="${width}" data-height="${height}" data-duration="18"><div id="coordination-scene" class="clip scene" data-start="0" data-duration="18" data-track-index="0">
<header><span class="eyebrow">${compact ? 'MCP COORDINATION / ILLUSTRATION' : 'MCP / ILLUSTRATION'}</span><div class="phase-headings">${phases.map(([name, title], i) => `<div class="phase-heading" id="heading-${i}"><span class="phase-number">0${i+1}</span><h1>${title}</h1></div>`).join('')}</div></header>
<svg class="circuit" viewBox="0 0 ${width} ${height}" aria-hidden="true">${pathMarkup}<rect id="packet" x="-7" y="-3" width="14" height="6" rx="2"/><rect id="packet-review" x="-7" y="-3" width="14" height="6" rx="2"/><rect id="packet-memory" x="-7" y="-3" width="14" height="6" rx="2"/></svg>
${node('claude', 'Claude', 'claude.svg', 'REQUESTER')}${node('codex', 'Codex', 'codex.svg', 'OWNER')}${node('kimi', 'Kimi', 'kimi.png', 'REVIEWER')}
<section class="hub"><img class="bus-mark" src="assets/agent-bus-mark.webp" width="184" height="160" alt="Agent Bus"/><h2>Agent Bus</h2><p>route / persist / coordinate</p><div class="hub-port"><span></span><span></span><span></span></div></section>
<div class="secondary cursor"><img src="assets/cursor.svg" alt="" width="26" height="26"/><span>Cursor</span></div><div class="secondary gemini"><img src="assets/gemini.png" alt="" width="26" height="26"/><span>Gemini CLI</span></div><div class="secondary opencode"><img src="assets/opencode.svg" alt="" width="26" height="26"/><span>OpenCode</span></div>
<div class="task"><span class="task-label">EXAMPLE REQUEST</span><strong>Review the change</strong><div class="task-states">${['Sessions connected', 'Request queued', 'Claimed by Codex', 'Kimi checks the result', 'Decision recorded'].map((text, i) => `<span class="task-state" id="state-${i}">${text}</span>`).join('')}</div></div>
<section class="record"><span class="record-label">SHARED RECORD</span><div class="record-fields"><div><small>REQUEST</small><span id="record-request">Review the change</span></div><div><small>OWNER</small><span id="record-owner">Codex</span></div><div><small>REVIEW</small><span id="record-review">Independent check</span></div><div class="memory-field"><small>MEMORY</small><span id="record-memory">Decision + context</span></div></div><div class="record-progress"></div></section>
<footer><span>Separate sessions</span><span>One shared thread</span></footer>
</div></main></body></html>`;
}
const css = await readFile(path.join(root, 'composition.css'), 'utf8');
const js = await readFile(path.join(root, 'composition.js'), 'utf8');
function studio(compact) {
  let html = composition(compact)
    .replace('<link rel="stylesheet" href="composition.css"/>', `<style>${css}</style>`)
    .replace('<script src="composition.js" defer></script>', '')
    .replace('<script src="embed.js" defer></script>', '')
    .replaceAll(' defer', '')
    .replace('</body>', `<script>${js}</script></body>`);
  return html;
}
await writeFile(path.join(root, 'index.html'), studio(false));
await mkdir(path.join(root, 'compact'), { recursive: true });
await mkdir(path.join(root, 'compact/assets'), { recursive: true });
await writeFile(path.join(root, 'compact/index.html'), studio(true));
await copyFile(path.join(root, 'hyperframes.json'), path.join(root, 'compact/hyperframes.json'));
await rm(path.join(root, 'mobile.html'), { force: true });
await mkdir(path.join(deployed, 'assets'), { recursive: true });
await writeFile(path.join(deployed, 'index.html'), composition(false));
await writeFile(path.join(deployed, 'mobile.html'), composition(true));
for (const file of ['composition.css', 'composition.js', 'embed.js']) await copyFile(path.join(root, file), path.join(deployed, file));
const { readdir } = await import('node:fs/promises');
for (const file of await readdir(assets)) {
  await copyFile(path.join(assets, file), path.join(deployed, 'assets', file));
  await copyFile(path.join(assets, file), path.join(root, 'compact/assets', file));
}
console.log('Built desktop and compact compositions; all runtime assets local.');
