# Official Logo Sources

Verified and downloaded 2026-10-08. Scope: `apps/cloud/public/logos/` only,
plus this ledger. These are publisher-provided assets, not generated marks,
traced screenshots, or marks reconstructed from memory. Artwork bytes are
unchanged; files extracted from official archives have descriptive local names.

## Core Paths For The Landing And Motion

Public URLs start with `/logos/`. Keep raster extensions as supplied.

| Public path | Actual artwork | Display notes |
| --- | --- | --- |
| `/logos/claude.svg` | Official Claude Spark, Clay | Transparent SVG, 94 x 94 viewBox; preserve its clay color. Label the client Claude Code when appropriate. |
| `/logos/codex.svg` | Official OpenAI Blossom from OpenAI's cookbook | Transparent SVG, 320 x 320 viewBox; `currentColor` defaults to black in an external image. This is OpenAI identification for Codex, NOT a distinct Codex app icon. |
| `/logos/kimi.png` | Kimi app logo from MoonshotAI's Kimi CLI repository | Original 128 x 128 RGBA PNG. Best at 32-64 CSS px; do not upscale into a large hero or substitute a hand-drawn K. |
| `/logos/cursor.svg` | Official Cursor 2D cube, dark-background version | Transparent SVG, 466.73 x 532.09 viewBox, light mark; identical to `cursor-dark.svg`. |
| `/logos/gemini.png` | Official Gemini CLI terminal icon | Original 1645 x 1645 PNG from the Gemini CLI site, not the general Gemini sparkle. |
| `/logos/opencode.svg` | Official OpenCode logo, dark-background version | SVG, 240 x 300 viewBox; identical to `opencode-dark.svg`. Preserve aspect ratio and supplied colors. |

Additional official variants: `claude-code-ivory.svg` and
`claude-code-slate.svg` are actual Claude Code wordmarks; `cursor-light.svg`
and `opencode-light.svg` are for light backgrounds. `codex-white.svg` is an
unmodified white OpenAI Blossom from the OpenAI Agents SDK docs, with its
original 721 x 721 viewBox and built-in clear space. Use it on dark backgrounds
instead of applying a color filter to `codex.svg`.

The `codex` filenames are integration-slot filenames only. In attribution,
identify the supplied artwork as OpenAI's logo. A monochrome source is not
permission to recolor it cyan or purple.

## Installer Evidence Is Not Cloud Certification

The companion repository's clean `install.sh`, at commit
`c5627c0a88e03a5b43d2deb8a3694a738564b8f4`, lines 143-149,
explicitly discovers all six clients as **skill installation destinations**:

| Client | Installer destination |
| --- | --- |
| Claude Code | `~/.claude/skills` |
| Codex | `~/.codex/skills` |
| Kimi Code | `~/.kimi/skills` and `~/.kimi-code/skills` |
| Cursor | `~/.cursor/skills` |
| Gemini CLI | `~/.gemini/skills` |
| OpenCode | `~/.opencode/skills` |

