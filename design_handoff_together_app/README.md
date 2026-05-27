# Handoff: Together — Hi-fi Design (Phase 3 → 4 surface)

## Overview
This bundle contains the visual + interaction design for **Together**, a couples/families travel-planning app. It covers the full hero journey:

1. **Workspace Home** — greeting, trip card, dream board
2. **Trip Detail** — Lombok hero with an 8-day itinerary
3. **Packing list** — categorised, interactive, AI-suggestion strip
4. **Budget** — total burn, settle-up, ledger
5. **Two desktop surfaces** — wide Trip Dashboard + wide Workspace Home

Sample trip in the mocks: **Lombok, Indonesia · Jun 12 – Jun 20, 2026 · Monkey + Giraf.**

## About the Design Files
The files in this bundle (`index.html`, `mobile-app.jsx`, `desktop-screens.jsx`, `shared.jsx`, `styles.css`) are **design references** created as a React + inline-Babel prototype. They are **not** production code to lift directly.

Your task is to **recreate the visuals and interactions in the existing `project-template-couples` codebase** — Next.js 16 (App Router), Tailwind v4, shadcn/ui, Supabase. Match the look pixel-for-pixel, but build with **Server Components, Server Actions, shadcn primitives, and the existing token system in `src/app/globals.css`** — not by porting the JSX in this bundle.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, and micro-interactions are all final. Implement pixel-perfectly.

## Scope vs. existing repo
- The repo is currently at **Phase 1**: auth + workspace pairing already work.
- These designs land **Phase 3 (Trip + Packing) and parts of Phase 4 (Budget, Itinerary days)** per `docs/PLAN.md`.
- AI suggestion surfaces in the designs (the small moss-bordered cards) are **Phase 5** — render them as visually-correct but stubbed components for now. Don't wire Claude yet.
- Desktop layouts are aspirational; ship mobile-first per `docs/DESIGN.md`. Desktop is a media-query enhancement.

---

## Design system — token mapping

Your existing `src/app/globals.css` already defines OKLCH tokens. The design **removes the pink primary** and rebases around a sand-and-sea palette. Replace the relevant `:root` and `.dark` blocks. New tokens (additive — keep the shadcn variable names):

### Light mode
```css
:root {
  --background:  oklch(0.955 0.012 78);     /* warm sand */
  --foreground:  oklch(0.24 0.02 232);      /* deep ink */
  --card:        oklch(0.985 0.006 78);
  --card-foreground: oklch(0.24 0.02 232);
  --popover:     oklch(0.985 0.006 78);
  --popover-foreground: oklch(0.24 0.02 232);

  /* primary becomes deep sea (was warm pink) */
  --primary:     oklch(0.42 0.08 218);
  --primary-foreground: oklch(0.985 0.006 78);

  --secondary:   oklch(0.93 0.025 210);     /* sea wash */
  --secondary-foreground: oklch(0.24 0.02 232);

  --muted:       oklch(0.93 0.014 78);
  --muted-foreground: oklch(0.42 0.02 232);

  --accent:      oklch(0.93 0.025 210);
  --accent-foreground: oklch(0.24 0.02 232);

  --destructive: oklch(0.60 0.21 25);
  --border:      oklch(0.86 0.014 78);
  --input:       oklch(0.86 0.014 78);
  --ring:        oklch(0.42 0.08 218);

  /* extended palette — surface tints used per page */
  --sea:         oklch(0.42 0.08 218);
  --sea-tint:    oklch(0.93 0.025 210);
  --sand:        oklch(0.74 0.06 70);
  --sand-tint:   oklch(0.93 0.03 75);
  --clay:        oklch(0.58 0.10 48);
  --clay-tint:   oklch(0.93 0.04 60);
  --moss:        oklch(0.50 0.07 152);
  --moss-tint:   oklch(0.93 0.04 150);
  --dusk:        oklch(0.40 0.05 250);
  --dusk-tint:   oklch(0.92 0.022 245);

  --rule:        oklch(0.74 0.018 78);      /* hairlines */

  --radius: 0.625rem;
}
```

