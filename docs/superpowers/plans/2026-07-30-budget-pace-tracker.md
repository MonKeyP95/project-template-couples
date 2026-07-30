# Budget Pace Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show whether a running trip is above or below budget, measured against a planned burn curve at the last-logged watermark, on `/on-the-road` and the Budget tab.

**Architecture:** One pure module (`budget-pace.ts`) turns trip dates + budget items + expenses into a `BudgetPace` — a cumulative delta plus length-derived buckets. One pure detector (`unlogged-days.ts`) fires when logging has lagged. One presentational component renders both a compact line and a full drill-down strip. Two pages wire them; `QuickExpense` gains a day picker so catch-up entry dates correctly.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. No new dependency, no migration, no `lib/ai` change.

Spec: `docs/superpowers/specs/2026-07-30-budget-pace-tracker-design.md`

## Global Constraints

- **No new dependency and no database migration.** Everything reads columns that already exist.
- **No emojis** in code, comments, or strings.
- **Sparse comments.** Only where the WHY is non-obvious. Docstrings on exported functions.
- **Dates render day-before-month**, `en-GB` locale, `timeZone: "UTC"`. Never `en-US`, never a bare locale.
- **Money renders through `@/lib/money`** — `money(cents, currency)` / `moneyRounded(cents, currency)`. Never `.toFixed()`, never a hardcoded `€`.
- **All amounts are home-currency cents.** Expenses must be passed through `homeCents(e)` before reaching any function in this plan.
- **`"use client"` files must not import from `*-queries.ts`** (those pull `next/headers`). Types come from `*-types.ts` or `budget-pace.ts`.
- **Do not run `pnpm build` while the dev server is running** — it clobbers the shared `.next` directory. Use `npx tsc --noEmit` for type checking if the server is up.
- There is **no test framework**. Pure functions are verified with a throwaway script in the scratchpad, run via `npx --yes tsx`. Do not add a test runner or a `test` script to `package.json`.
- Sibling imports inside `src/lib/trips/` are **relative** (`./trip-days`), matching the existing files there.

---

### Task 1: The pure pace core

**Files:**
- Create: `src/lib/trips/budget-pace.ts`
- Test: throwaway script at `<scratchpad>/check-budget-pace.ts` (not committed)

**Interfaces:**
- Consumes: `BudgetItem` from `./budget-item-types`, `computeTripDays` from `./trip-days`.
- Produces:
  - `budgetPace(input: BudgetPaceInput): BudgetPace | null`
  - `weekdayLabel(date: string): string` — `"WED"`
  - `dayLabel(date: string): string` — `"28 Jul"`
  - types `BudgetPace`, `BudgetPaceInput`, `PaceBucket`, `PaceExpense`, `PaceBucketUnit`

- [ ] **Step 1: Write the module**

Create `src/lib/trips/budget-pace.ts`:

