# Trip Journal — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-trip **Journal** — a raw, location-organized record of what a couple did and spent on a trip — assembled from existing itinerary + expenses + pre-trip data, rendered additively on `/profile`.

**Architecture:** One pure assembler (`lib/journal/journal-types.ts`) turns already-fetched domain objects into a `JournalRecord`; a thin server query (`journal-queries.ts`) fetches the rows and calls it; a static component (`trip-journal.tsx`) renders it; `/profile` computes journals for started trips and renders them under each trip heading. No AI, no new table/migration, nothing removed.

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript 5, Supabase (`@supabase/ssr`), pnpm. Pure-logic verification via `npx tsx` throwaway scripts (repo convention); wiring via `pnpm lint` + `pnpm build`.

## Global Constraints

- No test framework exists; **do not add one**. Verify pure modules with a throwaway `npx tsx` script (delete it before committing); verify server/UI with `pnpm lint` and `pnpm build`.
- `"use client"` files must import query-layer types only from `*-types.ts`, never `*-queries.ts` (which pulls `next/headers`). `journal-types.ts` must stay server-free (pure).
- No emojis in code/logs. Sparse comments; clear names. Short modules/functions.
- Dates are `yyyy-mm-dd` strings compared lexicographically (UTC). Display money as whole euros: `(cents / 100).toFixed(0)`.
- **Additive only.** Slice 1 removes/edits no existing behavior on `/profile`. The old per-trip taste blocks and `TripBudget` widget stay.
- Package manager is **pnpm** (`pnpm lint`, `pnpm build`). Node 24.

---

### Task 1: Pure journal assembler + types (`journal-types.ts`)

**Files:**
- Create: `src/lib/journal/journal-types.ts`
- Verify (throwaway, delete before commit): `src/lib/journal/_verify.ts`

**Interfaces:**
- Consumes (all pure, already in repo):
  - `src/lib/trips/expense-types.ts` → `Expense`, `summarizeBudget(expenses: Expense[], memberIds: string[]): BudgetSummary`, `BudgetSummary`, `EXPENSE_CATEGORIES`
  - `src/lib/preferences/couple-summary-types.ts` → `inferRatingCategory(text: string): LearnedCategory`, `LearnedCategory`
  - `src/lib/trips/itinerary-types.ts` → `ItineraryDay` (its `events: ItineraryEvent[]` already parsed)
  - `src/lib/trips/location-types.ts` → `ItineraryLocation`
- Produces (later tasks rely on these exact names/types):
  - `assembleJournal(input: JournalInput): JournalRecord`
  - `placeExpense(e: Expense, locations: ItineraryLocation[]): string | null`
  - `perCategoryCents(actual: Expense[], preTripCents: number): CategoryAmount[]`
  - Types: `JournalEvent`, `JournalExpense`, `JournalPreTripItem`, `JournalLocation`, `JournalTotals`, `JournalRecord`, `JournalInput`, `CategoryAmount`

- [ ] **Step 1: Write the failing verification script**

Create `src/lib/journal/_verify.ts`:

