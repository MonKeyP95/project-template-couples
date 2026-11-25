# Cartoon Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third theme, Cartoon ("Storybook island"), beside Light and Dark.

**Architecture:** The theme cookie becomes `light | dark | cartoon`; the root layout puts `dark` or `cartoon` on `<html>`. Cartoon is a `.cartoon` token block in `globals.css` plus a `cartoon:` custom variant, a Fredoka font variable, and a fixed SVG scene that replaces the world map via CSS. Step 2 adds scoped outline/wobble rules.

**Tech Stack:** Next.js 16 App Router, Tailwind v4, `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-11-25-cartoon-theme-design.md`

## Global Constraints

- No tests exist in this repo; verification is `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` (ask the user to stop `pnpm dev` before building).
- Cartoon is light-only: `color-scheme: light`, never combined with `.dark`.
- No Disney characters, artwork or names anywhere (including SVG ids and comments).
- Client components must not import `src/lib/theme.ts` (it imports `next/headers`); share the type via `src/lib/theme-types.ts`.
- No emojis; sparse comments.

## Review Focus

1. Existing cookie `theme=dark` / `theme=light` must keep rendering Dark / Light.
2. Garbage cookie value renders Light.
3. Switching Cartoon -> Dark must remove `cartoon` (never both classes on `<html>`).
4. Cartoon font override must beat the `next/font` class variables on `<html>` (specificity).
5. The `.cartoon` rules must compile inside a layer or after `:root`, not lose to `:root` tokens (see memory: unlayered `@media` block).

---

## Step 1

### Task 1: Three-valued theme + picker

**Files:**
- Create: `src/lib/theme-types.ts`
- Modify: `src/lib/theme.ts`, `src/app/layout.tsx`, `src/components/theme-toggle.tsx`, `src/components/app-nav.tsx`, and every page that calls `isDarkTheme` (`home`, `trips/[slug]`, `on-the-road`, `profile`, `checklists`, `checklists/[slug]`, `manual`)

**Interfaces:**
- Produces: `type Theme = "light" | "dark" | "cartoon"`, `THEME_COOKIE = "theme"`, `parseTheme(value: string | undefined): Theme` in `theme-types.ts`; `getTheme(): Promise<Theme>` in `theme.ts`; `ThemeToggle({ initialTheme }: { initialTheme: Theme })`; `LeftRail` prop `initialTheme: Theme`.

- [ ] `parseTheme`: `"dark"` -> dark, `"cartoon"` -> cartoon, anything else (incl. `"light"`, undefined) -> light.
- [ ] `getTheme()` replaces `isDarkTheme()`; delete `isDarkTheme`.
- [ ] Layout: append `" dark"` / `" cartoon"` to the `<html>` className; light adds nothing.
- [ ] `ThemeToggle` -> three-button segmented control (Light / Dark / Cartoon), `role="radiogroup"`, each `role="radio"` + `aria-checked`. On pick: remove `dark` and `cartoon` from `<html>`, add the picked class unless light, write cookie (same max-age/samesite as today). Fits phone width (small text, `bg-sea` on the selected pill).
- [ ] Rename `initialDark` -> `initialTheme` through `app-nav` and all pages.
- [ ] Verify: `grep -r "isDarkTheme\|initialDark" src` returns nothing; lint + tsc clean.
- [ ] Commit `feat: three-way theme picker (light/dark/cartoon)`.

### Task 2: Cartoon tokens + font

**Files:** Modify `src/app/globals.css`, `src/app/layout.tsx`

- [ ] Layout: load `Fredoka` (`variable: "--font-cartoon"`, weights 400/500/600/700, latin, swap); add `cartoon.variable` to `<html>`.
- [ ] `globals.css`: `@custom-variant cartoon (&:is(.cartoon *));` next to the dark variant.
- [ ] After the `.dark` block, a `.cartoon` block redefining every token `:root` defines. Palette from spec: ink `#172434` (foreground, border, input, ring-ish), lagoon `#1590B5` (primary, sea, ring, chart-1), sky `#2BB3D6`/`#7ED9E8` (sea-2, secondary/accent tints), sun `#FFD23F` (sand), coral `#FF8A65` (clay), leaf `#9BE36D`/a deeper green for `moss` text use, dusk a bright violet-blue; each `*-tint` a pale wash of its colour; background sand `#FFF4D6`; card white. `--shadow-sm/md/lg`: `3px 3px 0`, `4px 4px 0`, `5px 5px 0` in ink. `--radius: 0.875rem`. `color-scheme: light`.
- [ ] `html.cartoon { --font-sans: var(--font-cartoon); --font-serif: var(--font-cartoon); }` (two-part selector beats next/font's single class). Mono unchanged.
- [ ] Verify lint + tsc; after build, grep the compiled CSS in `.next` for `.cartoon` and `--font-cartoon`.
- [ ] Commit `feat: cartoon theme tokens and font`.

### Task 3: Island scene backdrop

**Files:** Create `src/components/together/cartoon-scene-bg.tsx` (export from `src/components/together/index.ts`); modify `src/app/layout.tsx`

**Interfaces:** `CartoonSceneBg({ className }: { className?: string })`, `aria-hidden`, pointer-events none.

- [ ] SVG, `preserveAspectRatio="xMidYMin slice"`: sky gradient (top ~40%), ink-outlined sun top-right, a wavy lagoon band with ink stroke, sand below. Hard-coded colours from the palette (theme-specific art).
- [ ] Layout: `WorldMapBg` gets `cartoon:hidden`; render `<CartoonSceneBg className="fixed inset-0 -z-10 hidden cartoon:block" />`.
- [ ] Verify lint + tsc + `pnpm build` (user stops dev first).
- [ ] Commit `feat: cartoon island scene backdrop`.

**Stop: user runs step-1 in-app checks 1-5 from the spec.**

## Step 2

### Task 4: Drawn outlines + wobble

**Files:** Modify `src/app/globals.css`

- [ ] Inside an `@layer` that beats utilities only where needed (check compiled order): `.cartoon .border { border-width: 2.5px; }` (border colour already ink via token), `.cartoon .rounded-xl.border, .cartoon .rounded-2xl.border, .cartoon .rounded-lg.border` uneven radii (e.g. `18px 22px 16px 24px`). Inputs/buttons keep even radii.
- [ ] Text directly on the sky: give the page title recipe (`.t-display`) an ink text-shadow only where it sits on the scene; decide selector after looking at which headings lack a card behind them.
- [ ] Verify lint + build; compiled CSS check.
- [ ] Commit `feat: cartoon drawn outlines`.
- [ ] Update `docs/TODO.md` (implemented, unverified in-app) and add a `docs/DECISIONS.md` row (theme-wide CSS over per-component variants).