```ts
import type { BudgetItem } from "./budget-item-types"
import { computeTripDays } from "./trip-days"

/** Reserved category excluded from the tracker; mirrors budget-tab.tsx. */
const PRE_TRIP = "Pre-trip"
const DAY_MS = 86_400_000
/** A tracker "month" is four whole weeks, so months drill down into weeks evenly. */
const MONTH_DAYS = 28

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
})
const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

/** "WED" */
export function weekdayLabel(date: string): string {
  return WEEKDAY_FMT.format(new Date(`${date}T00:00:00Z`)).toUpperCase()
}

/** "28 Jul" -- day before month, per house date order. */
export function dayLabel(date: string): string {
  return DAY_FMT.format(new Date(`${date}T00:00:00Z`))
}

/** Minimal expense shape; pass `homeCents(e)` as `amountCents`. */
export interface PaceExpense {
  category: string
  dayDate: string | null
  isSettlement: boolean
  amountCents: number
}

export type PaceBucketUnit = "day" | "week" | "month"

export interface PaceBucket {
  label: string
  startDate: string
  endDate: string
  plannedCents: number
  spentCents: number
  status: "past" | "current" | "future"
  /** False when the whole bucket sits past the last-logged watermark. */
  logged: boolean
  /** One level down: days inside a week, weeks inside a month. Empty for a day. */
  children: PaceBucket[]
}

export interface BudgetPace {
  /** Planned spend through the watermark. */
  plannedToDateCents: number
  /** Actual spend through the watermark. */
  spentToDateCents: number
  /** Positive = over budget. */
  deltaCents: number
  dayIndex: number
  tripDays: number
  unit: PaceBucketUnit
  buckets: PaceBucket[]
  /** Latest day carrying an expense; null when nothing is logged yet. */
  lastLogged: string | null
  unloggedDays: number
  source: "items" | "flat"
  /** The tracker's denominator: planned items, or the budget less pre-trip. */
  onTheRoadBudgetCents: number
  preTripPlannedCents: number
}

export interface BudgetPaceInput {
  startDate: string | null
  endDate: string | null
  today: string
  plannedBudgetCents: number
  budgetItems: BudgetItem[]
  expenses: PaceExpense[]
  /** Location id -> its yyyy-mm-dd dates. */
  locationDays: Record<string, string[]>
}

function toUtc(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime()
}

function addDays(date: string, n: number): string {
  return new Date(toUtc(date) + n * DAY_MS).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

function bucketUnit(tripDays: number): PaceBucketUnit {
  if (tripDays <= 9) return "day"
  if (tripDays <= 42) return "week"
  return "month"
}

/**
 * The days an item's cost belongs to: its own dates, else its location's days,
 * else the whole trip. Dates outside the trip window drop out -- the matching
 * expense is excluded too, so both sides stay comparable.
 */
function itemSpan(
  item: BudgetItem,
  tripDates: string[],
  locationDays: Record<string, string[]>,
): string[] {
  if (item.whenStart) {
    const end = item.whenEnd ?? item.whenStart
    return tripDates.filter((d) => d >= item.whenStart! && d <= end)
  }
  if (item.locationId) {
    const within = (locationDays[item.locationId] ?? []).filter((d) =>
      tripDates.includes(d),
    )
    if (within.length > 0) return within
  }
  return tripDates
}

/**
 * How an item's total lands across its span. `amount_cents` is already the
 * resolved total (unit price x quantity), so this only ever divides.
 */
function spreadItem(item: BudgetItem, span: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (span.length === 0) return out
  if (item.freq === "once") {
    out.set(span[0], item.amountCents)
    return out
  }
  const per = item.amountCents / span.length
  for (const date of span) out.set(date, per)
  return out
}

function sumThrough(byDay: Map<string, number>, dates: string[], end: string): number {
  let total = 0
  for (const date of dates) {
    if (date <= end) total += byDay.get(date) ?? 0
  }
  return total
}

function chunk(dates: string[], size: number): string[][] {
  const out: string[][] = []
  for (let i = 0; i < dates.length; i += size) out.push(dates.slice(i, i + size))
  return out
}

function makeBucket(
  label: string,
  dates: string[],
  plannedByDay: Map<string, number>,
  spentByDay: Map<string, number>,
  today: string,
  watermark: string,
  children: PaceBucket[],
): PaceBucket {
  const startDate = dates[0]
  const endDate = dates[dates.length - 1]
  let plannedCents = 0
  let spentCents = 0
  for (const date of dates) {
    plannedCents += plannedByDay.get(date) ?? 0
    spentCents += spentByDay.get(date) ?? 0
  }
  return {
    label,
    startDate,
    endDate,
    plannedCents: Math.round(plannedCents),
    spentCents: Math.round(spentCents),
    status: endDate < today ? "past" : startDate > today ? "future" : "current",
    logged: startDate <= watermark,
    children,
  }
}

function buildBuckets(
  tripDates: string[],
  unit: PaceBucketUnit,
  plannedByDay: Map<string, number>,
  spentByDay: Map<string, number>,
  today: string,
  watermark: string,
): PaceBucket[] {
  const day = (dates: string[]) =>
    makeBucket(weekdayLabel(dates[0]), dates, plannedByDay, spentByDay, today, watermark, [])

  if (unit === "day") return tripDates.map((d) => day([d]))

  const weeks = chunk(tripDates, 7).map((dates, i) =>
    makeBucket(
      `WEEK ${i + 1}`,
      dates,
      plannedByDay,
      spentByDay,
      today,
      watermark,
      dates.map((d) => day([d])),
    ),
  )
  if (unit === "week") return weeks

  return chunk(tripDates, MONTH_DAYS).map((dates, i) =>
    makeBucket(
      `MONTH ${i + 1}`,
      dates,
      plannedByDay,
      spentByDay,
      today,
      watermark,
      weeks.filter((w) => w.startDate >= dates[0] && w.startDate <= dates[dates.length - 1]),
    ),
  )
}

/**
 * Where a running trip stands against its budget. Null when there is nothing to
 * track: no dates, no budget, or today outside the trip window.
 *
 * The delta is measured at the last-logged watermark, not at today -- comparing
 * spend-through-Tuesday against plan-through-Thursday would report an
 * underspend that is only unlogged spending.
 */
export function budgetPace(input: BudgetPaceInput): BudgetPace | null {
  const { startDate, endDate, today, plannedBudgetCents } = input
  if (!startDate || !endDate) return null
  if (plannedBudgetCents <= 0) return null
  if (today < startDate || today > endDate) return null

  const tripDays = computeTripDays(startDate, endDate)
  const tripDates = Array.from({ length: tripDays }, (_, i) => addDays(startDate, i))

  const preTripPlannedCents = input.budgetItems
    .filter((it) => it.category === PRE_TRIP)
    .reduce((sum, it) => sum + it.amountCents, 0)
  const tripItems = input.budgetItems.filter((it) => it.category !== PRE_TRIP)
  const source: "items" | "flat" = tripItems.length > 0 ? "items" : "flat"
  const onTheRoadBudgetCents =
    source === "items"
      ? tripItems.reduce((sum, it) => sum + it.amountCents, 0)
      : Math.max(0, plannedBudgetCents - preTripPlannedCents)

  const plannedByDay = new Map<string, number>()
  if (source === "items") {
    for (const item of tripItems) {
      const span = itemSpan(item, tripDates, input.locationDays)
      for (const [date, cents] of spreadItem(item, span)) {
        plannedByDay.set(date, (plannedByDay.get(date) ?? 0) + cents)
      }
    }
  } else {
    const per = onTheRoadBudgetCents / tripDays
    for (const date of tripDates) plannedByDay.set(date, per)
  }

  const spentByDay = new Map<string, number>()
  let lastLogged: string | null = null
  for (const e of input.expenses) {
    if (e.isSettlement) continue
    if (e.category === PRE_TRIP) continue
    if (!e.dayDate) continue
    if (e.dayDate < startDate || e.dayDate > endDate) continue
    spentByDay.set(e.dayDate, (spentByDay.get(e.dayDate) ?? 0) + e.amountCents)
    if (e.dayDate <= today && (lastLogged === null || e.dayDate > lastLogged)) {
      lastLogged = e.dayDate
    }
  }

  // Nothing logged: the watermark sits before day 1, so every figure reads zero
  // rather than crediting the couple with an underspend.
  const watermark = lastLogged ?? addDays(startDate, -1)
  const plannedToDateCents = Math.round(sumThrough(plannedByDay, tripDates, watermark))
  const spentToDateCents = Math.round(sumThrough(spentByDay, tripDates, watermark))

  return {
    plannedToDateCents,
    spentToDateCents,
    deltaCents: spentToDateCents - plannedToDateCents,
    dayIndex: daysBetween(startDate, today) + 1,
    tripDays,
    unit: bucketUnit(tripDays),
    buckets: buildBuckets(
      tripDates,
      bucketUnit(tripDays),
      plannedByDay,
      spentByDay,
      today,
      watermark,
    ),
    lastLogged,
    unloggedDays: lastLogged
      ? daysBetween(lastLogged, today)
      : daysBetween(startDate, today) + 1,
    source,
    onTheRoadBudgetCents,
    preTripPlannedCents,
  }
}
```

