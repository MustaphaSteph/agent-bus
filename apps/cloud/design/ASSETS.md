# Agentic Landing Design

## Current Direction: Session Windows

The shared-code cursor artwork below has been superseded by recognizable
application windows, following user feedback. The current landing uses concept B
from [Session Window Headers](SESSION-HEADERS.md), which records all three new
image prompts, saved paths, and research references. Earlier prompts are kept
below only as provenance. Their artwork is no longer referenced by the landing.

Three independent subagent audits covered branding, product storytelling, and
visual direction. They agreed on software-native contributions and meaningful
handoffs, rejecting the previous industrial-hardware metaphor.

The GitHub banner in `../../../docs/assets/banner.png` remains the canonical
brand reference. Exact source colors: cyan `#00D4FF`, blue `#2563EB`, violet
`#7C3AED`; near-black `#05070A`. Lighter blue/violet variants are used for small
text to maintain contrast. Design settings: variance 6, motion 3, density 5.

The primary visual is an unframed shared code artifact with distinct author
cursors, not a generated dashboard screenshot. Exact agent names, roles, and
workflow content are native HTML. The interactive example is deterministic
browser state, explicitly labeled scripted, and never writes to the bus.

## Saved Assets

Built-in `image_gen` was used, not a fallback CLI or stock image service.
Original selected PNGs are in `originals/`; web-optimized derivatives:

- `../public/images/shared-work.webp`
- `../public/images/shared-work-mobile.webp`
- `../public/images/brand-reference.webp`
- `../public/images/agent-bus-mark.webp`

The header/footer mark uses the actual GitHub banner, positioned as a CSS image
sprite to preserve its original pixels and silhouette. The reference-derived
transparent mark is used only for the tiny favicon, not as the canonical logo.
PNG originals are preserved; WebP conversion and delivery sizing are the only
local image processing. Rejected metal artwork is no longer shipped.

## Shared Work: Initial Prompt

Reference: the repo banner. Transparent background: false.

> Create NEW original Agent Bus Cloud hero art using the reference ONLY for brand color identity: near-black, brilliant cyan #00d4ff, electric blue #2563eb, violet #7c3aed. Wide landscape 1536x1024. Agent Bus is SOFTWARE connecting independent AI coding sessions, not hardware. Concept: shared work with multiple authors. A crisp flat editorial digital composition with THREE distinctive pointer/caret marks (cyan, electric blue, violet) contributing to one shared translucent CODE CHANGE surface in the LOWER HALF. The surface is a luminous thin glass-like SOFTWARE plane, with short deliberate blocks of code lines, colored diff insertion rows, small review brackets and annotation rails. Independent authors' contributions visibly converge in the shared artifact. Palette crisp black, cool white, cyan blue violet, no mint or metal. Upper 45% almost uniformly #05070a empty space for real HTML heading. Bottom composition broad, unframed, asymmetrical but balanced, with clear negative spaces between authors. Think precise software-native art for an advanced agent collaboration tool, not stock AI futurism. No readable text, no logos; real names/messages will be composed in HTML. No enclosing dashboard, browser-window mockup, floating rounded cards, routers, servers, chips, cables, physical wires, circuit boards, chrome, brushed metal, robot, brain, humanoid, atom, network spheres, decorative orbs, particles, starfield, purple mist, neon bloom. Make connected authors and a shared code artifact understandable and beautiful. Flat precise silhouettes and layered graphical depth, software materials only.

## Shared Work: Selected Correction

The initial generation incorrectly included humans and was rejected. The final
image was edited through `image_gen` with the initial image as its reference:

> Correct this software collaboration hero artwork. REMOVE ALL THREE HUMAN FIGURES COMPLETELY: absolutely no people, heads, faces, hair, arms, hands, silhouettes or body outlines anywhere. Replace their positions with THREE LARGE SOFTWARE CURSOR / CARET POINTER MARKS ONLY, cyan left, electric-blue middle, violet right, each connected to its own contribution on the shared code-change plane by minimal typography annotation brackets. Keep the flat collaborative software/code diff surface in the lower half and clean near-black #05070a upper45% negative space. Make cursors precise and large enough to read. Thin code-line blocks white and cyan with violet reviewerbrackets, depth through software panes, no architecture/hardware/materialswires. The cursors are the actual agents: independent AI sessions contributing, not humans pretending to be AI. No logos, no readabletext, no browserframe, no dashboardcards, no routers, chips, cables, metal, robots, brains, bodies, floatingparticles, orbs, atmosphericpurpleclouds. Preserve Agent Bus exact cyan/electricblue/violet identity. Minimal luminousedges, no hugeglows. Wide landscape originalbitmap forfullbleedhero.

## AB Mark Prompt

Reference: the repo banner. Transparent background: true.

> Extract and faithfully reproduce ONLY the central Agent Bus AB monogram from this provided brand banner as a clean standalone transparent logo asset. Preserve the actual distinctive shape exactly: A triangular open arch merging into the B curved strokes, with small ring endpoints on the lower left, same connecting lines, same cyan on left progressing to electric blue and violet on right. This is asset extraction, NOT a new logo design. Flat crisp 2D brand mark with clean edges. No enclosing black chip/square/border, NO text Agent Bus or subtitles, NO circuit paths around it, NO provider marks, NO shadow or neon glow, NO brushed metal or 3D bevel. Genuine alpha transparentbackground, centered logo large with10%padding on squarecanvas. Match silhouette and proportions of existingABmonogram ascloselyaspossible.

## Mobile Composition Prompt

Reference: the selected desktop shared-work illustration. Transparent: false.

> Reframe this EXISTING Agent Bus software collaboration illustration for a narrow phone hero. PORTRAIT canvas, 2:3 aspect ratio. Preserve ONLY the shared code/diff surface and all THREE software pointer arrows: cyanleft, bluecenter, violetright, EACH FULLY INSIDE THE MIDDLE80%WIDTH, LARGE/readable, samevisualidentity. Remove nearly all empty upperblackspace, only10%paddingtop. Make the sharedcodeartifact morecompactandin thelower60%, with the three pointers clearlyaligned justaboveit atsameheight. Keep everypointerwhole and recognizable, with their annotationrails reaching distinctcyan/blue/violetcontributions. Exactpalette #05070a, #00d4ff, #2563eb, #7c3aed, whitecode rows. No text, labels, letters or logos. No newobjects. No human, body, face, robot, brain, networkhardware, chip, wires, metallicobjects, orb, particles or mist. This is a portrait RESPONSIVE VERSION of exactlythissoftwareconcept, not a newcompositionstyle. Beautiful restrainedsaturatedsoftwareidentity, crispminimal, cleanblackedges.