### Dark mode
```css
.dark {
  --background:  oklch(0.18 0.022 230);
  --foreground:  oklch(0.95 0.012 78);
  --card:        oklch(0.225 0.022 232);
  --card-foreground: oklch(0.95 0.012 78);
  --popover:     oklch(0.225 0.022 232);
  --popover-foreground: oklch(0.95 0.012 78);

  --primary:     oklch(0.72 0.08 200);      /* sea foam */
  --primary-foreground: oklch(0.18 0.022 230);

  --secondary:   oklch(0.28 0.03 218);
  --secondary-foreground: oklch(0.95 0.012 78);

  --muted:       oklch(0.28 0.022 230);
  --muted-foreground: oklch(0.78 0.018 78);

  --accent:      oklch(0.28 0.03 218);
  --accent-foreground: oklch(0.95 0.012 78);

  --destructive: oklch(0.65 0.20 25);
  --border:      oklch(0.32 0.022 230);
  --input:       oklch(0.32 0.022 230);
  --ring:        oklch(0.72 0.08 200);

  --sea: oklch(0.72 0.08 200);   --sea-tint:  oklch(0.28 0.03 218);
  --sand:oklch(0.74 0.07 70);    --sand-tint: oklch(0.28 0.022 60);
  --clay:oklch(0.70 0.09 50);    --clay-tint: oklch(0.28 0.025 50);
  --moss:oklch(0.72 0.08 155);   --moss-tint: oklch(0.26 0.025 155);
  --dusk:oklch(0.68 0.06 250);   --dusk-tint: oklch(0.27 0.022 245);

  --rule: oklch(0.42 0.022 230);
}
```

Then expose them to Tailwind v4 in `@theme inline` exactly the same way the shadcn vars are exposed today, e.g.:
```css
--color-sea: var(--sea);
--color-sea-tint: var(--sea-tint);
/* …and so on for sand/clay/moss/dusk and their tints */
--color-rule: var(--rule);
```

So Tailwind classes like `bg-sea`, `text-sea`, `border-sea-tint`, `text-rule` become available.

### Typography
Replace whatever's currently in `layout.tsx` with these three fonts (already used in the design):

```ts
import { Instrument_Serif, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

const serif = Instrument_Serif({ subsets: ["latin"], weight: ["400"], style: ["normal","italic"], variable: "--font-serif" });
const sans  = IBM_Plex_Sans({ subsets: ["latin"], weight: ["300","400","500","600"], variable: "--font-sans" });
const mono  = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400","500","600"], variable: "--font-mono" });
```

Use them via the existing `--font-sans / --font-serif / --font-mono` CSS variables already wired in `@theme inline`. The display face is **Instrument Serif** (italic for names), the body is **IBM Plex Sans**, and the labels/numbers are **IBM Plex Mono**.

### Type recipes (extract into utility classes or component variants)
| Recipe | Style |
|---|---|
| `t-display` | `font-serif`, `font-weight: 400`, `letter-spacing: -0.02em`, `line-height: 0.95` |
| `t-display em` / italic name | same + `font-style: italic` |
| `t-label` (the mono uppercase tag) | `font-mono`, `10px`, `letter-spacing: 0.22em`, `text-transform: uppercase`, `color: var(--muted-foreground)` |
| `t-mono` | `font-mono`, `font-variant-numeric: tabular-nums` |
| `t-num` | `font-mono`, `tabular-nums`, `letter-spacing: -0.01em` |

### Spacing / radius
- Card radius: **10–14px** (`rounded-[10px]` → `rounded-2xl` per shadcn). The big trip hero card uses `14px`.
- Pills & badges: `999px`.
- Hairline border everywhere: `1px solid var(--border)`.
- Section padding mobile: `20px` horizontal. Desktop: `44–60px`.