Evidence: [pinned installer source](https://github.com/MustaphaSteph/agent-bus-plugins/blob/c5627c0a88e03a5b43d2deb8a3694a738564b8f4/install.sh#L143-L149).
Local source inspected: `/Users/air/Documents/Projects/agent-bus-plugins/install.sh`.
Its later setup instructions also distinguish skill installation from MCP
registration. The main Agent Bus README and `docs/install.md` contain Claude,
Codex, and Kimi setup guidance. No new integration or end-to-end Cloud test was
performed during this asset task. Do not turn this evidence into "certified,"
"official partner," "connected now," or "all clients tested on Cloud."

## Exact Asset Provenance

### Claude And Claude Code

- Publisher: Anthropic PBC.
- Discovery: [Anthropic newsroom](https://www.anthropic.com/news), its official media-assets link.
- Download: [press kit](https://anthropic.com/press-kit).
- Resolved archive: `https://www-cdn.anthropic.com/ae59ca4ca194dac9c9dc3bc78c5829468cb0e8af.zip`.
- Archive root for the following entries: `Anthropic media resources/Anthropic logos/Claude logos/`.
- `claude.svg`: `3 Claude Spark/SVG/Claude Spark - Clay.svg`.
- `claude-code-ivory.svg`: `2 Claude Code logo/SVG/Claude Code logo - Ivory.svg`.
- `claude-code-slate.svg`: `2 Claude Code logo/SVG/Claude Code logo - Slate.svg`.
- Attribution: Claude and Claude Code marks belong to Anthropic. The press-kit download establishes provenance, not partnership or unlimited trademark rights. Keep colors, proportions, clear space, and product naming intact.

### Codex / OpenAI

- Publisher: OpenAI.
- `codex.svg` exact source: `https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/agents_sdk/deployment_manager/frontend/src/openai-logomark.svg`.
- `codex-white.svg` exact source: `https://raw.githubusercontent.com/openai/openai-agents-python/26345c1e45ebede8e2fc9b0bc7341dedab5e01fc/docs/assets/logo.svg`.
- Both sources are commit-pinned official OpenAI repositories. No generated logo examples in the cookbook were used.
- [OpenAI design guidelines and marks terms](https://openai.com/brand/) govern use independently of repository source-code licensing.
- Attribution: OpenAI logo and marks belong to OpenAI. Do not modify, add color/effects, imply endorsement, use as Agent Bus's primary branding, or make it more prominent than Agent Bus. Keep prescribed clear space. Co-branded partnership materials require approval; a logo collection must not be presented as a partner lockup.

### Kimi

- Publisher: Moonshot AI.
- `kimi.png` exact source: `https://raw.githubusercontent.com/MoonshotAI/kimi-cli/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/web/public/logo.png`.
- Official product: [Kimi Code](https://www.kimi.com/code).
- This is the original repository app logo, not a fabricated CLI-specific symbol. Attribution: Kimi marks belong to Moonshot AI; source availability is not a broad trademark license.
- Lifecycle caution: the [official repository getting-started guide](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/guides/getting-started.md) currently warns that legacy Kimi CLI is archived and directs users to Kimi Code CLI. The [current official quick start](https://www.kimi.ai/help/kimi-code/cli-getting-started) describes the replacement. Recheck current MCP setup before making a tested-compatibility claim. The archived asset's provenance remains explicit here.

### Cursor

- Publisher: Anysphere, Inc.
- Discovery and guidance: [official Cursor brand page](https://cursor.com/brand).
- Exact archive: `https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip`.
- `cursor.svg` and `cursor-dark.svg`: `General Logos/Cube/SVG/CUBE_2D_DARK.svg`.
- `cursor-light.svg`: `General Logos/Cube/SVG/CUBE_2D_LIGHT.svg`.
- Attribution: Cursor marks belong to Anysphere. The publisher prefers 2D logos and horizontal lockups; the cube is available separately. Pair this isolated mark with a nearby client name. Call it Cursor, not Cursor AI or Cursor Code. Keep original artwork and spacing.

### Gemini CLI

- Publisher: Google.
- Discovery: [Gemini CLI official site](https://geminicli.com/), where this icon appears in the hero and favicon metadata; [official repository](https://github.com/google-gemini/gemini-cli).
- `gemini.png` exact source: `https://geminicli.com/icon.png`.
- Attribution: Gemini CLI and its mark belong to Google. This is a first-party UI asset, not a claim of Google approval or an independently granted marketing license. Preserve the supplied artwork. Do not label it a generic Google or Gemini model logo.

### OpenCode

- Publisher: Anomaly.
- Discovery: [official OpenCode brand page](https://opencode.ai/brand).
- Exact archive: `https://opencode.ai/opencode-brand-assets.zip`.
- `opencode.svg` and `opencode-dark.svg`: `OpenCode Brand Assets/Logo/opencode-logo-dark.svg`.
- `opencode-light.svg`: `OpenCode Brand Assets/Logo/opencode-logo-light.svg`.
- Attribution: OpenCode marks belong to their respective owner, Anomaly. The official brand page supplies these downloads; do not imply sponsorship or remove the mark's internal shapes. The page's preview PNGs were not used as final logo assets.

### Meta Muse

- Publisher: Meta Platforms, Inc.
- Discovery: [Muse official web app](https://muse.ai/), where the mark is the page's `Muse` brand image and, byte-identical apart from whitespace, its SVG favicon `https://muse.ai/images/favicon/app-squiggle.svg`. Product identity: [Muse at Meta](https://ai.meta.com/muse/).
- `meta-muse.svg` exact source: `https://muse.ai/images/landing/brand/muse-logo.svg`, downloaded 2026-10-10, bytes unchanged. 100 x 100 viewBox, blue linear-gradient handwritten `M`, no scripts or external references.
- This is the personal-agent app mark, not Muse Code. Do not use it for Muse Code, and keep the "Personal agent; connection unverified" status: the mark identifies the product, it does not establish an Agent Bus integration.
- Attribution: Muse and its mark belong to Meta. Public availability is provenance, not a trademark license or endorsement.

## Exploratory Only

These names are NOT in the inspected installer candidate list. No Agent Bus
Cloud compatibility, endorsement, or connection is established for them.

| Name | Official research and outcome | Asset decision |
| --- | --- | --- |
| OpenClaw | [Official site](https://openclaw.ai/) links its [official repository](https://github.com/openclaw/openclaw). Distinct product identity established, but no Agent Bus installer target or Cloud validation found. | `openclaw-exploratory.svg`, unchanged download from `https://openclaw.ai/favicon.svg`. Research/reference only; exclude from supported-client rows and connected-agent animations. OpenClaw mark remains its owner's trademark. |
| Harness | [Harness.io's worker-agent announcement](https://www.harness.io/blog/introducing-autonomous-worker-agents) describes a software-delivery platform. Separately, [harness.lol](https://www.harness.lol/docs/getting-started/quick-start) and [twaldin/harness](https://github.com/twaldin/harness) describe a coding-agent wrapper. The bare name does not resolve which product the user intends. | No asset copied. Do not choose a corporate Harness logo for a generic agent harness or present either as a supported client. Clarify the intended product first. |
| Muse Code | [Meta's official developer product page](https://ai.meta.com/llama/) identifies Muse Code as a terminal coding agent; [Meta VR CLI release notes](https://developers.meta.com/vr/downloads/package/meta-vr-cli/1.8.0/) also name it. Direct product-page retrieval was login-limited, although official indexed content was available. | No standalone official Muse Code SVG/PNG verified in this pass. Do not substitute the Meta infinity mark, generate a Muse mark, or imply integration. |
| Your dot | [OpenAI's official help article](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot) identifies this as an always-on ChatGPT agent with user-selectable name/avatar. | No distinct reusable official product mark verified. Do not invent a circle, copy a personal avatar, or relabel the OpenAI Blossom as a Your dot logo. No installer target or Cloud test established. |

## Implementation Guardrails

- Keep Agent Bus's own identity dominant. Attribute third-party marks to their owners and state that identification does not imply affiliation or endorsement.
- Label motion as an illustrative workflow, not evidence of live connections. Animate message paths and workflow states around intact marks; do not morph, stretch, recolor, texture, or merge marks into Agent Bus's identity.
- Use `object-fit: contain` and fixed containers. Do not crop marks to manufacture uniform geometry; retain each asset's viewBox and built-in clear space.
- External SVG images do not inherit page text color. Select the supplied light/dark variant rather than using CSS filters or editing fills.
- Do not infer legal permission solely from a public download or open-source license. Recheck current publisher terms before launch; these notes are provenance and implementation cautions, not legal clearance.
- Parent owns the main page; Banach owns motion. This task did not alter either implementation.

## Verification

Downloaded PNG signatures/dimensions were checked with `file`; all SVGs passed
`xmllint --noout`. Core PNGs were visually inspected. Core SVGs were rendered
with macOS Quick Look and inspected as marks, not screenshots used as assets.
No script, foreignObject, linked image, or remote asset dependency was found
in the delivered SVGs. No behavior code changed, so application tests were not
run for this asset-only task.