- [ ] **Step 2: Write the verification script**

Create `check-budget-pace.ts` in the scratchpad directory (path is in your environment; it is **not** committed):

```ts
import { budgetPace, type PaceExpense } from "../../projects/project-template-couples/src/lib/trips/budget-pace"
import type { BudgetItem } from "../../projects/project-template-couples/src/lib/trips/budget-item-types"

// Adjust the two import paths above to the real relative path from the
// scratchpad file to src/lib/trips/. Run from the project root.

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

function item(over: Partial<BudgetItem>): BudgetItem {
  return {
    id: "i", category: "Food", subject: "s", whenLabel: "", amountCents: 0,
    locationId: null, whenStart: null, whenEnd: null, sortOrder: 0,
    paidExpenseId: null, estimated: false, sourceUrl: null, priceUnknown: false,
    freq: "daily", count: 1, ...over,
  }
}
function spend(dayDate: string | null, amountCents: number, over: Partial<PaceExpense> = {}): PaceExpense {
  return { category: "Food", dayDate, isSettlement: false, amountCents, ...over }
}

const TRIP = { startDate: "2026-08-01", endDate: "2026-08-14", locationDays: {} }
const logged14 = Array.from({ length: 14 }, (_, i) =>
  spend(`2026-08-${String(i + 1).padStart(2, "0")}`, 0),
)

// 1. Flat fallback: 1400 over 14 days, planned through day 6 = 600.
const flat = budgetPace({
  ...TRIP, today: "2026-08-06", plannedBudgetCents: 140000,
  budgetItems: [], expenses: logged14.slice(0, 6),
})
check("flat planned through day 6", flat?.plannedToDateCents, 60000)
check("flat source", flat?.source, "flat")

// 2. Items: once flight 420 (whole trip) + daily food 840 -> day 1 = 480, day 6 = 780.
const items = [
  item({ category: "Transport", amountCents: 42000, freq: "once" }),
  item({ amountCents: 84000, freq: "daily" }),
]
const day1 = budgetPace({
  ...TRIP, today: "2026-08-01", plannedBudgetCents: 140000,
  budgetItems: items, expenses: logged14.slice(0, 1),
})
check("items planned through day 1", day1?.plannedToDateCents, 48000)
const day6 = budgetPace({
  ...TRIP, today: "2026-08-06", plannedBudgetCents: 140000,
  budgetItems: items, expenses: logged14.slice(0, 6),
})
check("items planned through day 6", day6?.plannedToDateCents, 78000)
check("items source", day6?.source, "items")

// 3. Bucket sizes.
const short = budgetPace({
  startDate: "2026-08-01", endDate: "2026-08-05", locationDays: {},
  today: "2026-08-03", plannedBudgetCents: 50000, budgetItems: [],
  expenses: [spend("2026-08-03", 0)],
})
check("5-day unit", short?.unit, "day")
check("5-day bucket count", short?.buckets.length, 5)
check("14-day unit", flat?.unit, "week")
check("14-day bucket count", flat?.buckets.length, 2)
const long = budgetPace({
  startDate: "2026-08-01", endDate: "2026-09-29", locationDays: {},
  today: "2026-08-10", plannedBudgetCents: 600000, budgetItems: [],
  expenses: [spend("2026-08-10", 0)],
})
check("60-day unit", long?.unit, "month")

// 4. Watermark: logged d1-d2 only, today d6 -> delta measured through d2.
const stale = budgetPace({
  ...TRIP, today: "2026-08-06", plannedBudgetCents: 140000, budgetItems: [],
  expenses: [spend("2026-08-01", 12000), spend("2026-08-02", 12000)],
})
check("watermark lastLogged", stale?.lastLogged, "2026-08-02")
check("watermark planned", stale?.plannedToDateCents, 20000)
check("watermark spent", stale?.spentToDateCents, 24000)
check("watermark delta", stale?.deltaCents, 4000)
check("unlogged days", stale?.unloggedDays, 4)
check("week 1 logged", stale?.buckets[0].logged, true)
check("week 2 logged", stale?.buckets[1].logged, false)

// 5. Exclusions each change nothing.
const base = budgetPace({
  ...TRIP, today: "2026-08-06", plannedBudgetCents: 140000, budgetItems: [],
  expenses: [spend("2026-08-02", 12000)],
})
const polluted = budgetPace({
  ...TRIP, today: "2026-08-06", plannedBudgetCents: 140000,
  budgetItems: [item({ category: "Pre-trip", amountCents: 42000, freq: "once" })],
  expenses: [
    spend("2026-08-02", 12000),
    spend("2026-08-02", 99900, { isSettlement: true }),
    spend("2026-08-02", 99900, { category: "Pre-trip" }),
    spend(null, 99900),
    spend("2026-07-20", 99900),
  ],
})
check("exclusions: spent unchanged", polluted?.spentToDateCents, base?.spentToDateCents)
check("exclusions: planned unchanged", polluted?.plannedToDateCents, base?.plannedToDateCents)
check("exclusions: still flat", polluted?.source, "flat")
check("pre-trip removed from denominator", polluted?.onTheRoadBudgetCents, 98000)

// 6. Nothing to track.
check("no budget", budgetPace({ ...TRIP, today: "2026-08-06", plannedBudgetCents: 0, budgetItems: [], expenses: [] }), null)
check("dream", budgetPace({ startDate: null, endDate: null, locationDays: {}, today: "2026-08-06", plannedBudgetCents: 140000, budgetItems: [], expenses: [] }), null)
check("before trip", budgetPace({ ...TRIP, today: "2026-07-20", plannedBudgetCents: 140000, budgetItems: [], expenses: [] }), null)

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 3: Run the verification script**

Run from the project root:

```bash
npx --yes tsx <scratchpad>/check-budget-pace.ts
```

Expected: every line `PASS`, final line `ALL PASS`, exit 0.

If any line FAILs, fix `budget-pace.ts` — not the expectations. The expected values are derived in the spec.

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/budget-pace.ts
git commit -m "feat(budget): pure pace core measured at the logging watermark"
```