### Shadows
- `--shadow-sm`: `0 1px 1px rgba(40,40,60,0.04), 0 1px 2px rgba(40,40,60,0.04)`
- `--shadow-md`: `0 2px 4px rgba(40,40,60,0.05), 0 8px 24px rgba(40,40,60,0.06)`
- `--shadow-lg`: `0 4px 8px rgba(40,40,60,0.06), 0 24px 48px rgba(40,40,60,0.08)`

Dark mode shadows are roughly 8× stronger (see `styles.css`).

---

## Screens

### Screen 1 — Workspace Home (mobile)
**Route:** `/home` (replaces the existing stub in `src/app/home/page.tsx`)
**Purpose:** Landing for an authed user. Lists active workspace, current trips, dream destinations.

**Layout (top to bottom):**
1. **Top bar** — `flex justify-between items-center`, `mb-14`. Left: `<Label>Together · Workspace</Label>`. Right: paired-avatar (overlapping M + G initials).
2. **Greeting block**
   - Date label (mono `05 / 26 · Tuesday`)
   - `h1.t-display`, 58px, `Hello, <em>Monkey</em>.`
   - 1px hairline rule
   - Sub-row: `Monkey & Giraf` (names italic serif) on the left, `est. 2024 · 2 members` coordinate on the right.
3. **"Upcoming · 1"** section
   - Section header: label left, `17 days` right (mono, muted).
   - One big trip card (clickable, navigates to `/trips/lombok`):
     - 132px tall header strip, `bg: var(--sea-tint)`, with the topographic ring pattern at 16% opacity.
     - Top row inside: `<MonoBadge tone="sea">Surf · Dive · Trek</MonoBadge>` left, `<Coord>8.7° S · 116.3° E</Coord>` right.
     - Bottom row inside: `<em>Lombok</em>` in 38px Instrument Serif, with `INDONESIA` mono caption below.
     - Below the strip, a 12px-padded meta row: `JUN 12 — JUN 20` over `8 days · 2 travellers` on the left; paired avatar + chevron on the right.
4. **"Dream board · 4"** section — 2×2 grid of square cards. Each card has a `var(--{tone}-tint)` background with the topo pattern, a `// dream` label, the place name in serif italic, and coordinates in mono.
5. **"+ new trip"** dashed-border CTA, full-width, 14px padding, mono uppercase copy.

### Screen 2 — Trip Detail (mobile)
**Route:** `/trips/[slug]` — slug here is `lombok`.
**Purpose:** Trip hero + bottom-tab navigation between Itinerary / Packing / Budget.

**Layout:**
- **Header strip** — `bg: var(--sea-tint)`, `var(--sea)` topographic pattern at 18% opacity. Contains:
  - Back chevron (mono "back" label), right side label "Trip · 02 of 02".
  - Coordinate, then `<em>Lombok</em>` (64px Instrument Serif), `INDONESIA` caption.
  - Footer row: `JUN 12 — JUN 20` (mono) left; paired avatar right.
- **Weather strip** — 7 day chips in a row with hairline separators. Each chip: mono day code, a colored dot for the weather glyph (sun/haze/rain → sand/sea-2/sea), then `27°` in mono. Active day has `bg: var(--card)`.
- **Tab content** (default Itinerary — see below).
- **Bottom nav bar** — floating pill 16px from each edge. Three pill tabs (Itinerary / Packing / Budget). Active tab = `bg: var(--foreground)`, `text: var(--background)`. Inactive = transparent, muted text. Mono uppercase 10px.

**Itinerary content:**
Vertical timeline. Each day = a 2-column row:
- Left column (~36px): mono `DAY`, then big day number (22px), then weekday code (`SAT`). Hairline vertical 1px line connects to the next day.
- Right column: card with `border-left: 3px solid var(--{tone})` where tone matches the activity (SURF → sea, DIVE → sea, TREK → moss, TRANSIT → clay, ARRIVE/DEPART → sand). Inside: mono badge with the tag, date right-aligned, then a 22px serif title and 1–2 lines of body copy.

