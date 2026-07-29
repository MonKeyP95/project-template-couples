# Flip-clock trip countdown — design

**Date:** 2026-07-29
**Status:** approved, not implemented

## Goal

Replace the tiny mono text countdown (`12D 5H 30M TO GO`) with a split-flap
flip-clock block: a row of tiles with unit labels below. Reference is a classic
airport/departure-board flip clock, translated into the sand-and-sea palette
rather than copied literally.

Proportions were chosen from a rendered comparison of three options, built with
the project's real IBM Plex Mono and real palette:
<https://claude.ai/code/artifact/dc6880c6-93ff-4a4d-ad0c-a32067a00614>
(option C). That page also carries a working flip and a live digit-nudge slider,
and is the reference for how the motion should feel.

## Current state

One component, `src/components/trip-countdown.tsx`, used in three places:

| Where | Today |
|---|---|
| `src/app/home/trip-cards.tsx:147` (HeroCard) | `12D 5H 30M TO GO`, inline beside the trip name |
| `src/app/home/trip-cards.tsx:220` (TripCard) | `12 DAYS TO GO` (`daysOnly`) |
| `src/app/trips/[slug]/page.tsx:453` (header) | `12D 5H 30M TO GO`, inline beside the date range |

## Decisions

| Decision | Choice |
|---|---|
| Placement | Trip page (`lg`) **and** home hero (`sm`). Small trip cards keep the plain text. |
| Style | Translated to sand-and-sea, not literal white/black |
| Motion | Real split-flap flip on digit change |
| Units | **Adaptive**: months tile only when months > 0; never fewer than 3 tiles |
| Labels | Below the tiles |
| Heading | **None.** The unit labels carry it |
| Proportion | Wide tile, undistorted digits, with breathing room (~1.26:1) |
| Once the trip starts | Block disappears (matches current behaviour) |

## Units rule

- `months > 0` → 4 tiles: `MON · DAYS · HRS · MIN`
- `months = 0` → 3 tiles: `DAYS · HRS · MIN`, even when days is `00`

At the one-month mark the months tile plainly unmounts and the row re-centers on
three tiles. No exit animation — it happens once per trip and is not worth the
machinery.

## Components

### `src/lib/countdown.ts` (new)

Pure, no React. Verifiable by direct call.

```ts
type Remaining = { months: number; days: number; hours: number; minutes: number }

function remainingUnits(startDate: string, now: Date): Remaining | null
```

- `startDate` is the `YYYY-MM-DD` trip start; target is **local midnight** of that day.
- Returns `null` once the target has passed (trip underway or over), which is what
  makes the block disappear.
- Months are **real calendar months**, not 30-day approximations: step whole months
  from `now` toward the target while the stepped date stays `<= target`, clamping
  overflow (31 Jan + 1 month = 28 Feb). The leftover milliseconds split into
  days / hours / minutes.
- Months are counted from `now`, including its time of day, so the total is exact
  and the hours/minutes tiles are never fiction. A consequence: viewed at midday,
  a target two calendar months out at midnight reads as `1 MON 30 DAYS 12 HRS`,
  not `2 MON` — two whole months from midday lands half a day past a midnight
  target. This is correct and is the price of exactness; anchoring months to
  today's midnight instead would make the months tile match mental arithmetic but
  overstate the total by up to a day.

### `src/components/flip-countdown.tsx` (new)

```tsx
<FlipCountdown startDate={...} size="lg" | "sm" />
```

- `"use client"`. Ticks every 1s so the minute flip lands on the boundary.
- State only updates when a rendered digit actually changes (compare the derived
  tuple, return `prev` if equal) — no per-second re-render.
- Renders `null` when `remainingUnits` returns `null`.
- No heading. `lg` and `sm` differ only in tile dimensions.

### `src/components/trip-countdown.tsx` (edit)

Keeps the plain-text component for `TripCard`. Its inline date math moves out to
`src/lib/countdown.ts` so there is one implementation.

## The tile

No heading above the row — the unit labels carry it.

```
┌───────────────┐  bg-card, border border-border, rounded-[8px], shadow-sm
│               │  top half, exactly 50% of tile height
│  ┌─┐   ┌──┐   │
│  │ │     ─┤   │
├──┤ ├─────┤ ├──┤  hinge: 1px clay/25 line at top:50%, over the tile
│  │ │     ─┤   │
│  └─┘   └──┘   │
│               │  bottom half, exactly 50%
└───────────────┘
      MON          t-label (mono, 10px, 0.22em, muted-foreground)
```

**The digit is centered across the whole tile and the hinge bisects it.** Both
halves render the *same* glyph box, sized to the full tile:

- The glyph box is exactly the tile size: `height: H`, `line-height: H`,
  `text-align: center`. The digit is therefore centered in the full tile, not in
  either half.
- Top half: a `H/2`-tall window, `overflow: hidden`, containing that box at
  offset 0.
- Bottom half: an identical `H/2`-tall window containing the *same* box
  translated up by exactly `H/2`.

Two windows onto one centered glyph. The digit is continuous across the seam by
construction — there is no second value to keep aligned.