---

### Task 2: The unlogged-days detector

**Files:**
- Modify: `src/lib/nudges/types.ts` (append a context type)
- Create: `src/lib/nudges/unlogged-days.ts`
- Test: throwaway script at `<scratchpad>/check-unlogged.ts` (not committed)

**Interfaces:**
- Consumes: `Nudge` from `./types`; `BudgetPace.unloggedDays` and `BudgetPace.lastLogged` from Task 1.
- Produces: `detectUnloggedDays(ctx: UnloggedDaysContext): Nudge | null`, and the exported type `UnloggedDaysContext`.

- [ ] **Step 1: Add the context type**

Append to `src/lib/nudges/types.ts`, after `NearDailyCapContext`:

```ts
export type UnloggedDaysContext = {
  /** Whole days between the last logged expense and today. */
  unloggedDays: number
  /** Short label for the last logged day, e.g. "28 Jul"; null when nothing is logged. */
  lastLoggedLabel: string | null
}
```

- [ ] **Step 2: Write the detector**

Create `src/lib/nudges/unlogged-days.ts`:

```ts
import type { Nudge, UnloggedDaysContext } from "./types"

const MIN_UNLOGGED_DAYS = 2

/** Fires when logging has lagged far enough that the budget line is stale.
 * Pure: reads context, returns a nudge or null. */
export function detectUnloggedDays(ctx: UnloggedDaysContext): Nudge | null {
  const { unloggedDays, lastLoggedLabel } = ctx
  if (unloggedDays < MIN_UNLOGGED_DAYS) return null
  const since = lastLoggedLabel
    ? `accurate up to ${lastLoggedLabel}`
    : "empty so far"
  return {
    id: "unlogged-days",
    text: `Nothing logged for ${unloggedDays} days -- your budget line is only ${since}.`,
    help: { label: "catch up" },
  }
}
```