```ts
import assert from "node:assert/strict"
import type { Expense } from "@/lib/trips/expense-types"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { assembleJournal, placeExpense } from "@/lib/journal/journal-types"

function loc(id: string, name: string, start: string | null, end: string | null): ItineraryLocation {
  return { id, name, sortOrder: 0, startDate: start, endDate: end, budgetCents: null }
}
function day(locationId: string | null, dayDate: string, events: ItineraryDay["events"]): ItineraryDay {
  return { locationId, dayDate, events } as unknown as ItineraryDay
}
function exp(part: Partial<Expense>): Expense {
  return {
    id: "e", tripId: "t", title: "x", amountCents: 1000, currency: "EUR",
    paidBy: "u1", category: "Food", dayDate: null, locationId: null,
    isSettlement: false, createdAt: "2026-01-01", ...part,
  }
}

const kuta = loc("L1", "Kuta", "2026-06-12", "2026-06-16")
const ubud = loc("L2", "Ubud", null, null)

// placeExpense: explicit location wins; dayDate falls in Kuta's span; neither -> null
assert.equal(placeExpense(exp({ locationId: "L2" }), [kuta, ubud]), "L2")
assert.equal(placeExpense(exp({ dayDate: "2026-06-14" }), [kuta, ubud]), "L1")
assert.equal(placeExpense(exp({ dayDate: "2026-07-01" }), [kuta, ubud]), null)
assert.equal(placeExpense(exp({}), [kuta, ubud]), null)

const record = assembleJournal({
  locations: [kuta, ubud],
  days: [
    day("L1", "2026-06-12", [
      { time: "", text: "Dinner at Warung", rating: 5, note: "loved it" },
      { time: "", text: "Surf lesson" },
    ]),
    day("L2", "2026-06-18", []),
  ],
  expenses: [
    exp({ locationId: "L1", category: "Activities", amountCents: 8000, title: "Surf school" }),
    exp({ dayDate: "2026-06-13", category: "Food", amountCents: 2000, title: "Lunch" }),
    exp({ category: "Transportation", amountCents: 30000, title: "Flights" }), // unplaced
    exp({ isSettlement: true, amountCents: 5000, paidBy: "u1" }), // ignored in content/total
  ],
  preTripItems: [{ title: "Travel insurance", amountCents: 6000 }],
  memberIds: ["u1", "u2"],
})

// Kuta has events + its two expenses; Ubud (empty) is filtered out
assert.equal(record.locations.length, 1)
assert.equal(record.locations[0].name, "Kuta")
assert.equal(record.locations[0].events.length, 2)
assert.equal(record.locations[0].events[0].category, "food")
assert.equal(record.locations[0].events[1].category, "activity")
assert.equal(record.locations[0].expenses.length, 2)

// Flights are unplaced; pre-trip captured
assert.equal(record.unplacedSpend.length, 1)
assert.equal(record.unplacedSpend[0].title, "Flights")
assert.equal(record.preTrip.length, 1)
assert.equal(record.totals.preTripCents, 6000)

// total spent = actual (8000+2000+30000) + pre-trip 6000 = 46000; settlement excluded
assert.equal(record.totals.totalSpentCents, 46000)
// settle-up is expenses-only (never includes pre-trip); a settlement of 5000 by u1
assert.equal(record.totals.settleUp.expenseTotalCents, 40000)
// per-category includes a trailing Pre-trip line
assert.ok(record.totals.perCategoryCents.some((c) => c.category === "Pre-trip" && c.amountCents === 6000))
assert.equal(record.isEmpty, false)

// empty trip -> isEmpty true
const empty = assembleJournal({ locations: [ubud], days: [], expenses: [], preTripItems: [], memberIds: ["u1", "u2"] })
assert.equal(empty.isEmpty, true)
assert.equal(empty.locations.length, 0)

console.log("journal-types verify OK")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx src/lib/journal/_verify.ts`
Expected: FAIL — cannot resolve `@/lib/journal/journal-types` (module not created yet).

- [ ] **Step 3: Write the assembler + types**

Create `src/lib/journal/journal-types.ts`:

