# Flip-Clock Trip Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline mono-text trip countdown with a split-flap flip-clock tile block on the trip page and the home hero card.

**Architecture:** Three pieces. A pure date module (`src/lib/countdown.ts`) does all the calendar math with no React. A client component (`src/components/flip-countdown.tsx`) ticks every second and renders one `FlipTile` per unit. The 3D flip itself is real CSS in `globals.css` — keyframes and `rotateX` cannot be expressed as Tailwind utilities, and the existing file already holds the project's type recipes, so it is the established home for this kind of rule.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-29-flip-countdown-design.md`
**Visual reference:** <https://claude.ai/code/artifact/dc6880c6-93ff-4a4d-ad0c-a32067a00614> (option C)

## Global Constraints

- No test framework exists in this repo. Do **not** add one and do not invent a test command. Verification is `pnpm build`, `pnpm lint`, and — for the pure module only — a throwaway Node script run from the scratchpad.
- Never say "works" or "verified" for anything behind the UI. Report "implemented; build and lint clean; unverified in app".
- No emojis in code, logs, or output.
- Dates display day-before-month; this feature renders only numerals and unit labels, so no locale formatting is involved.
- No defensive code. No abstractions for hypothetical needs.
- Tile geometry, verbatim from the spec:

| | Tile (w x h) | Font-size | Gap |
|---|---|---|---|
| `lg` desktop (>= 768px) | 96 x 76px | 73px | 8px |
| `lg` mobile | 74 x 58px | 56px | 6px |
| `sm` | 44 x 34px | 33px | 5px |

- Digits are **not** condensed. `scaleX` stays 1.
- `--flip-nudge` defaults to `0px`.
- No heading above the tile row.

---

### Task 1: The date math

**Files:**
- Create: `src/lib/countdown.ts`
- Verify with: `<scratchpad>/check-countdown.mjs` (throwaway, not committed)

**Interfaces:**
- Produces: `type Remaining = { months, days, hours, minutes }`, `remainingUnits(startDate: string, now: Date): Remaining | null`, `localMidnight(date: string): Date`

- [ ] **Step 1: Write the module**

```ts
export type Remaining = {
  months: number
  days: number
  hours: number
  minutes: number
}

/** Local midnight of a YYYY-MM-DD date string. */
export function localMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** `base` advanced by `n` calendar months, clamped to the last day of the
 *  target month so 31 Jan + 1 month is 28 Feb, not 3 Mar. */
function addMonths(base: Date, n: number): Date {
  const d = new Date(base)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

/** Time from `now` until local midnight of `startDate`, split into whole
 *  calendar months plus the leftover days / hours / minutes. Null once that
 *  moment has passed, which is what makes the countdown disappear. */
export function remainingUnits(startDate: string, now: Date): Remaining | null {
  const target = localMidnight(startDate)
  if (target.getTime() <= now.getTime()) return null

  let months = 0
  while (addMonths(now, months + 1).getTime() <= target.getTime()) {
    months += 1
  }

  const rest = target.getTime() - addMonths(now, months).getTime()
  const totalMinutes = Math.floor(rest / 60_000)

  return {
    months,
    days: Math.floor(totalMinutes / 1_440),
    hours: Math.floor((totalMinutes % 1_440) / 60),
    minutes: totalMinutes % 60,
  }
}
```

- [ ] **Step 2: Verify the math with a throwaway script**

Write `<scratchpad>/check-countdown.mjs` with the module inlined (it is plain TS-free JS once types are stripped) and assert:

```js
// 2 whole months out
remainingUnits("2026-09-29", new Date(2026, 6, 29, 12, 0)) -> months 2
// under a month
remainingUnits("2026-08-10", new Date(2026, 6, 29, 12, 0)) -> months 0
// today and past
remainingUnits("2026-07-29", new Date(2026, 6, 29, 12, 0)) -> null
remainingUnits("2026-07-01", new Date(2026, 6, 29, 12, 0)) -> null
// month clamping: from 31 Jan, one month is 28 Feb
addMonths(new Date(2026, 0, 31), 1) -> 2026-02-28
// hours/minutes are in range
every result: days 0..30, hours 0..23, minutes 0..59
```

Expected: all assertions pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/countdown.ts
git commit -m "feat(countdown): calendar-month date math for the trip countdown"
```

---

### Task 2: The flip CSS

**Files:**
- Modify: `src/app/globals.css` (append after the existing `@layer components` type recipes)

**Interfaces:**
- Produces: classes `flip-row`, `flip-unit`, `flip-tile`, `flip-half`, `flip-half-top`, `flip-half-bottom`, `flip-glyph`, `flip-hinge`, `flip-leaf`, `flip-leaf-fold`, `flip-leaf-unfold`, and the size classes `flip-lg` / `flip-sm`. Consumed by Task 3.

- [ ] **Step 1: Append the component rules**

```css
/* Split-flap countdown. Both halves are windows onto the same full-tile glyph
   box, so the digit is centered across the whole tile and continuous across
   the seam. The hinge is drawn over the tile, never as a border, so the two
   halves stay exactly 50% each. */