- [ ] **Step 3: Write and run the verification script**

Create `<scratchpad>/check-unlogged.ts` (fix the import path to the real relative path):

```ts
import { detectUnloggedDays } from "../../projects/project-template-couples/src/lib/nudges/unlogged-days"

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(actual)}`)
}

check("0 days", detectUnloggedDays({ unloggedDays: 0, lastLoggedLabel: "28 Jul" }), null)
check("1 day", detectUnloggedDays({ unloggedDays: 1, lastLoggedLabel: "28 Jul" }), null)
check("2 days id", detectUnloggedDays({ unloggedDays: 2, lastLoggedLabel: "28 Jul" })?.id, "unlogged-days")
check("2 days help", detectUnloggedDays({ unloggedDays: 2, lastLoggedLabel: "28 Jul" })?.help?.label, "catch up")
check(
  "never logged",
  detectUnloggedDays({ unloggedDays: 3, lastLoggedLabel: null })?.text,
  "Nothing logged for 3 days -- your budget line is only empty so far.",
)

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
```

Run:

```bash
npx --yes tsx <scratchpad>/check-unlogged.ts
```

Expected: `ALL PASS`, exit 0.

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nudges/types.ts src/lib/nudges/unlogged-days.ts
git commit -m "feat(nudges): detect when expense logging has lagged"
```

---

### Task 3: The pace strip component

**Files:**
- Create: `src/components/budget-pace-strip.tsx`

**Interfaces:**
- Consumes: `BudgetPace`, `PaceBucket`, `dayLabel` from `@/lib/trips/budget-pace` (Task 1); `Bar` from `@/components/together`; `useCurrency` from `@/components/currency-context`; `money` from `@/lib/money`; `cn` from `@/lib/utils`.
- Produces: `PaceLine({ pace, className })` — the compact road line; `PaceStrip({ pace })` — the full Budget-tab strip.

Both are `"use client"`. `budget-pace.ts` is pure (no `next/headers`), so importing it from a client component is safe.

- [ ] **Step 1: Write the component**

Create `src/components/budget-pace-strip.tsx`:

