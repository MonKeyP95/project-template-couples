# Cartoon theme (design)

## Intent
Partner feedback (TODO backlog, 2026-11-25): a third theme next to Light and Dark that looks **hand-drawn**, with strong basic colours and a Moana-like island feel. No Disney characters, artwork or names. Nothing about layout or features changes; Cartoon is only another option in the theme picker.

Chosen look: **"Storybook island"** (mockup C). Thick ink outlines, hard offset shadows, slightly wobbly card corners, a round friendly font, and a drawn sky / sun / wave / sand scene behind every page.

## Goals / non-goals / anti-goals
- Goal: pick Light, Dark or Cartoon; the choice persists like dark does today and renders server-side with no flash.
- Goal: every page gets the cartoon look with no per-page work.
- Non-goal: a dark version of Cartoon. Cartoon is light-only (`color-scheme: light`).
- Non-goal: layout, copy or feature changes in Cartoon.
- Anti-goal: anything that reads as Disney's look (characters, logos, their artwork).
- Anti-goal: per-component `cartoon:` edits across the 1,145 `border` uses.

## Approaches
1. **Theme-wide CSS block (picked).** A `.cartoon` token block plus a few scoped rules in `globals.css`; the theme cookie becomes three-valued; the layout shows the scene instead of the world map. Blunt: every border thickens, so a few spots may need toning down after an in-app look.
2. Per-component cartoon variants. Exact control, but hundreds of edits across dozens of files. Rejected.
3. Tokens only (colours, shadows, font, scene), no outline change. Cheap but doesn't look drawn. Kept as step 1 of approach 1.

## Design

### Step 1: picker, palette, font, scene
- `src/lib/theme.ts`: `type Theme = "light" | "dark" | "cartoon"` and `getTheme()` replacing `isDarkTheme()`. Unknown or missing cookie = light. The existing `theme=dark|light` cookies keep working.
- Root layout puts the theme's class (`dark` or `cartoon`, none for light) on `<html>`. Pages that pass `initialDark` pass `initialTheme` instead.
- `ThemeToggle` becomes a three-way segmented picker (Light / Dark / Cartoon) in the same two spots (`/home`, `app-nav`). Picking one swaps the class on `<html>` immediately and writes the cookie.
- `globals.css`: `@custom-variant cartoon (&:is(.cartoon *));` and a `.cartoon` block that redefines the same tokens as `:root`/`.dark`:
  - Island palette, roughly: lagoon blue `#1590B5`, sky `#2BB3D6`/`#7ED9E8`, sun `#FFD23F`, coral `#FF8A65`, leaf `#9BE36D`, sand `#FFE9B8`, ink `#172434`. `sea/sand/clay/moss/dusk` + tints are mapped onto these so existing surfaces stay distinguishable.
  - `--border` = ink; `--shadow-sm/md/lg` = hard offset ink shadows (no blur), e.g. `3px 3px 0`, `4px 4px 0`, `5px 5px 0`.
  - `--radius` a bit larger.
- Font: Fredoka via `next/font/google` as `--font-cartoon`. In Cartoon, sans and serif (display) both use it. **My call:** mono (dates, numbers) stays IBM Plex Mono for legibility.
- Scene: a new `CartoonSceneBg` SVG component (sky gradient, sun, wave line, sand) rendered in the layout next to `WorldMapBg`, fixed behind content like the map. CSS shows one or the other (`cartoon:hidden` on the map, `hidden cartoon:block` on the scene), so switching needs no reload.
- The AI accent (DESIGN.md: subtle indigo border on AI content) must remain distinguishable.

### Step 2: drawn outlines
- Scoped rules under `.cartoon` make `border` elements thick (~2.5-3px) and ink-coloured, and give rounded cards slightly uneven corner radii (the wobble).
- Text placed directly on the sky gets an ink text-shadow so it stays readable.
- Afterwards, tone down spots the user finds too heavy (thin dividers, input lines) with targeted exceptions.

### Left to the builder
Exact token values, the scene SVG drawing, which selectors carry the outline/wobble rules, and making the `--font-*` override win over the `next/font` class variables on `<html>`.

## Success criteria

### Verified by Claude
1. `pnpm lint` clean, `tsc` clean, `pnpm build` passes (after each step).
2. `getTheme()` returns `"cartoon"` for cookie `cartoon`, `"dark"` for `dark`, `"light"` for `light`, missing, or anything else.
3. No remaining references to `isDarkTheme` or `initialDark`.
4. Compiled CSS contains the `.cartoon` token block and the cartoon variant rules inside the expected layer (see memory: unlayered `@media` block).

### Verified by the user in-app
Step 1:
1. Home and the menu show a Light / Dark / Cartoon picker; the current theme is highlighted.
2. Picking Cartoon switches instantly: island colours, round font, sky/sun/wave/sand scene behind the page; world map gone.
3. Reload any page: Cartoon is still on, with no flash of Light first.
4. Switching back to Light and Dark looks exactly as before.
5. Phone width: the picker fits; the scene doesn't cover or crowd content.
Step 2:
6. Cards, buttons and inputs have thick ink outlines, hard shadows and slightly wobbly corners.
7. Text sitting directly on the sky is readable.
8. Note any spots that look too heavy; they get toned down in a follow-up.
