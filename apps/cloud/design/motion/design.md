# Design

Concept: a precise routing diagram makes responsibility visible while a single request becomes durable project knowledge.

## Palette
Background #08090b; foreground #f4f6f8; secondary #a6adb8; lines #303640;
cyan #00d4ff for requests and memory; blue #2563eb for ownership;
violet #7c3aed for review; light violet #bda5ff for readable review text.
Official logo colors remain unchanged.

## Typography
Locally bundled Manrope Latin 400/600/700 for human language; IBM Plex Mono
Latin 400 for operation labels. Letter spacing 0. Desktop titles 32-34px,
phase headline 40px, record values 22px, record labels 16px, status 18px.
Primary images 84px; the official OpenAI image uses 116px to account for
its built-in clear space without cropping. Compact retains its existing type.

## Composition
Unframed full-bleed, fixed 1440x420 or 600x600, center-fit only in the embed.
Desktop is recomposed horizontally for a 1000x300 parent viewport, not vertically
squashed. Primary nodes span the width; review routes above their row; the
shared record is a full-width lower band. Peripheral clients connect to it.
Focal element: authentic AB mark at the circuit junction. Primary anchors:
Claude requester, Codex owner, Kimi reviewer. Smaller peripheral client marks
stay connected but never compete with the three actors. Bottom shared record
provides the causal outcome. Task packet is one genuinely framed data object.
8px maximum corner radius, no nested cards, no shadows, no ambient movement.
Spacing follows 8px units, with at least 20px clearance around text.

## Motion
One scene, no hard cuts. Functional path traces and message travelers use
svg-path-draw; explicit state changes use discrete-text-sequence and
control-target-sync. Mutations live on the paused timeline, not callbacks.
0.25-0.55s state arrivals, 0.8-1.2s routing legs, readable holds. Final memory
returns through the bus before a quiet reset at 17.5-18s. No fake live counts.