```tsx
"use client"

import * as React from "react"

import { Bar } from "@/components/together"
import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { dayLabel, type BudgetPace, type PaceBucket } from "@/lib/trips/budget-pace"

type Verdict = { text: string; tone: "clay" | "moss" }

function verdict(deltaCents: number, currency: string): Verdict {
  if (deltaCents > 0) return { text: `${money(deltaCents, currency)} over`, tone: "clay" }
  if (deltaCents < 0) return { text: `${money(-deltaCents, currency)} under`, tone: "moss" }
  return { text: "on budget", tone: "moss" }
}

function pctOf(spentCents: number, plannedCents: number): number {
  if (plannedCents <= 0) return spentCents > 0 ? 100 : 0
  return Math.min(100, Math.round((spentCents / plannedCents) * 100))
}

function asOf(pace: BudgetPace): string {
  return pace.lastLogged ? `as of ${dayLabel(pace.lastLogged)}` : "nothing logged yet"
}

function toneClass(tone: "clay" | "moss"): string {
  return tone === "clay" ? "text-clay" : "text-moss"
}

/** Compact road verdict: one line, one bar, no drill-down. */
export function PaceLine({
  pace,
  className,
}: {
  pace: BudgetPace
  className?: string
}) {
  const { currency } = useCurrency()
  const v = verdict(pace.deltaCents, currency)
  const current = pace.buckets.find((b) => b.status === "current")
  return (
    <section
      className={cn("rounded-[14px] border border-border bg-card px-5 py-4", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className={cn("t-num text-[15px]", toneClass(v.tone))}>{v.text}</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
          {current ? `${current.label} · ` : ""}
          {asOf(pace)}
        </span>
      </div>
      <Bar
        className="mt-2"
        pct={pctOf(pace.spentToDateCents, pace.plannedToDateCents)}
        tone={v.tone}
      />
    </section>
  )
}

function bucketNote(bucket: PaceBucket, currency: string): string {
  if (bucket.status === "future") return "to come"
  if (!bucket.logged) return "not logged"
  const delta = bucket.spentCents - bucket.plannedCents
  if (delta === 0) return "on budget"
  return `${money(Math.abs(delta), currency)} ${delta > 0 ? "over" : "under"}`
}

function BucketRow({
  bucket,
  open,
  onToggle,
  leaf = false,
}: {
  bucket: PaceBucket
  open?: boolean
  onToggle?: () => void
  /** Child rows never expand -- the strip drills down exactly one level. */
  leaf?: boolean
}) {
  const { currency } = useCurrency()
  const expandable = !leaf && bucket.children.length > 0

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
          {bucket.label}
          {expandable ? <span className="ml-1.5">{open ? "⌄" : "›"}</span> : null}
        </span>
        <span className="t-num text-[12px] text-foreground">
          {bucketNote(bucket, currency)}
        </span>
      </div>
      {bucket.logged ? (
        <Bar
          className="mt-1.5"
          pct={pctOf(bucket.spentCents, bucket.plannedCents)}
          tone={bucket.spentCents > bucket.plannedCents ? "clay" : "moss"}
        />
      ) : (
        <div className="mt-1.5 h-1 w-full rounded-full border border-dashed border-border" />
      )}
    </>
  )

  if (!expandable) return <div className="py-2">{body}</div>

  return (
    <div className="py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full border-0 bg-transparent p-0 text-left"
      >
        {body}
      </button>
      {open ? (
        <div className="mt-1 border-l border-border pl-3">
          {bucket.children.map((child) => (
            <BucketRow key={child.startDate} bucket={child} leaf />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Full Budget-tab strip: the verdict, the denominator, and one row per bucket. */
export function PaceStrip({ pace }: { pace: BudgetPace }) {
  const { currency } = useCurrency()
  const v = verdict(pace.deltaCents, currency)
  const [openDate, setOpenDate] = React.useState<string | null>(null)

  const denominator =
    pace.source === "flat" && pace.preTripPlannedCents > 0
      ? `${money(pace.onTheRoadBudgetCents, currency)} on the road (budget less ${money(pace.preTripPlannedCents, currency)} before you go)`
      : `${money(pace.onTheRoadBudgetCents, currency)} planned on the road`

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn("t-num text-[16px]", toneClass(v.tone))}>{v.text}</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
          day {pace.dayIndex} of {pace.tripDays} · {asOf(pace)}
        </span>
      </div>
      <div className="mt-1 font-mono text-[9.5px] tracking-[0.06em] text-muted-foreground">
        {denominator}
      </div>
      <div className="mt-2">
        {pace.buckets.map((bucket) => (
          <BucketRow
            key={bucket.startDate}
            bucket={bucket}
            open={openDate === bucket.startDate}
            onToggle={() =>
              setOpenDate(openDate === bucket.startDate ? null : bucket.startDate)
            }
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: both clean. Note the `⌄` / `›` characters are inside JSX expressions or plain text nodes with no `{`/`}` — no React 19 escaping issue arises here.

- [ ] **Step 3: Commit**

```bash
git add src/components/budget-pace-strip.tsx
git commit -m "feat(budget): pace line and drill-down strip"
```

---

### Task 4: Wire the Budget tab

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (the `<BudgetTab ... />` call)
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

**Interfaces:**
- Consumes: `budgetPace` (Task 1), `PaceStrip` (Task 3), `homeCents` (already imported in `budget-tab.tsx`).
- Produces: nothing other tasks depend on.

`BudgetTab` already receives `itineraryDays: DayLocation[]` (`{ dayDate, locationId }`), so the location-days map is built locally — no new query.

- [ ] **Step 1: Pass the three new props from the page**

In `src/app/trips/[slug]/page.tsx`, in the `<BudgetTab ... />` element, add three props next to `tripDays`:

```tsx
            tripDays={computeTripDays(header.startDate, header.endDate)}
            startDate={header.startDate}
            endDate={header.endDate}
            today={today}
```

`today` is already computed earlier in the same function (`const today = await localToday()`).

- [ ] **Step 2: Add the props to the component signature**

In `src/app/trips/[slug]/budget-tab.tsx`, add to `BudgetTabProps` after `tripDays: number`:

```ts
  startDate: string | null
  endDate: string | null
  today: string
```

and to the destructured parameter list after `tripDays,`:

```ts
  startDate,
  endDate,
  today,
