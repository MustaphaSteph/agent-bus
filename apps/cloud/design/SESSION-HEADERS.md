# Generated Session Window Headers

Generated with the built-in image_gen tool on 2026-10-08. No fallback API or stock-image service was used.

These are AI-generated illustrative interfaces based on official client references, not captures of a live Agent Bus integration. The main landing uses concept B. Concept C is exploratory and must not be used as proof that OpenClaw, Muse Code or Your dot integrations were tested.

## Saved Files

| Concept | Original PNG | Web Asset |
| --- | --- | --- |
| A: Design handoff | `headers/header-sessions-a.png` | `../public/images/header-sessions-a.webp` |
| B: Three working sessions | `headers/header-sessions-b.png` | `../public/images/header-sessions-b.webp` |
| C: Wider ecosystem | `headers/header-ecosystem-c.png` | `../public/images/header-ecosystem-c.webp` |

Compare all three at `/header-concepts.html`. Local processing is WebP encoding only. Responsive window close-ups use CSS viewport positioning of the original concept B, without modifying the pixels.

Concept B was refined for larger, shorter transcript text. See [the refinement prompt](headers/REFINEMENT.md); the initial image is preserved as `headers/header-sessions-b-initial.png`.

## References

- Agent Bus identity: `../../../docs/assets/banner.png`
- Claude terminal style: https://claude.com/product/claude-code and `references/claude-terminal.webp`
- Codex session layout: https://openai.com/index/introducing-the-codex-app/
- Kimi desktop and terminal: https://www.kimi.com/code
- Broader clients: `AGENT-CLIENT-REFERENCES.md`
- SaaS design analysis: `AGENTIC-WEBSITE-RESEARCH.md`

## Concept A Prompt

Transparent background: false. Inputs: Agent Bus banner (brand reference), Claude terminal artwork (interface reference).

```text
Use case: ui-mockup. Create a premium wide website HERO BACKGROUND image for Agent Bus Cloud, 1536x1024 landscape. This is an illustrative software collaboration scene, NOT a screenshot of a real running integration. Use reference 1 only for Agent Bus black/cyan/electric-blue/violet brand palette and AB mark. Use reference 2 only for Claude Code terminal window styling.

CRITICAL COMPOSITION: TOP 38% is completely empty uniform near-black #05070a for HTML headline and buttons. Bottom 62% contains THREE substantial, recognizable application WINDOWS, arranged on one plane with mild overlap and ALL titles legible. Front-on software interface art, crisp realistic pixels, no 3D perspective. Each window has real macOS titlebar with three small traffic-light controls. Background seamless #05070a. No extra text outside windows, no headline baked into the image.

LEFT WINDOW: Codex desktop app dark theme, at x6%-41%, y44%-92%. Recognizable narrow project sidebar with New thread / Projects / todo-app, spacious chat body, bottom composer. Large title 'Codex'. Thread heading 'Build the task app'. Short clear chat text: 'Claude, can you design the task list?' Then a thin tool action row 'agent-bus / send'. Cyan small status 'Design requested'.

RIGHT upper WINDOW: Claude Code TERMINAL (not the Claude chat website), x44%-94%, y40%-71%. Anthropic terracotta accent, monospace typography, dark charcoal. Title 'Claude Code'. Orange asterisk heading 'Claude Code'. Transcript: '> Design the task list' then 'Design ready. Sending the handoff to Codex.' Tool row 'agent-bus / reply'. Keep comfortable padding and line lengths.

RIGHT lower WINDOW: Kimi Code CLI, x52%-94%, y75%-97%. Title 'Kimi Code'. Thin electric-blue outlined welcome block, blue Kimi mark, monospaced review transcript 'Reviewing keyboard navigation...' and green 'Review approved'.

Between the three windows, draw very fine cyan/electric-blue/violet connection paths, a tiny AB brand mark where paths meet. Practical intentional cables, no glowing orbs. Human-readable sparse text, no walls of tiny fake code. Windows sharply in focus, top space absolutely clear, titles larger than inner text. Premium launch art, graphic precision. No people, robots, physical monitors, desks, floating cursors, sparkles, neon fog, bokeh, gradients in empty background, generic icon cards. Use only the THREE named real windows.
```

## Concept B Prompt

Transparent background: false. Inputs: Agent Bus banner (brand reference), Claude terminal artwork (interface reference).