**The halves must be exactly equal.** The hinge is an absolutely positioned 1px
line at `top: 50%` drawn *over* the tile, never a border on either half. A border
would make the top half 1px taller than the bottom and pull the seam off the
digit's center. Both halves are `height: 50%` of the tile with no padding, margin,
or border of their own.

**Optical centering.** A line box is centered on the font's em box, which includes
descender space, so a digit's *cap* center can sit slightly above the geometric
middle. A `--digit-nudge` offset shifts the glyph box so the seam crosses the
optical middle of the numerals. The same nudge applies to both halves, so the
digit stays continuous whatever its value.

**Default is `0px`.** It was left at 0 in the rendered comparison and looked
correct at option C's proportions. It is a tuning knob, not a fixed value — if the
seam reads high or low in the running app, adjust it there.

Digits use `t-num` (mono, tabular) so the two characters never shift width
mid-flip. Values are zero-padded to two characters.

### Sizes

Chosen from the rendered comparison (option C). Two IBM Plex Mono digits are
~1.2x the font-size wide and cap-height is ~0.7x the font-size, so font-size
follows from tile width; tile height is then set so the cap spans ~67% of it —
digits that read as full without pressing against the edges.

| | Tile (w x h) | Font-size | Cap spans | Half | Gap |
|---|---|---|---|---|---|
| `lg` desktop | 96 x 76px | 73px | 51px (67%) | 38px | 8px |
| `lg` mobile | 74 x 58px | 56px | 39px (67%) | 29px | 6px |
| `sm` | 36 x 26px | 25px | 18px (67%) | 13px | 4px |

`sm` sits beside the trip name on the home cards, so its tile height is set just
under the name's cap height (~27px at the hero's 38px display serif). A taller
tile makes the clock read as the louder of the two, which it should not be.

Digits are **not** condensed — `scaleX` stays 1 and the numerals keep the shapes
the type designer drew. That is what forces the landscape tile rather than the
square one in the reference image, which only gets a square tile by using a
condensed face.

`lg` is responsive: four 96px tiles plus gaps is 408px, fine on desktop but well
over a phone. At the mobile size the row measures 314px against the 343px
available on a 375px viewport with 16px page padding. `sm` at 4 tiles is 191px.

## The flip

Four stacked layers per tile:

1. static top — **new** value, upper clip
2. static bottom — **old** value, lower clip
3. folding leaf — **old** value, upper clip, `rotateX(0 -> -90deg)`, origin bottom
4. unfolding leaf — **new** value, lower clip, `rotateX(90deg -> 0)`, origin top

Two ~300ms phases, phase 2 starting as phase 1 ends. `transform-style: preserve-3d`
on the tile, `backface-visibility: hidden` on the leaves.

`prefers-reduced-motion: reduce` skips both leaves and swaps straight to the new
digit.

## Placement detail

On the home hero the image area is only 132px tall and the trip name occupies the
bottom of it, so a 4-tile row cannot sit inline beside the name where the current
countdown does. The `sm` row goes in the card's **lower white section**,
left-aligned above the date-range line. The inline text countdown there is removed.

On the trip page the `lg` block sits in the header, under the date range, replacing
the inline `TripCountdown`.

## Out of scope

- Seconds. The fastest visible flip is once a minute.
- Any countdown behaviour during or after the trip.
- Changes to `TripCard` (small cards) beyond leaving them as they are.

## Success criteria

### Verified by Claude

1. `pnpm build` passes and `pnpm lint` is clean.
2. `remainingUnits("2026-09-29", 29 Jul 2026 00:00)` returns exactly
   `{months: 2, days: 0, hours: 0}`.
3. `remainingUnits` returns `months: 0` for any target under one calendar month away.
4. `remainingUnits` returns `null` for a start date of today and for any past date.
5. Month stepping clamps overflow: from 31 January, one month forward is 28/29
   February, not 2/3 March.
6. `FlipCountdown` renders 4 tiles when `months > 0` and exactly 3 when `months = 0`.
7. Digit strings are zero-padded to two characters at every unit.
8. `TripCard` still renders the plain-text `TripCountdown`.

### Verified by the user in-app

1. Trip page: the block appears under the date range, with no heading above it, and
   the numbers are correct for a real trip.
2. The digits read as large and full within the tile — a clear margin top and
   bottom, but nothing like a small digit lost in space.
3. The hinge crosses the *optical middle* of the numerals, and the two halves are
   visibly equal. Nothing about the seam looks a pixel high or low.
4. Leaving the page open across a minute boundary shows the minutes tile physically
   flip, and the tear runs through the middle of the digit.
5. Home hero: the compact tile row sits in the lower section above the date range,
   and does not crowd or overflow the card on a phone viewport.
6. Mobile viewport: 4 tiles fit on one line without wrapping at `sm`, and the `lg`
   block fits within the trip page column.
7. Both light and dark mode read correctly — tile, hinge, and labels all legible.
8. A trip under a month away shows 3 tiles, and one over a month shows 4.
9. A trip that has already started shows no block at all.