@layer components {
  .flip-row {
    display: flex;
    gap: var(--flip-gap);
  }
  .flip-unit {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
  }
  .flip-tile {
    position: relative;
    width: var(--flip-w);
    height: var(--flip-h);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    perspective: 260px;
  }
  .flip-half {
    position: absolute;
    left: 0;
    width: 100%;
    height: 50%;
    overflow: hidden;
  }
  .flip-half-top {
    top: 0;
  }
  .flip-half-bottom {
    bottom: 0;
  }
  .flip-glyph {
    position: absolute;
    left: 0;
    width: 100%;
    height: var(--flip-h);
    line-height: var(--flip-h);
    text-align: center;
    font-family: var(--font-mono);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    font-size: var(--flip-f);
    letter-spacing: -0.01em;
    color: var(--foreground);
    transform: translateY(var(--flip-nudge, 0px));
  }
  .flip-half-top .flip-glyph,
  .flip-leaf-fold .flip-glyph {
    top: 0;
  }
  .flip-half-bottom .flip-glyph,
  .flip-leaf-unfold .flip-glyph {
    bottom: 0;
  }
  .flip-hinge {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    margin-top: -0.5px;
    background: var(--clay);
    opacity: 0.28;
    z-index: 30;
  }
  .flip-leaf {
    position: absolute;
    left: 0;
    width: 100%;
    height: 50%;
    overflow: hidden;
    background: var(--card);
    backface-visibility: hidden;
    z-index: 20;
  }
  .flip-leaf-fold {
    top: 0;
    transform-origin: center bottom;
    animation: flip-fold 0.3s cubic-bezier(0.4, 0, 0.9, 0.4) forwards;
  }
  .flip-leaf-unfold {
    bottom: 0;
    transform-origin: center top;
    transform: rotateX(90deg);
    animation: flip-unfold 0.3s cubic-bezier(0.1, 0.6, 0.6, 1) 0.3s forwards;
  }
  .flip-lg {
    --flip-w: 74px;
    --flip-h: 58px;
    --flip-f: 56px;
    --flip-gap: 6px;
  }
  .flip-sm {
    --flip-w: 44px;
    --flip-h: 34px;
    --flip-f: 33px;
    --flip-gap: 5px;
  }
}

@keyframes flip-fold {
  from {
    transform: rotateX(0deg);
  }
  to {
    transform: rotateX(-90deg);
  }
}

@keyframes flip-unfold {
  from {
    transform: rotateX(90deg);
  }
  to {
    transform: rotateX(0deg);
  }
}

@media (min-width: 768px) {
  .flip-lg {
    --flip-w: 96px;
    --flip-h: 76px;
    --flip-f: 73px;
    --flip-gap: 8px;
  }
}

/* Not `animation: none` — the component clears its flip state on the unfold
   leaf's animationend, which would never fire. Near-instant instead. */