```

- [ ] **Step 3: Add the imports**

In `src/app/trips/[slug]/budget-tab.tsx`, alongside the existing imports:

```ts
import { budgetPace } from "@/lib/trips/budget-pace"
import { PaceStrip } from "@/components/budget-pace-strip"
```

- [ ] **Step 4: Compute the pace**

In the `BudgetTab` body, immediately after the existing `hasUnconfirmed` computation:

```tsx
  const locationDays: Record<string, string[]> = {}
  for (const day of itineraryDays) {
    if (day.locationId) (locationDays[day.locationId] ??= []).push(day.dayDate)
  }
  // itemSpan takes the first date of a span for a `once` cost, so order matters.
  for (const dates of Object.values(locationDays)) dates.sort()

  const pace = budgetPace({
    startDate,
    endDate,
    today,
    plannedBudgetCents,
    budgetItems,
    expenses: expenses.map((e) => ({
      category: e.category,
      dayDate: e.dayDate,
      isSettlement: e.isSettlement,
      amountCents: homeCents(e),
    })),
    locationDays,
  })
```

- [ ] **Step 5: Render the strip**

In `budget-tab.tsx`, inside the "Spent bar + add expense" card, add the strip after the `SpentFigure` block and before `<LogExpenseRow`:

```tsx
          <SpentFigure
            tripId={tripId}
            tripSlug={tripSlug}
            spentCents={totalCents}
            plannedBudgetCents={plannedBudgetCents}
            hasUnconfirmed={hasUnconfirmed}
          />
          {pace ? <PaceStrip pace={pace} /> : null}
        </div>
```

(The `{pace ? ... : null}` line goes inside the same `<div className="px-5 pt-4 pb-4">` that wraps `SpentFigure`.)

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add "src/app/trips/[slug]/page.tsx" "src/app/trips/[slug]/budget-tab.tsx"
git commit -m "feat(budget): show the pace strip on the Budget tab"
```

---

### Task 5: Wire `/on-the-road`

**Files:**
- Create: `src/app/on-the-road/catch-up-nudge.tsx`
- Modify: `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: `budgetPace`, `dayLabel` (Task 1); `detectUnloggedDays` (Task 2); `PaceLine` (Task 3); `getBudgetItems` from `@/lib/trips/budget-item-queries`.
- Produces: `CatchUpNudge({ nudge })`, and the DOM anchor `id="road-expense"` that its help tap scrolls to.

- [ ] **Step 1: Write the catch-up nudge wrapper**

Create `src/app/on-the-road/catch-up-nudge.tsx`:

```tsx
"use client"

import { NudgeLine } from "@/components/nudge-line"
import type { Nudge } from "@/lib/nudges/types"

/** Free nudge whose help tap scrolls to the expense form. Spends no tokens --
 * unlike RoadNudge it never touches the assistant. */
export function CatchUpNudge({ nudge }: { nudge: Nudge }) {
  return (
    <div className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card px-4 py-3">
      <NudgeLine
        nudge={nudge}
        onHelp={() =>
          document
            .getElementById("road-expense")
            ?.scrollIntoView({ behavior: "smooth" })
        }
      />
    </div>
  )
}
```

- [ ] **Step 2: Add the imports to the page**

In `src/app/on-the-road/page.tsx`, alongside the existing imports:

```ts
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
import { budgetPace, dayLabel } from "@/lib/trips/budget-pace"
import { detectUnloggedDays } from "@/lib/nudges/unlogged-days"
import { PaceLine } from "@/components/budget-pace-strip"
import { CatchUpNudge } from "./catch-up-nudge"
```

- [ ] **Step 3: Compute the pace and the nudge**

In `page.tsx`, after the existing `capNudge` computation and after `const days = await getItineraryDays(trip.id)` (move the pace block below the `days` line — it needs it):

```ts
  const budgetItems = await getBudgetItems(trip.id)
  const locationDays: Record<string, string[]> = {}
  for (const day of days) {
    if (day.locationId) (locationDays[day.locationId] ??= []).push(day.dayDate)
  }
  for (const dates of Object.values(locationDays)) dates.sort()

  const pace = budgetPace({
    startDate: trip.startDate,
    endDate: trip.endDate,
    today,
    plannedBudgetCents: trip.plannedBudgetCents,
    budgetItems,
    expenses: expenses.map((e) => ({
      category: e.category,
      dayDate: e.dayDate,
      isSettlement: e.isSettlement,
      amountCents: homeCents(e),
    })),
    locationDays,
  })
  const unloggedNudge = pace
    ? detectUnloggedDays({
        unloggedDays: pace.unloggedDays,
        lastLoggedLabel: pace.lastLogged ? dayLabel(pace.lastLogged) : null,
      })
    : null
```

`homeCents` is already imported in this file.

- [ ] **Step 4: Render the line, the nudge, and the anchor**

In `page.tsx`, replace the existing `<QuickExpense ... />` element and the `capNudge` line above it with:

```tsx
      {capNudge ? <RoadNudge nudge={capNudge} /> : null}

      {pace ? <PaceLine pace={pace} className="mt-4 block" /> : null}
      {unloggedNudge ? <CatchUpNudge nudge={unloggedNudge} /> : null}

      <div id="road-expense">
        <QuickExpense
          tripId={trip.id}
          tripSlug={trip.slug}
          today={today}
          tripStartDate={trip.startDate ?? today}
          currentUserId={userData.user.id}
          categories={categories}
          spentTodayCents={spentTodayCents}
          locationCurrency={
            locations.find((l) => l.id === todayDay?.locationId)?.currency ?? null
          }
        />
      </div>