**Itinerary data — use exactly:**
```
01 · Sat · Jun 12 · Land in Mataram · Pickup → south to Kuta. Sunset at Mandalika. · ARRIVE · sand
02 · Sun · Jun 13 · Selong Belanak · Long lefts. Lunch at the warung. Mawi at golden. · SURF · sea
03 · Mon · Jun 14 · Gili Trawangan · Ferry 09:00. Refresher dive + snorkel turtles. · DIVE · sea
04 · Tue · Jun 15 · Gili Meno · slow · Hammock day. Sunset dive 17:00. · DIVE · sea
05 · Wed · Jun 16 · Senaru gateway · Return to Lombok. Drive to Senaru. Pre-trek brief. · TRANSIT · clay
06 · Thu · Jun 17 · Rinjani · ascent · Sembalun route. Camp at 2,639m. Cold night. · TREK · moss
07 · Fri · Jun 18 · Rinjani · summit · 02:30 push. 3,726m. Descent to crater lake. · TREK · moss
08 · Sat · Jun 19 · Slow morning + fly · Hot springs, drive south, evening flight. · DEPART · sand
```

### Screen 3 — Packing list (mobile, tab inside trip)
**Surface tint:** `bg: var(--clay-tint)` on the header, then content reverts to `var(--background)`.
**Header:** Label "Packing", giant `t-display` ratio `12/28` (done count over total), with the second number muted. Right: `17 days out` coord + `% ready` line. Then a `<Bar tone="clay" pct={...}/>`.
**Categories** (with item counts): `Surf kit · Dive kit · Trek · Everyday · Documents`. Each item is a `<CheckRow>`:
- 16×16 rounded square checkbox. Empty: 1.5px `var(--rule)` border. Checked: filled `var(--clay)` with white check inside (16ms-ish pop animation).
- Label text — strikes through with a hairline when checked (`checked-line` keyframe in `styles.css`).
- Right: 18px avatar of who added it (M → sea border, G → clay border).
**`+ add item`** mono CTA at the bottom of each category.
**AI suggestion** at the very bottom: white card with `border-left: 3px solid var(--moss)`, mono moss label `/ suggested for Rinjani`, then italic-mixed-with-roman body copy. Never use sparkle icons.

### Screen 4 — Budget (mobile, tab inside trip)
**Surface tint:** `bg: var(--dusk-tint)` for the header strip.
**Header:** Mono label "Budget · Lombok", then big `€1,247 / €2,800` reading where `€` is muted and the number is `t-num`. Bar below, two captions (`% of planned`, `€ left`).
**Settle-up card:** White card, `flex justify-between`. Left: label, then `<em>Giraf</em> owes <em>Monkey</em> €X.XX`. Right: black mono "settle" pill button → on click flips to "All square." (italic moss) with an "undo" outline button.
**Split breakdown:** 2-column grid of person cards: avatar + italic name, mono "paid" label, big number.
**Ledger:** List of expenses. Each row: 3-column grid `44px | 1fr | auto`:
- Col 1: 2-line date (`JUN` muted small, `12` larger).
- Col 2: title, then a row of `<MonoBadge>` (category, tinted), `paid by` (mono), 16px avatar.
- Col 3: amount in `t-num`.
- Rows separated by 1px `var(--border)` hairlines.
**`+ log expense`** CTA strip at the bottom.

**Sample data — use exactly:**
| date | title | who | amt | category |
|---|---|---|---|---|
| JUN 12 | Surfboard rental · 8d | M | 96.00 | Surf |
| JUN 14 | Ferry · Bangsal → Gili Trawangan | G | 24.40 | Transit |
| JUN 14 | Padi refresher dive | M | 78.00 | Dive |
| JUN 13 | Warung dinner · Selong | G | 18.20 | Food |
| JUN 12 | Scooter rental · 4d | M | 42.00 | Transit |
| JUN 16 | Rinjani trek permit | G | 88.00 | Trek |
| JUN 13 | Beach grill · Mawi | M | 32.50 | Food |