@media (prefers-reduced-motion: reduce) {
  .flip-leaf {
    animation-duration: 0.01ms;
    animation-delay: 0s;
  }
}
```

- [ ] **Step 2: Verify the build still compiles the stylesheet**

Run: `pnpm build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(countdown): split-flap tile styles"
```

---

### Task 3: The component

**Files:**
- Create: `src/components/flip-countdown.tsx`

**Interfaces:**
- Consumes: `remainingUnits` from Task 1; the `flip-*` classes from Task 2.
- Produces: `<FlipCountdown startDate={string} size="lg" | "sm" className?={string} />`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"

import { remainingUnits, type Remaining } from "@/lib/countdown"
import { cn } from "@/lib/utils"

/** Split-flap countdown to the trip's start day. Four tiles when the trip is a
 *  calendar month or more away, three when it is closer. Renders nothing once
 *  the trip has started. */
export function FlipCountdown({
  startDate,
  size,
  className,
}: {
  startDate: string
  size: "lg" | "sm"
  className?: string
}) {
  // Starts null so the server renders nothing and the clock cannot mismatch on
  // hydration; the first tick fills it in.
  const [units, setUnits] = useState<Remaining | null>(null)

  useEffect(() => {
    const tick = () =>
      setUnits((prev) => {
        const next = remainingUnits(startDate, new Date())
        return sameUnits(prev, next) ? prev : next
      })
    tick()
    const id = setInterval(tick, 1_000)
    return () => clearInterval(id)
  }, [startDate])

  if (!units) return null

  const tiles = [
    ...(units.months > 0
      ? [{ key: "mon", label: "MON", value: pad(units.months) }]
      : []),
    { key: "days", label: "DAYS", value: pad(units.days) },
    { key: "hrs", label: "HRS", value: pad(units.hours) },
    { key: "min", label: "MIN", value: pad(units.minutes) },
  ]

  return (
    <div
      className={cn("flip-row", size === "lg" ? "flip-lg" : "flip-sm", className)}
    >
      {tiles.map((tile) => (
        <div key={tile.key} className="flip-unit">
          <FlipTile value={tile.value} />
          <div
            className={cn(
              "font-mono uppercase tracking-[0.22em] text-muted-foreground",
              size === "lg" ? "text-[10px]" : "text-[8px]",
            )}
          >
            {tile.label}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One tile. Holds the outgoing value while the leaves animate; the unfold
 *  leaf's animationend clears it. */
function FlipTile({ value }: { value: string }) {
  const [prev, setPrev] = useState<string | null>(null)
  const settled = useRef(value)

  useEffect(() => {
    if (settled.current === value) return
    setPrev(settled.current)
    settled.current = value
  }, [value])

  return (
    <div className="flip-tile">
      <div className="flip-half flip-half-top">
        <span className="flip-glyph">{value}</span>
      </div>
      <div className="flip-half flip-half-bottom">
        <span className="flip-glyph">{prev ?? value}</span>
      </div>
      {prev !== null ? (
        <>
          <div className="flip-leaf flip-leaf-fold">
            <span className="flip-glyph">{prev}</span>
          </div>
          <div
            className="flip-leaf flip-leaf-unfold"
            onAnimationEnd={() => setPrev(null)}
          >
            <span className="flip-glyph">{value}</span>
          </div>
        </>
      ) : null}
      <div className="flip-hinge" />
    </div>
  )
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function sameUnits(a: Remaining | null, b: Remaining | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.months === b.months &&
    a.days === b.days &&
    a.hours === b.hours &&
    a.minutes === b.minutes
  )
}
```

- [ ] **Step 2: Build and lint**

Run: `pnpm build && pnpm lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/flip-countdown.tsx
git commit -m "feat(countdown): FlipCountdown split-flap component"
```

---

### Task 4: Wire the trip page

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (import at :14, header block at :444-466)

**Interfaces:**
- Consumes: `FlipCountdown` from Task 3.

- [ ] **Step 1: Swap the import**

Replace `import { TripCountdown } from "@/components/trip-countdown"` with
`import { FlipCountdown } from "@/components/flip-countdown"`.

- [ ] **Step 2: Replace the header block**

The date-range row currently holds the inline countdown next to the text. The
tile block is far too tall for that row, which also carries `PairAvatar` on the
right. Take the countdown out of the row and put the block underneath it.

```tsx
      <div className="relative mt-4 flex items-center justify-between lg:mt-5">
        {isDream ? (
          <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-foreground">
            {fuzzyLabel}
          </div>
        ) : dateRange ? (
          <div className="font-mono text-[12px] text-foreground">{dateRange}</div>
        ) : (
          <span />
        )}
        {members.length >= 2 ? (
          <PairAvatar
            a={members[0].display_name}
            b={members[1].display_name}
            size={22}
          />
        ) : null}
      </div>
      {!isDream && header.startDate ? (
        <FlipCountdown
          startDate={header.startDate}
          size="lg"
          className="mt-4 lg:mt-5"
        />
      ) : null}
```

- [ ] **Step 3: Build and lint**

Run: `pnpm build && pnpm lint`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/page.tsx"
git commit -m "feat(countdown): flip countdown on the trip page header"
```

---

### Task 5: Wire the home hero, and drop the now-dead text variant

**Files:**
- Modify: `src/app/home/trip-cards.tsx` (import at :13, HeroCard at :137-158 and :161-186, TripCard at :219-225)
- Modify: `src/components/trip-countdown.tsx`

**Interfaces:**
- Consumes: `FlipCountdown` from Task 3, `localMidnight` from Task 1.

After Tasks 4 and 5, `TripCountdown` is only ever called by `TripCard`, which
always passes `daysOnly`. The `daysOnly` prop and its `D/H/M` branch become dead
code, so they go.

- [ ] **Step 1: Add the import in `trip-cards.tsx`**

Keep the `TripCountdown` import (TripCard still uses it) and add:

```tsx
import { FlipCountdown } from "@/components/flip-countdown"
```

- [ ] **Step 2: Remove the inline countdown from the HeroCard image area**

The name row at :138-152 becomes just the name:

```tsx
            <div className="flex items-baseline gap-3">
              <div
                className={`t-display leading-none text-foreground ${
                  today ? "text-[32px] md:text-[36px]" : "text-[38px] md:text-[44px]"
                }`}
              >
                <em>{trip.name}</em>
              </div>
            </div>