```ts
// Pure per-trip journal: a raw, location-organized record of what a couple did
// and spent. No server imports (the *-types.ts split rule) — it takes
// already-fetched domain objects and returns a plain record.

import {
  EXPENSE_CATEGORIES,
  summarizeBudget,
  type BudgetSummary,
  type Expense,
} from "@/lib/trips/expense-types"
import {
  inferRatingCategory,
  type LearnedCategory,
} from "@/lib/preferences/couple-summary-types"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

export interface JournalEvent {
  text: string
  category: LearnedCategory
  rating?: number
  note?: string
}

export interface JournalExpense {
  title: string
  amountCents: number
  category: string
}

export interface JournalPreTripItem {
  title: string
  amountCents: number
}

export interface JournalLocation {
  id: string
  name: string
  startDate: string | null
  endDate: string | null
  events: JournalEvent[]
  expenses: JournalExpense[]
}

export interface CategoryAmount {
  category: string
  amountCents: number
}

export interface JournalTotals {
  /** Actual (non-settlement) expenses + pre-trip amounts. */
  totalSpentCents: number
  perCategoryCents: CategoryAmount[]
  preTripCents: number
  /** Who-owes-whom, computed from actual expenses only (pre-trip has no payer). */
  settleUp: BudgetSummary
}

export interface JournalRecord {
  locations: JournalLocation[]
  unplacedSpend: JournalExpense[]
  preTrip: JournalPreTripItem[]
  totals: JournalTotals
  isEmpty: boolean
}

export interface JournalInput {
  locations: ItineraryLocation[]
  days: ItineraryDay[]
  expenses: Expense[]
  preTripItems: JournalPreTripItem[]
  memberIds: string[]
}

/** An expense's location: its explicit `locationId`, else the location whose
 * declared span contains its `dayDate`, else null (truly unplaced). Locations
 * with no declared span never catch date-only expenses. */
export function placeExpense(
  e: Expense,
  locations: ItineraryLocation[],
): string | null {
  if (e.locationId) return e.locationId
  const d = e.dayDate
  if (d) {
    const hit = locations.find(
      (l) => l.startDate && l.endDate && l.startDate <= d && d <= l.endDate,
    )
    if (hit) return hit.id
  }
  return null
}

/** Non-settlement spend summed per category, ordered by EXPENSE_CATEGORIES
 * (unknown categories last), with a trailing Pre-trip line when non-zero. */
export function perCategoryCents(
  actual: Expense[],
  preTripCents: number,
): CategoryAmount[] {
  const byCat = new Map<string, number>()
  for (const e of actual) {
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountCents)
  }
  const order = [...EXPENSE_CATEGORIES] as string[]
  const rank = (c: string) => {
    const i = order.indexOf(c)
    return i === -1 ? order.length : i
  }
  const rows = [...byCat.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, amountCents]) => ({ category, amountCents }))
  if (preTripCents !== 0) rows.push({ category: "Pre-trip", amountCents: preTripCents })
  return rows
}

function toJournalEvent(text: string, rating?: number, note?: string): JournalEvent {
  return {
    text,
    category: inferRatingCategory(text),
    ...(rating !== undefined ? { rating } : {}),
    ...(note ? { note } : {}),
  }
}

/** Assemble the raw journal. Pure. Settlements are excluded from content and
 * per-category totals but still feed settle-up via summarizeBudget. */
export function assembleJournal(input: JournalInput): JournalRecord {
  const { locations, days, expenses, preTripItems, memberIds } = input
  const actual = expenses.filter((e) => !e.isSettlement)

  const daysByLoc = new Map<string, ItineraryDay[]>()
  for (const d of days) {
    if (!d.locationId) continue
    const arr = daysByLoc.get(d.locationId) ?? []
    arr.push(d)
    daysByLoc.set(d.locationId, arr)
  }

  const expByLoc = new Map<string, JournalExpense[]>()
  const unplacedSpend: JournalExpense[] = []
  for (const e of actual) {
    const je: JournalExpense = {
      title: e.title,
      amountCents: e.amountCents,
      category: e.category,
    }
    const locId = placeExpense(e, locations)
    if (locId) {
      const arr = expByLoc.get(locId) ?? []
      arr.push(je)
      expByLoc.set(locId, arr)
    } else {
      unplacedSpend.push(je)
    }
  }

  const journalLocations: JournalLocation[] = locations
    .map((loc) => {
      const locDays = (daysByLoc.get(loc.id) ?? [])
        .slice()
        .sort((a, b) => (a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0))
      const events: JournalEvent[] = []
      for (const d of locDays) {
        for (const ev of d.events) {
          events.push(toJournalEvent(ev.text, ev.rating, ev.note))
        }
      }
      return {
        id: loc.id,
        name: loc.name,
        startDate: loc.startDate,
        endDate: loc.endDate,
        events,
        expenses: expByLoc.get(loc.id) ?? [],
      }
    })
    .filter((l) => l.events.length > 0 || l.expenses.length > 0)

  const preTrip = preTripItems.filter((p) => p.title.length > 0 || p.amountCents !== 0)
  const preTripCents = preTrip.reduce((s, p) => s + p.amountCents, 0)
  const actualTotal = actual.reduce((s, e) => s + e.amountCents, 0)

  const totals: JournalTotals = {
    totalSpentCents: actualTotal + preTripCents,
    perCategoryCents: perCategoryCents(actual, preTripCents),
    preTripCents,
    settleUp: summarizeBudget(expenses, memberIds),
  }

  const isEmpty =
    journalLocations.length === 0 && unplacedSpend.length === 0 && preTrip.length === 0

  return { locations: journalLocations, unplacedSpend, preTrip, totals, isEmpty }
}
```