```

The `tripStartDate` prop is consumed by Task 6; add it now so the two tasks do not both edit this element.

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: `tsc` reports one error — `QuickExpense` has no `tripStartDate` prop yet. That is resolved by Task 6. Everything else must be clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/on-the-road/catch-up-nudge.tsx src/app/on-the-road/page.tsx
git commit -m "feat(road): show the budget pace line and the catch-up nudge"
```

---

### Task 6: Day picker on the road expense form

**Files:**
- Modify: `src/app/on-the-road/quick-expense.tsx`

**Interfaces:**
- Consumes: `dayLabel` from `@/lib/trips/budget-pace` (Task 1); the `tripStartDate` prop passed in Task 5.
- Produces: nothing other tasks depend on. `logExpense`'s signature is unchanged — it already accepts `dayDate`.

- [ ] **Step 1: Add the import and the prop**

In `src/app/on-the-road/quick-expense.tsx`, add the import:

```ts
import { dayLabel } from "@/lib/trips/budget-pace"
```

Add to `QuickExpenseProps`, after `today: string`:

```ts
  /** First day of the trip; the picker never offers a day before it. */
  tripStartDate: string
```

and to the destructured parameter list after `today,`:

```ts
  tripStartDate,
```

- [ ] **Step 2: Add the day state and options**

In the `QuickExpense` body, after the existing `const [category, setCategory] = ...` line:

```tsx
  const [dayDate, setDayDate] = React.useState(today)

  const dayOptions = React.useMemo(() => {
    const startMs = new Date(`${tripStartDate}T00:00:00Z`).getTime()
    const todayMs = new Date(`${today}T00:00:00Z`).getTime()
    const out: { value: string; label: string }[] = []
    for (let i = 0; todayMs - i * 86_400_000 >= startMs; i++) {
      const value = new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10)
      out.push({
        value,
        label: i === 0 ? "Today" : i === 1 ? "Yesterday" : dayLabel(value),
      })
    }
    return out
  }, [today, tripStartDate])
```

- [ ] **Step 3: Send the chosen day**

In `submit`, change the `logExpense` call's `dayDate` argument:

```ts
        dayDate,
```

(replacing `dayDate: today`).

Do **not** reset `dayDate` in the success branch. Catching up means entering several expenses from the same past day in a row, so the picker holds its value until changed.

- [ ] **Step 4: Render the picker**

In the second form row, insert the day `<select>` between the category `<select>` and the submit button:

```tsx
          <select
            value={dayDate}
            onChange={(e) => setDayDate(e.target.value)}
            disabled={isPending}
            aria-label="Day this expense was paid"
            className="w-28 shrink-0 rounded-lg border border-border bg-background px-2 py-2 text-[13px] text-foreground"
          >
            {dayOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
```

- [ ] **Step 5: Type-check, lint, build**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: both clean, including the `tripStartDate` error left open by Task 5.

Then, **only if the dev server is not running**:

```bash
pnpm build
```

Expected: build succeeds. If the dev server is up, stop it first or record that the build is owed.

- [ ] **Step 6: Commit**

```bash
git add src/app/on-the-road/quick-expense.tsx
git commit -m "feat(road): pick which day an expense was paid"
```

---

## Wrap-up

- [ ] **Update `docs/TODO.md`** — add a row under a new `## Budget pace tracker — 2026-07-30` heading recording what landed, the spec and plan paths, that lint/tsc/build are clean, and that in-app verification is pending.
- [ ] **Add a `docs/DECISIONS.md` row** for the non-obvious choice: the delta is measured at the last-logged watermark rather than at today, because batch expense entry would otherwise read as an underspend.
- [ ] **Hand the user the in-app checklist** — the "Verified by the user in-app" list from the spec, numbered, with the reminder that nothing here may be reported as "works" or "verified" until they confirm it.

## Self-review notes

Spec coverage checked task by task: pure core and its exclusions (Task 1), watermark and bucket derivation (Task 1), unlogged detector (Task 2), compact line and full strip including pending-not-zero rendering and the stated denominator (Task 3), Budget-tab surface gated on a running trip via `budgetPace` returning null (Task 4), road surface and the scroll anchor (Task 5), date chip (Task 6). Every "Verified by Claude" criterion in the spec maps to a step: criteria 1 to Task 6 step 5, criterion 2 to Task 1 step 3, criterion 3 to Task 2 step 3, criterion 4 to Task 1 step 3 (the "Nothing to track" checks), criterion 5 to Task 6 step 3.