```

- [ ] **Step 3: Add the `sm` block to the lower section**

Immediately inside the lower `<div className={...py...}>`, before the `{today ? ... : null}` block:

```tsx
        {trip.startDate ? (
          <FlipCountdown startDate={trip.startDate} size="sm" className="mb-3" />
        ) : null}
```

- [ ] **Step 4: Drop `daysOnly` from the TripCard call**

```tsx
              {trip.startDate ? (
                <TripCountdown
                  startDate={trip.startDate}
                  className="text-[11px] tracking-[0.1em] md:text-[13px]"
                />
              ) : null}
```

- [ ] **Step 5: Simplify `trip-countdown.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"

import { localMidnight } from "@/lib/countdown"
import { cn } from "@/lib/utils"

/** Coarse text countdown for the small trip cards: "40 DAYS TO GO", "TODAY" on
 *  the start day, nothing once the trip is underway. */
export function TripCountdown({
  startDate,
  className,
}: {
  startDate: string
  className?: string
}) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const tick = () => setLabel(countdownLabel(startDate))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [startDate])

  if (!label) return null
  return (
    <div
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.18em] text-clay",
        className,
      )}
    >
      {label}
    </div>
  )
}

function countdownLabel(startDate: string): string | null {
  const target = localMidnight(startDate)
  const now = new Date()
  const diffMs = target.getTime() - now.getTime()

  if (diffMs <= 0) {
    return isSameDay(now, target) ? "TODAY" : null
  }

  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) return "TODAY"

  const years = Math.floor(days / 365)
  const remDays = days % 365
  const parts: string[] = []
  if (years > 0) parts.push(`${years} ${years === 1 ? "YEAR" : "YEARS"}`)
  if (remDays > 0 || years === 0) {
    parts.push(`${remDays} ${remDays === 1 ? "DAY" : "DAYS"}`)
  }
  return `${parts.join(" ")} TO GO`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
```

- [ ] **Step 6: Build and lint**

Run: `pnpm build && pnpm lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/home/trip-cards.tsx src/components/trip-countdown.tsx
git commit -m "feat(countdown): flip countdown on the home hero card"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Add the TODO entry**

Add under the current working section, marked *implemented* (not verified):

```markdown
- [x] Flip-clock trip countdown — split-flap tiles on the trip page and home hero. *Implemented; unverified in app.*
```

- [ ] **Step 2: Add the decisions row**

Append a row recording the non-obvious call:

> Countdown tiles are landscape, not square, because the digits fill the tile at
> their natural width — squaring them would mean condensing IBM Plex Mono. Chosen
> from a rendered three-option comparison.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the flip-clock countdown"
```

---

## Success Criteria

Copied from the spec. The in-app list is what gets handed to the user.

### Verified by Claude

1. `pnpm build` passes and `pnpm lint` is clean.
2. `remainingUnits` reports 2 months for a target two calendar months out.
3. `remainingUnits` reports 0 months for any target under one calendar month away.
4. `remainingUnits` returns `null` for a start date of today and for any past date.
5. Month stepping clamps overflow: 31 Jan + 1 month is 28/29 Feb.
6. `FlipCountdown` renders 4 tiles when `months > 0` and exactly 3 when `months = 0`.
7. Digit strings are zero-padded to two characters at every unit.
8. `TripCard` still renders the plain-text `TripCountdown`.

### Verified by the user in-app

1. Trip page: the block appears under the date range, with no heading above it, and the numbers are correct for a real trip.
2. The digits read as large and full within the tile — a clear margin top and bottom, but nothing like a small digit lost in space.
3. The hinge crosses the optical middle of the numerals, and the two halves are visibly equal.
4. Leaving the page open across a minute boundary shows the minutes tile physically flip, and the tear runs through the middle of the digit.
5. Home hero: the compact tile row sits in the lower section above the date range, and does not crowd or overflow the card on a phone viewport.
6. Mobile viewport: 4 tiles fit on one line without wrapping at `sm`, and the `lg` block fits within the trip page column.
7. Both light and dark mode read correctly — tile, hinge, and labels all legible.
8. A trip under a month away shows 3 tiles, and one over a month shows 4.
9. A trip that has already started shows no block at all.