- [ ] **Step 4: Run the verification script to verify it passes**

Run: `npx tsx src/lib/journal/_verify.ts`
Expected: prints `journal-types verify OK`, exit 0.

- [ ] **Step 5: Delete the throwaway script and lint**

Run: `rm src/lib/journal/_verify.ts && pnpm lint`
Expected: no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/journal/journal-types.ts
git commit -m "feat(journal): pure per-trip journal assembler + types"
```

---

### Task 2: Server query (`journal-queries.ts`)

**Files:**
- Create: `src/lib/journal/journal-queries.ts`

**Interfaces:**
- Consumes: `assembleJournal`, `JournalRecord`, `JournalPreTripItem` from Task 1; `getItineraryLocations` (`@/lib/trips/location-queries`); `getTripExpenses` (`@/lib/trips/expense-queries`); `rowToItineraryDay`, `ItineraryRow` (`@/lib/trips/itinerary-types`); `createClient` (`@/lib/supabase/server`).
- Produces: `getTripJournal(tripId: string, memberIds: string[]): Promise<JournalRecord>`

- [ ] **Step 1: Write the query module**

Create `src/lib/journal/journal-queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripExpenses } from "@/lib/trips/expense-queries"
import { rowToItineraryDay, type ItineraryRow } from "@/lib/trips/itinerary-types"
import {
  assembleJournal,
  type JournalPreTripItem,
  type JournalRecord,
} from "@/lib/journal/journal-types"

/** Fetch a trip's raw journal: itinerary locations + days, expenses, and the
 * before-you-go (Pre-trip) budget items, assembled into a JournalRecord. */
