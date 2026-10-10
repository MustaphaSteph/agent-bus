# Agent Bus Motion

18-second silent, authored coordination illustration. No live client data or
tested-integration claim. No video rendered.

## Integration

- Desktop: `/motion/index.html?embed=1`, authored at 1440x420 for a roughly 1000x300 iframe.
- Mobile: `/motion/mobile.html?embed=1`, authored at 600x600.
- Exact background: `#08090b`. Both center-fit inside the iframe viewport.
- Initial state: paused at 0, visible logos and routing graph.
- Reduced motion: seek to 17, then pause. All shared-record fields are visible.
- Parent must pause when the iframe is offscreen or the host tab is hidden.
  The driver also pauses on its own document visibility change; resumption
  always requires a new parent play command.

Send to `iframe.contentWindow.postMessage(message, location.origin)`:

```js
{ source: 'agent-bus-landing', action: 'hello' }
{ source: 'agent-bus-landing', action: 'play' }
{ source: 'agent-bus-landing', action: 'pause' }
{ source: 'agent-bus-landing', action: 'seek', time: 17 }
```

Only exact same-origin messages from the parent are accepted. Seeking clamps
finite numbers to [0, 18] and preserves playback state. Play loops at 18.
On ready and at up to 10 Hz while playing, the iframe sends:

```js
{ source: 'agent-bus-motion', type: 'ready' | 'time', time, duration: 18, playing }
```

Send `hello` from the iframe load handler to recover an initial `ready` that
fired before the parent's listener was installed. Every trusted `hello` replies
with `ready` after fonts are ready, including the current time and playback
state, without changing either. On `ready`, seek to the saved time and apply
the parent's play/pause policy. Match both
`event.origin === location.origin` and `event.source === iframe.contentWindow`.

| Phase | Start | Useful settled preview |
| --- | ---: | ---: |
| Connect | 0 | 1.5 |
| Send / Request | 3 | 4.8 |
| Claim | 6 | 8 |
| Review | 10 | 12.8 |
| Remember / Memory | 14 | 17 |

## Authoring

`build.mjs` is the markup source; `composition.css`, `composition.js`, and
`embed.js` are the style, deterministic timeline, and website-only driver.
`node build.mjs` generates Studio `index.html`, `compact/index.html`, and all
deployable files under `../../public/motion/`. Do not hand-edit generated HTML.
Studio embeds the authored script for static validation; deployment uses only
external local scripts. No CDN, network fetch, inline script, or audio runtime.
GSAP itself uses element style properties, so the host must permit inline
styles (normal for GSAP); `script-src 'self'` is sufficient for scripts.

Commands from this directory:

```sh
npm install
node build.mjs
npx hyperframes check --at 0,1.5,4.8,8,12.8,16.5,17,18
npx hyperframes check compact --at 0,1.5,4.8,8,12.8,16.5,17,18
node verify.mjs
npx hyperframes preview --background
```

`verify.mjs` uses installed Chrome through Playwright, starts a transient local
server, closes it on completion, and writes screenshots/results to `proof/`.
It checks five viewport sizes, six message-to-route distances below 2px, asset loads, deterministic reverse seeks,
transport, loop boundaries, and origin/source validation. HyperFrames reports
one advisory per layout about nested content in a single-scene timeline clip;
this continuous scene is deliberately not split into separate cuts.

## Assets And Provenance

Marks are unchanged copies from Nash's `../LOGO-SOURCES.md` inventory:
Claude Spark (Anthropic press kit); white OpenAI Blossom (OpenAI Agents SDK,
identifies Codex, not a distinct Codex app icon); Kimi (MoonshotAI repository);
Cursor and OpenCode dark-background brand-kit marks; Gemini CLI official icon.
Agent Bus uses the existing `public/images/agent-bus-mark.webp`, inspected before
adoption. No marks redrawn, recolored, cropped, morphed, or independently moved.
Only the message routes, status emphasis, and records animate.

`npx hyperframes media-use resolve --adopt --project .` adopted seven media
assets into the local provenance inventory. Fonts are bundled Manrope and IBM
Plex Mono (OFL), GSAP 3.14.2 and MotionPathPlugin retain their license headers.
The build copies dependency license files into deployed assets.
