# DESIGN.md

## Overall Style
Warm, soft, modern. Should feel like a calm travel companion — not a productivity tool, not a booking site.

## Color Palette
Sand-and-sea, in OKLCH. Defined as Tailwind tokens in `src/app/globals.css`; the hi-fi reference is `design_handoff_together_app/README.md`.

- **Sea** (`--sea`) — deep blue-green; primary accent, replaces the original pink. Italic display words use this.
- **Sand** (`--sand`) — warm tan; ARRIVE/DEPART day tags, neutral surface tints.
- **Clay** (`--clay`) — terracotta; packing surface tint + progress.
- **Moss** (`--moss`) — muted green; AI/suggestion accents (Phase 5).
- **Dusk** (`--dusk`) — slate-blue; budget surface tint.
- **Background**: warm off-white in light mode, warm-mocha in dark mode (not neutral black).
- Each color has a matching `*-tint` for full-bleed surface backgrounds.

## Design Principles
- **Mobile-first.** Most trip planning happens on phones. Test on a phone, not a desktop.
- **Plenty of whitespace.** Calm beats dense.
- **Both partners feel equal ownership.** No "owner" badges. Shared things look shared.
- **AI is visible but quiet.** A subtle indigo border on AI-generated content; never a flashy gradient or sparkle.
- Soft shadows, rounded corners, smooth transitions. Avoid generic "AI app" aesthetics (sharp gradients, dark hero, etc.).

## Typography
Three families, all via `next/font/google`:
- **Instrument Serif** — display + the italic emphasis words (trip names, greetings).
- **IBM Plex Sans** — body copy.
- **IBM Plex Mono** — small marks (coords, mono badges, tab labels, dates).

Type recipes (`t-display`, `t-label`, `t-mono`, `t-num`) live in `globals.css`. Clear hierarchy: trip name big serif, day labels mid mono, items small sans.

## Tone & Copy
- Supportive, not chirpy. "Add a stop" beats "Let's plan something fun!"
- Calm and concrete. Use specifics — destinations, dates, names — not generic encouragement.
- Slightly delightful only when AI does something genuinely useful (e.g., drafts a day).