### Screen 5 — Desktop Trip Dashboard
**Route:** `/trips/[slug]` rendered at `≥ lg` viewport.
**Layout:** Three columns — fixed left rail (220px) + center (fluid) + fixed right rail (280px).
- **Left rail:** workspace logo, big "Monkey & Giraf" lockup, "Navigate" nav list (Home / Trips / Dream board / Notes / People — active item has `bg: var(--sea-tint)` and a chevron), bottom "Members" block with live presence badges.
- **Center:** giant hero (`<em>Lombok</em>` at 96px serif), meta row (country · dates · coords separated by 4px dots), action buttons (`+ event` black mono pill, `share` outline). Tabs row underneath (Itinerary / Packing / Budget / Notes / Map — active gets a 2px ink underline). Itinerary timeline below, but with larger day-blocks (38px serif weekday); two-column main grid pairs the timeline with a side stack containing a faux region map (square, `sea-tint` bg with topo pattern + colored pins) and an AI assistant card.
- **Right rail:** "Pre-trip" progress trio (Packing / Budget / Booked, each with a bar), "Weather · 7 day" mini grid, "Activity" feed.

### Screen 6 — Desktop Workspace Home
**Route:** `/home` at `≥ lg`.
- Top: huge "Hello, <em>Monkey</em>." (80px serif) left, date + paired avatar right.
- Hairline rule.
- Stat row: `03 Trips`, `17 Days away in 2026`, `04 Dream places`, then `● Giraf editing Day 03` aligned right in sea.
- 3-column trip card grid: Lombok (upcoming, sea), Andalucía (past, clay), Faroe Islands (past, moss).
- 4-tile dream board grid + a dashed `+ pin a dream` slot.

---

## Interactions & Behavior

**Navigation**
- Home trip card → `/trips/lombok`.
- Bottom nav inside a trip swaps between `?tab=itinerary|packing|budget` (or use URL segments — your call; the design assumes no full page reload).
- Back chevron → `/home`.

**Packing list**
- Tapping a row toggles `done`. On toggle, the box fills (`scale 0.6 → 1` over 180ms, ease-out) and the label gets a strike-through hairline that draws left-to-right over 220ms.
- Optimistic update + persist via Supabase. Real-time subscribe so the partner's checks appear without refresh (Phase 3 acceptance criterion).

**Budget**
- "Settle" button flips the settle-up card into the "All square" state. In real implementation, this would create a balancing transfer row, not just toggle UI.
- Sums (`total`, `mPaid`, `gPaid`, `balance = (mPaid - gPaid) / 2`) computed from the expenses array. Display `Giraf owes Monkey` when balance > 0, swap names when < 0.

**Itinerary**
- Each day card is tappable (placeholder for `/trips/lombok/day/03`).
- Drag-to-reorder is out of scope for first cut.

**Light/dark**
- Implement a `data-theme="dark"` toggle on `<html>` driven by your existing dark-mode hook. All tokens already switch automatically.

**Loading states**
- Replace text content with a `bg-muted` block of identical bounding box. Don't use a spinner.

**Error states**
- Inline below the form field, mono uppercase 10px, `text-destructive`.

---

## Components to extract (mirror the prototype's primitives in `shared.jsx`)

Build these as proper components under `src/components/together/` so they're reusable across screens:

| Component | Props | Notes |
|---|---|---|
| `Label` | `children`, `className` | The mono uppercase tag (`t-label` recipe). |
| `Coord` | `children` | Mono caption for coordinates / metadata. |
| `Avatar` | `name`, `size=22`, `tone="sea"\|"clay"\|"moss"\|"ink"` | Initial inside a circular outlined chip. Tone controls border+text color. |
| `PairAvatar` | `a="M"`, `b="G"`, `size=22` | Two avatars overlapping (-6px margin). The "ours" mark — use this anywhere shared ownership is shown. |
| `MonoBadge` | `tone`, `children` | 1px outline + mono uppercase 9px. The activity tag. |
| `Bar` | `pct`, `tone` | 4px tall, 99px radius, transitions width over 350ms. |
| `CheckRow` | `done`, `label`, `who`, `onToggle`, `tone` | Used in packing. |
| `DayChip` | `d`, `t`, `glyph`, `active` | The weather strip cell. |
| `Chevron` | `dir`, `size`, `color` | Tiny SVG arrow. |
| `TopoBg` | `tone`, `opacity` | Decorative concentric-ring SVG pattern used inside hero cards. **Always absolutely positioned, never fills viewport.** |
| `WaveGlyph` | `color`, `w`, `h` | Decorative sine wave used in the Lombok hero. |

