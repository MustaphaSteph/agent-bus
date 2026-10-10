# Logo-Led Landing

Updated 2026-10-08. This supersedes the generated session-window direction.

## Brief

The user requested a complete new landing page using actual client logos and
HyperFrames animation that explains meaningful agent coordination. Existing
Agent Bus branding remains: near-black, cyan, blue and violet. No new AI-generated
client imagery, fabricated client marks, customer claims or automatic-execution
promises are used.

Design read: expressive technical SaaS for developers coordinating independent
AI sessions. Native server-rendered HTML/CSS/JavaScript, Space Grotesk display
and Manrope body, fixed typography breakpoints, unframed page sections and an
interactive example workspace. Design variance 7, motion 7, density 4.

## Narrative

1. A continuous HyperFrames scene shows connected clients, then request,
   ownership, independent review and a shared memory record.
2. The human view follows a single task across conversation, board and memory.
   A reviewer finds a focus bug before the task can complete.
3. A saved decision, risk or handoff produces a sample session brief.
4. Team recipes demonstrate user-selected roles, including peers without a PM.
5. Setup and FAQ distinguish coordination from agent compute and file syncing.

Motion explains causality. It does not suggest the demonstration is live.
No automatic execution happens when visitors click example controls. Main CTAs
keep the existing `/app` authentication and workspace setup route.

## HyperFrames

Source, brief, storyboard, deterministic GSAP timeline, local dependency assets,
validation and embed documentation live in [motion](motion/README.md).
The website embeds the HTML composition directly, not a rendered video.
There is no video-render service or runtime CDN dependency. The general-video
workflow was refreshed through `hyperframes skills update general-video`.

Parent controls are keyboard-operable and expose five seek positions plus
play/pause. Reduced motion starts at the final shared-record state. Playback
pauses outside the viewport and in a hidden browser tab. The iframe validates
both the message origin and parent window. Mobile uses its own composition.

## Assets

- Official logos: [source ledger](LOGO-SOURCES.md). A skill installation target
  is not a tested Cloud integration or a partnership claim.
- Agent Bus mark: existing repository banner and mark assets.
- Manrope Latin variable font: Google Fonts CSS, `fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2`.
- Space Grotesk Latin variable font: Google Fonts CSS, `fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2`.
- Font licenses are included in `public/fonts/` (SIL Open Font License).
- Control icons: unchanged Lucide Static 0.468.0 SVG assets from its npm package,
  with the ISC license in `public/icons/LICENSE.txt`. CSS masks inherit button color.

## References Applied

The earlier [agentic-site research](AGENTIC-WEBSITE-RESEARCH.md) remains the
source for product storytelling, not the old window-art requirement:

- Lindy: readable request -> action -> result.
- Factory: explicit worker ownership and progress.
- Devin: evidence before completion.
- LangSmith: make otherwise invisible coordination inspectable.

The current user direction replaces client-window illustrations with intact
official logos. OpenClaw research is retained but is not displayed as a verified
integration. No verified standalone Muse Code or Your dot logo was found;
Harness remains ambiguous. No substitutes were invented.

## Verification

- Cloud typecheck, tool parity, API smoke, CLI smoke and Wrangler dry-run.
- Browser inspection of desktop/mobile layout, logo loading and phase controls.
- Example task progression: open -> working -> review -> completed -> saved handoff.
- Requirement change resets board, transcript, evidence and saved memory together.
- Memory-kind selection produces the matching sample brief.
- Keyboard tab navigation, mobile navigation and reduced-motion handling.

Examples are browser-local fixtures. They do not call models or write production
workspace data. Original generated image concepts remain archived, but are no
longer loaded by the landing page.