```text
Use case: ui-mockup. Create a polished 1536x1024 web hero background for Agent Bus Cloud. Concept B: a team of independent AI application windows working together. TOP 38 percent of canvas completely empty solid #05070a for live HTML heading. Composition sits entirely in bottom 60 percent with 4% margin. No baked-in marketing headlines or external labels.

Three real-looking FRONT-ON desktop software windows in a wide horizontal spread, with modest overlap at edges: left Claude Code terminal, large center Codex desktop, right Kimi Code terminal. All three titles stay completely visible. MacOS window traffic-light controls; crisp functional chrome, charcoal #15171c surfaces, neutral grey separators. Central window 42% canvas width, sides 30% each, overlap only empty margins. Codex begins at y48%, Claude and Kimi at y42%. The three windows are connected by a very fine cyan/blue/violet routing trace below them around a SMALL AB mark. No fantasy machinery. Use first reference for actual Agent Bus AB logo and palette only, NOT its feature cards, neon borders, icons or text. Use second reference for authentic Claude terminal feel only.

Claude window: orange asterisk and prominent 'Claude Code' in title; monospace output; selected transcript '> Design the task list', 'Layout ready.', 'Sent to codex-pm'. A readable small diff preview of TaskList.swift in green and red.

Codex center: prominent 'Codex' title, recognizable left sidebar with 'New thread', 'Projects', 'todo-app', main conversation with 'Build the task app', user message 'Work with Claude and Kimi.', response 'Design received. Implementing now.', action 'agent-bus / send', bottom composer 'Ask a follow-up'. Do not use generic chat bubbles for everything, native open text conversation and tool foldouts.

Kimi right: 'Kimi Code' title, electric-blue thin welcome outline, simple blue rectangular face mark, monospaced message 'Reviewing the change...', 'Keyboard checks passed.', 'Review sent to codex-pm'. Green pass check on one line only.

Subtle depth from realistic window shadows, quiet black canvas, cyan #00d4ff blue #2563eb violet #7c3aed connecting strokes used sparingly. Truly legible sparse text, balanced ample whitespace in windows. No humans, orbs, sparkles, icons-as-agents, abstract cursors, physical screens, bokeh, clouds, decorative code rain, perspective tilt, floating feature cards. The subject is the application WINDOWS.
```

## Concept C Prompt

Transparent background: false. Inputs: Agent Bus banner (brand reference), Claude terminal artwork (interface reference).

```text
Use case: ui-mockup. Generate an alternate 1536x1024 website header concept for Agent Bus Cloud. Concept C: the wider world of agent sessions. This is an exploratory illustration of products, not proof of tested integration. All products represented as actual desktop or terminal APPLICATION WINDOWS, never logo tiles.

Top 38% empty solid near-black #05070a reserved for HTML headline. Lower 62% is a carefully arranged workspace with SIX small but recognizable windows, a larger Codex conversation window in the center foreground and the others around it without hiding their titlebars. Crisp front-on 2D software interfaces, subtle realistic shadows, no perspective. Cyan/electric-blue/violet thin routing traces on plain dark ground. Tiny AB mark central-bottom, based on reference banner. Do not copy the banner's cards or text.

1 Center: Codex desktop, dark sidebar with Projects and todo-app, main chat, foldout tool rows, lower composer. Title 'Codex'. Main text 'Plan the next step.'
2 upper left: Claude Code terminal with orange asterisk heading, monospace text '> Review the layout'.
3 upper right: Kimi Code CLI, blue thin outlined welcome box, monospace 'Review the changes'.
4 lower left: OpenClaw browser window, black homepage with small neutral abstract avatar, center title 'OpenClaw', agent / local / workspace selector row, wide composer with small red send arrow. Text 'What should we work on?'
5 lower right: Muse Code terminal, black monospaced task/status table with two rows, title 'Muse Code', footer with model and path. Text 'Inspect the project'.
6 narrow rear window to far right: 'Your dot', desktop conversation with narrow navigation rail, chat bubbles and adjacent browser work surface. No invented model versions.

Use large readable titles and sparse body content. Do not render 'connected', approval ticks, endorsement badges, success receipts or invented usage metrics. The concept depicts possible session diversity only. Background pure black, muted neutral window chrome, limited brand cyan #00d4ff blue #2563eb violet #7c3aed line accents. No robots, people, hardware monitors, code rain, space nebulae, glowing spheres, bokeh, decorative gradients, abstract cards, disembodied cursors. Top area MUST remain empty for headline.
```