For shadcn primitives (`Button`, `Card`, `Tabs`, `Progress`) extend the existing components — don't replace them. Use the established `buttonVariants(...)` pattern (no `asChild` prop, per `CLAUDE.md`).

---

## State management
Follow the repo's principle of **server-first**:
- Trip, packing items, expenses → server-component fetches via `createClient` from `@/lib/supabase/server`.
- Toggling a packing item or adding an expense → **Server Action** in `src/lib/trips/actions.ts`, with `revalidatePath` of the trip route.
- Realtime presence (`Giraf is editing Day 03`) → client component subscribed to a Supabase Realtime channel; gate behind a `<ClientPresence />` boundary.

Suggested table shape (you'll write the migration):
```
trips                (id, workspace_id, slug, name, country, start_date, end_date, lat, lng, created_by, created_at)
trip_members         (trip_id, user_id, role)
packing_items        (id, trip_id, category, label, done, added_by, created_at)
expenses             (id, trip_id, title, amount_cents, currency, paid_by, category, day_date, created_at)
itinerary_days       (id, trip_id, day_index, dow, date, title, body, tag, tone)
```
All RLS-locked to `workspace_members.user_id = auth.uid()` via the trip's workspace.

---

## Assets
- **No real photos.** All "imagery" in the design is a striped/topo placeholder. Keep it that way until the user supplies their own — it is part of the aesthetic.
- **Icons:** Tiny inline SVGs only (chevron, checkmark, wave). Don't pull a lucide-react icon set unless you replace existing usage one-for-one.
- **No emoji.** Per `CLAUDE.md`.

## Files in this bundle
- `index.html` — the canvas that loads everything. Open in a browser to see the prototype.
- `mobile-app.jsx` — all four mobile screens + the data arrays (use these as exact content fixtures).
- `desktop-screens.jsx` — both desktop screens.
- `shared.jsx` — the design-system primitives listed above.
- `styles.css` — token definitions + type recipes + the keyframes (`pop`, `line-in`, `reveal-up`).
- `tweaks-panel.jsx`, `design-canvas.jsx`, `ios-frame.jsx`, `browser-window.jsx` — preview-scaffolding only. **Ignore in your implementation.**

## Suggested implementation order
1. Token migration: update `src/app/globals.css` and `layout.tsx` fonts. Verify existing pages (Home stub, signin, signup) still render — pink should be gone everywhere.
2. Build the primitives under `src/components/together/` (Label, Coord, Avatar, PairAvatar, MonoBadge, Bar, Chevron, TopoBg).
3. Redesign `/home` (mobile-first) — workspace greeting + trip card + dream board.
4. Add `/trips/[slug]` route. Static trip data (hard-coded to Lombok) so you can ship the visuals before the schema.
5. Add `trips` + `trip_members` migrations with RLS. Switch the route to read live.
6. Add `packing_items` migration. Build the Packing tab with a Server Action toggle + Realtime subscription.
7. Add `expenses` migration. Build Budget tab + settle-up Server Action.
8. Add itinerary days table + the timeline view.
9. Desktop breakpoint pass.
10. Pre-AI: wire the moss-bordered suggestion card as a stub component that takes static copy. Phase 5 will replace its data source with Claude.

Update `docs/TODO.md` and append a row to `docs/DECISIONS.md` for the token change ("dropped pink primary → sea, sand-and-sea palette per design 2026-05").