export async function getTripJournal(
  tripId: string,
  memberIds: string[],
): Promise<JournalRecord> {
  const supabase = await createClient()
  const [locations, expenses, dayRes, preRes] = await Promise.all([
    getItineraryLocations(tripId),
    getTripExpenses(tripId),
    supabase
      .from("itinerary_days")
      .select(
        "id, day_date, title, sub, events, tag, tone, group_id, group_name, location_id",
      )
      .eq("trip_id", tripId),
    supabase
      .from("trip_budget_items")
      .select("subject, amount_cents, sort_order")
      .eq("trip_id", tripId)
      .eq("category", "Pre-trip")
      .order("sort_order", { ascending: true }),
  ])

  const days = (dayRes.data ?? []).map((r) => rowToItineraryDay(r as ItineraryRow))
  const preTripItems: JournalPreTripItem[] = (preRes.data ?? []).map((r) => ({
    title: (r.subject as string) ?? "",
    amountCents: (r.amount_cents as number) ?? 0,
  }))

  return assembleJournal({ locations, days, expenses, preTripItems, memberIds })
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm lint && pnpm build`
Expected: lint clean; build compiles with no type errors (the new module typechecks; `getTripJournal` is not yet imported anywhere, which is fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/journal/journal-queries.ts
git commit -m "feat(journal): server query that fetches + assembles a trip journal"
```

---

### Task 3: Render component (`trip-journal.tsx`)

**Files:**
- Create: `src/app/profile/trip-journal.tsx`

**Interfaces:**
- Consumes: `JournalRecord`, `JournalLocation`, `JournalExpense` from `@/lib/journal/journal-types` (types only — this is a static server component, no `"use client"`).
- Produces: `TripJournal({ record, memberNames }: { record: JournalRecord; memberNames: Record<string, string> })`

- [ ] **Step 1: Write the component**

Create `src/app/profile/trip-journal.tsx` (mirrors the mono/small style of `trip-budget.tsx`; static, no client hooks):

```tsx
import type {
  JournalExpense,
  JournalLocation,
  JournalRecord,
} from "@/lib/journal/journal-types"

function euro(cents: number): string {
  return (cents / 100).toFixed(0)
}

function span(loc: JournalLocation): string {
  if (!loc.startDate || !loc.endDate) return ""
  return ` · ${loc.startDate} – ${loc.endDate}`
}

function ExpenseLine({ e }: { e: JournalExpense }) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
      <span className="text-muted-foreground">
        {e.title} · {e.category}
      </span>
      <span className="text-foreground">€{euro(e.amountCents)}</span>
    </div>
  )
}

function settleUpLine(
  record: JournalRecord,
  memberNames: Record<string, string>,
): string {
  const s = record.totals.settleUp
  if (!s.creditorUserId || !s.debtorUserId || s.netBalanceCents === 0) {
    return "Settled up"
  }
  const debtor = memberNames[s.debtorUserId] ?? "Someone"
  const creditor = memberNames[s.creditorUserId] ?? "Someone"
  return `${debtor} owes ${creditor} €${euro(s.netBalanceCents)}`
}

export function TripJournal({
  record,
  memberNames,
}: {
  record: JournalRecord
  memberNames: Record<string, string>
}) {
  return (
    <div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Journal
      </p>

      {record.preTrip.length > 0 ? (
        <div className="mt-2">
          <p className="font-serif text-[15px] italic text-foreground">
            Before you go
          </p>
          <div className="mt-1 flex flex-col gap-1">
            {record.preTrip.map((p, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
              >
                <span className="text-muted-foreground">{p.title}</span>
                <span className="text-foreground">€{euro(p.amountCents)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {record.locations.map((loc) => (
        <div key={loc.id} className="mt-3">
          <p className="font-serif text-[15px] italic text-foreground">
            {loc.name}
            <span className="text-muted-foreground">{span(loc)}</span>
          </p>
          {loc.events.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1">
              {loc.events.map((ev, i) => (
                <div key={i} className="text-[13px] text-foreground">
                  {ev.text}
                  {ev.rating !== undefined ? (
                    <span className="text-muted-foreground"> · {ev.rating}/5</span>
                  ) : null}
                  {ev.note ? (
                    <span className="text-muted-foreground"> — {ev.note}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {loc.expenses.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1">
              {loc.expenses.map((e, i) => (
                <ExpenseLine key={i} e={e} />
              ))}
            </div>
          ) : null}
        </div>
      ))}

      {record.unplacedSpend.length > 0 ? (
        <div className="mt-3">
          <p className="font-serif text-[15px] italic text-foreground">
            Other spend
          </p>
          <div className="mt-1 flex flex-col gap-1">
            {record.unplacedSpend.map((e, i) => (
              <ExpenseLine key={i} e={e} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-1.5">
        {record.totals.perCategoryCents.map((c) => (
          <div
            key={c.category}
            className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
          >
            <span className="text-foreground">{c.category}</span>
            <span className="text-muted-foreground">€{euro(c.amountCents)}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 border-t border-rule pt-1.5 font-mono text-[11px]">
          <span className="text-foreground">Total spent</span>
          <span className="text-foreground">
            €{euro(record.totals.totalSpentCents)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
          <span className="text-muted-foreground">Settle up</span>
          <span className="text-muted-foreground">
            {settleUpLine(record, memberNames)}
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm lint && pnpm build`
Expected: lint clean; build compiles. (Component is not yet mounted — fine.)

- [ ] **Step 3: Commit**

```bash
git add src/app/profile/trip-journal.tsx
git commit -m "feat(journal): static TripJournal render component"
```

---

### Task 4: Wire the journal into `/profile` (additive)

**Files:**
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `getTripJournal` (Task 2), `TripJournal` (Task 3), and the existing `workspace.members`, `startedTrips`, `tasteByTrip`, `budgetByTrip`, `byTripRows` already in `page.tsx`.
- Produces: journal blocks rendered under each started trip that has content; the By-trip row set widened to include journal-bearing trips. Nothing existing is removed.

- [ ] **Step 1: Add imports**

In `src/app/profile/page.tsx`, add near the other imports (after the `TripBudget` import at line 32):

```ts
import { getTripJournal } from "@/lib/journal/journal-queries"
import { TripJournal } from "./trip-journal"
```

- [ ] **Step 2: Compute members + per-trip journals**

In `page.tsx`, after `startedTrips` is defined (currently line 73) and before `byTripRows`, add:

```ts
  const memberIds = workspace.members.map((m) => m.user_id)
  const memberNames = Object.fromEntries(
    workspace.members.map((m) => [m.user_id, m.display_name]),
  )
  const journals = await Promise.all(
    startedTrips.map(async (trip) => ({
      tripId: trip.id,
      record: await getTripJournal(trip.id, memberIds),
    })),
  )
  const journalByTrip = new Map(
    journals.filter((j) => !j.record.isEmpty).map((j) => [j.tripId, j.record]),
  )
```

- [ ] **Step 3: Widen `byTripRows` to include journal-bearing trips and carry the record**

Replace the existing `byTripRows` block (currently lines 87-93):

```ts
  const byTripRows = startedTrips
    .filter((t) => tasteByTrip.has(t.id) || budgetByTrip.has(t.id))
    .map((t) => ({
      trip: t,
      blocks: tasteByTrip.get(t.id) ?? [],
      budget: budgetByTrip.get(t.id) ?? null,
    }))
```

with:

```ts
  const byTripRows = startedTrips
    .filter(
      (t) =>
        tasteByTrip.has(t.id) ||
        budgetByTrip.has(t.id) ||
        journalByTrip.has(t.id),
    )
    .map((t) => ({
      trip: t,
      blocks: tasteByTrip.get(t.id) ?? [],
      budget: budgetByTrip.get(t.id) ?? null,
      journal: journalByTrip.get(t.id) ?? null,
    }))
```

- [ ] **Step 4: Render the journal in the By-trip row**

In the By-trip map (currently the block starting `byTripRows.map(({ trip, blocks, budget }) => (` around line 267), update the destructure to include `journal` and render `TripJournal` after the taste `blocks` and before `TripBudget`.

Change the destructure line:

```tsx
                {byTripRows.map(({ trip, blocks, budget, journal }) => (
```

Then, immediately after the taste `blocks.map(...)` block closes and before `{budget ? <TripBudget summary={budget} /> : null}`, insert:

```tsx
                    {journal ? (
                      <TripJournal record={journal} memberNames={memberNames} />
                    ) : null}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm lint && pnpm build`
Expected: lint clean; build compiles with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(journal): render per-trip journal on /profile (additive)"
```

- [ ] **Step 7: Manual in-app check (requires a logged-in session)**

Run `pnpm dev`, open `/profile`. For a started trip with itinerary events and/or expenses, confirm a **Journal** block appears under the trip heading showing: a Before-you-go section (if Pre-trip items exist), each location with its events (ratings/notes) and its spend, an Other spend section (for unplaced expenses), and totals where **Total spent includes pre-trip** while **Settle up** reflects expenses only. Confirm a dream/empty trip shows no Journal block, and that the existing taste blocks + Trip budget widget are unchanged.

---

## Self-Review

**Spec coverage:**
- Derived-not-stored assembler → Task 1. ✓
- Location backbone (events + placed expenses per location) → Task 1 `assembleJournal`, Task 3 render. ✓
- Date-inferred placement of dated-but-unplaced expenses → Task 1 `placeExpense`. ✓
- Unplaced spend bucket → Task 1. ✓
- Pre-trip section from `trip_budget_items` category "Pre-trip" → Task 2 fetch, Task 1 totals, Task 3 render. ✓
- Total spent = actual + pre-trip; settle-up = expenses only → Task 1 `JournalTotals`; verified in Task 1 script; rendered in Task 3. ✓
- "Enough happened" floor (empty locations filtered, `isEmpty`) → Task 1; gating in Task 4. ✓
- Additive surface on `/profile` By-trip section, nothing removed → Task 4. ✓
- No AI / no migration / no deletion → whole plan. ✓
- Settle-up as a single computed spot (design guard for the parked pre-trip payer item) → Task 1: `summarizeBudget(...)` called once in `assembleJournal`. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✓

**Type consistency:** `assembleJournal` / `placeExpense` / `perCategoryCents` / `getTripJournal` / `TripJournal` and all `Journal*` types are used with identical names and signatures across Tasks 1–4. `JournalTotals.settleUp` is a `BudgetSummary`; Task 3 reads its real fields (`creditorUserId`, `debtorUserId`, `netBalanceCents`, `expenseTotalCents`). ✓

**Known Slice-1 limitations (intentional, out of scope):** events on days with `location_id = null` (travel/transit days) are not shown; date-inference uses declared location spans only (locations with implied spans do not catch date-only expenses). Both are acceptable for a raw first slice and can be revisited if felt.
