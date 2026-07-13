# Add an Expense from an Itinerary Event — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user tap a specific event in an itinerary day and log a real expense against it, inheriting the event's title, day, and location.

**Architecture:** A new compact client component (`EventExpense`) renders under each event row. Collapsed it is a small `€ +` button; expanded it shows amount + category + paid-by and calls the existing `logExpense` server action. Title/day/location are inherited from the event and its day, so they are not shown. The itinerary itself does not change. Three new props (`categories`, `members`, `currentUserId`) are threaded from `page.tsx` down the existing render chain to the event row.

**Tech Stack:** Next.js 16 App Router, React 19 client component, TypeScript, Tailwind v4, existing `logExpense` Supabase server action.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-13-event-expense-design.md`. This is the base feature only; the "carry discovery category" slice is deferred.
- **No test infra.** This repo has no test runner (CLAUDE.md: "There are no tests yet; do not invent a test command"). Verification for every task is `pnpm lint` (clean) + `pnpm build` (success) + manual observation in `pnpm dev`. Do not add a test framework.
- **No DB migration.** Expenses use the existing `expenses` table and `logExpense` action unchanged. No event schema change.
- **Reuse, don't fork.** Call `logExpense` as-is; mirror the compact `QuickExpense` layout. Do not build a new server action or a new full expense form.
- **Workspace, not couple.** The paid-by control must handle any member count: pill toggle when exactly 2 members, plain `<select>` otherwise. Do not hard-code 2.
- **No emojis in code.** The `€` currency glyph and `×`/`…` UI glyphs used here are UI text, not emojis — they match existing components (`QuickExpense`, `DayView`).
- **Currency is EUR** (`logExpense` hard-codes `currency: "EUR"`); the amount field shows a `€` prefix to match `QuickExpense`.
- **European date order** if any date is ever displayed (none is in this feature).
- **Windows dev flake:** if `pnpm dev` panics with `0xc0000142`, stop, delete `.next/`, restart — it is not a code bug.

---

### Task 1: Build the `EventExpense` compact client component

Self-contained new component, imported nowhere yet. Deliverable: it compiles and lints. It cannot be manually exercised until Task 2 renders it.

**Files:**
- Create: `src/app/trips/[slug]/event-expense.tsx`

**Interfaces:**
- Consumes:
  - `logExpense` from `@/lib/trips/actions` — `logExpense(input: LogExpenseInput): Promise<{ error?: string }>` where `LogExpenseInput = { tripId, tripSlug, title, amount, category, paidBy, dayDate: string | null, locationId: string | null }` (all strings except the two nullable fields).
  - `ExpenseCategoryRow` from `@/lib/trips/expense-types` — `{ id: string; name: string; ... }`.
  - `MemberToneEntry` from `./packing-tab` — `{ initial: string; displayName: string; tone: "sea" | "clay" }`.
- Produces:
  - `EventExpense` React component with props `EventExpenseProps` (exported): `{ tripId: string; tripSlug: string; eventText: string; dayDate: string; locationId: string | null; currentUserId: string; categories: ExpenseCategoryRow[]; members: Record<string, MemberToneEntry> }`.

- [ ] **Step 1: Write the component**

Create `src/app/trips/[slug]/event-expense.tsx`:

```tsx
"use client"

import * as React from "react"

import { logExpense } from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { MemberToneEntry } from "./packing-tab"

export interface EventExpenseProps {
  tripId: string
  tripSlug: string
  /** Expense title; the event's own text. */
  eventText: string
  /** Inherited from the event's day. */
  dayDate: string
  locationId: string | null
  currentUserId: string
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
}

/**
 * Compact "log a real expense against this event" control. Collapsed to a small
 * button; expands to amount + category + paid-by. Title, day, and location are
 * inherited from the event and its day, so they are not shown. Writes an
 * `expenses` row via `logExpense`; the itinerary itself does not change.
 */
export function EventExpense({
  tripId,
  tripSlug,
  eventText,
  dayDate,
  locationId,
  currentUserId,
  categories,
  members,
}: EventExpenseProps) {
  const [open, setOpen] = React.useState(false)
  const [amount, setAmount] = React.useState("")
  const [category, setCategory] = React.useState(categories[0]?.name ?? "")
  const [paidBy, setPaidBy] = React.useState(currentUserId)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit = Number.isFinite(Number(amount)) && Number(amount) > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !canSubmit) return
    startTransition(async () => {
      const result = await logExpense({
        tripId,
        tripSlug,
        title: eventText.trim() || "Expense",
        amount,
        category,
        paidBy,
        dayDate,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setAmount("")
      setError(null)
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add an expense for this event"
        className="mt-0.5 border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
      >
        + expense
      </button>
    )
  }

  const memberEntries = Object.entries(members)

  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <div className="flex w-24 items-baseline gap-1 rounded-lg border border-border bg-background px-2 py-1">
          <span className="font-mono text-[13px] text-muted-foreground">€</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            disabled={isPending}
            className="t-num w-full border-0 bg-transparent font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={isPending}
          className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        {memberEntries.length === 2 ? (
          <div className="inline-flex rounded-full border border-border bg-background p-0.5">
            {memberEntries.map(([userId, m]) => {
              const activePill = userId === paidBy
              return (
                <button
                  key={userId}
                  type="button"
                  onClick={() => setPaidBy(userId)}
                  disabled={isPending}
                  aria-pressed={activePill}
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                    activePill
                      ? m.tone === "sea"
                        ? "bg-sea text-background"
                        : "bg-clay text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.initial}
                </button>
              )
            })}
          </div>
        ) : (
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
            disabled={isPending}
            className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
          >
            {memberEntries.map(([userId, m]) => (
              <option key={userId} value={userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={isPending || !canSubmit}
          className="rounded-full border-0 bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={isPending}
          aria-label="Cancel"
          className="border-0 bg-transparent px-1 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 2: Lint the new file**

Run: `pnpm lint`
Expected: no errors. (An exported-but-unimported component is fine — it is wired in Task 2.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/event-expense.tsx
git commit -m "feat(itinerary): add EventExpense compact log-expense control"
```

---

### Task 2: Thread expense context to the event row and render `EventExpense`

Wire the three new props from `page.tsx` through `ItineraryTab` -> `DaySegmentView` -> `DayCard` -> `DayView`, and render `<EventExpense>` under each event. This is the task that makes the feature visible and testable end to end.

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx:264-275` (the `<ItineraryTab .../>` render)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` — `ItineraryTab` props (`:295-317`), both `<DaySegmentView>` call sites (`:693-705`, `:966-980`), `DaySegmentView` signature + its `<DayCard>` (`:1107-1146`), `DayCard` props + its `<DayView>` (`:1212-1262`), `DayView` props + event row (`:1266-1358`)

**Interfaces:**
- Consumes: `EventExpense` / `EventExpenseProps` from `./event-expense` (Task 1).
- Consumes (already in scope at `page.tsx` render site): `expenseCategories` (`ExpenseCategoryRow[]`), `memberTones` (`Record<string, MemberToneEntry>`), `userData.user.id` (string).
- Produces: nothing new consumed by later tasks (final task).

- [ ] **Step 1: Pass the three props into `<ItineraryTab>` in `page.tsx`**

At `src/app/trips/[slug]/page.tsx`, in the `<ItineraryTab ... />` block (around line 264), add three props after `budgetItems`:

```tsx
            <ItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              tripName={header.name}
              destination={header.country ?? header.name}
              tripStartDate={header.startDate}
              tripEndDate={header.endDate ?? header.startDate}
              today={await localToday()}
              initialItems={datedItinerary ?? []}
              initialLocations={locations ?? []}
              budgetItems={budgetItems ?? []}
              categories={expenseCategories ?? []}
              members={memberTones}
              currentUserId={userData.user.id}
            />
```

- [ ] **Step 2: Add the props to `ItineraryTab`**

In `src/app/trips/[slug]/itinerary-tab.tsx`, add imports near the other type imports at the top of the file:

```tsx
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { MemberToneEntry } from "./packing-tab"
```

Extend the `ItineraryTab` destructure (line ~295) and its inline prop type (line ~306):

```tsx
export function ItineraryTab({
  tripId,
  tripSlug,
  tripName,
  destination,
  tripStartDate,
  tripEndDate,
  today,
  initialItems,
  initialLocations,
  budgetItems,
  categories,
  members,
  currentUserId,
}: {
  tripId: string
  tripSlug: string
  tripName: string
  destination: string
  tripStartDate: string
  tripEndDate: string
  today: string
  initialItems: ItineraryDay[]
  initialLocations: ItineraryLocation[]
  budgetItems: BudgetItem[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentUserId: string
}) {
```

- [ ] **Step 3: Forward the props at BOTH `<DaySegmentView>` call sites**

There are two (line ~693 and line ~966). Add the same three props to each, after `today={...}`:

```tsx
                    today={today}
                    categories={categories}
                    members={members}
                    currentUserId={currentUserId}
```

(At the line ~693 site the closing `/>` follows `today={today}`; at the ~966 site likewise. Add the three lines before the `/>` in both.)

- [ ] **Step 4: Add the props to `DaySegmentView` and forward to `<DayCard>`**

In the `DaySegmentView` signature (line ~1107), add to the destructure and the inline type:

```tsx
  dimBefore,
  today,
  categories,
  members,
  currentUserId,
}: {
  seg: DaySegment
  tripId: string
  tripSlug: string
  lastDayId: string
  editingId: string | null
  setEditingId: (id: string | null) => void
  locations: ItineraryLocation[]
  collapsedDays: Set<string>
  toggleDay: (id: string) => void
  dimBefore: string | null
  today: string
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentUserId: string
}) {
```

In the `<DayCard ... />` inside `DaySegmentView` (line ~1133), add the three props after `locations={locations}`:

```tsx
      locations={locations}
      categories={categories}
      members={members}
      currentUserId={currentUserId}
    />
```

- [ ] **Step 5: Add the props to `DayCard` and forward to `<DayView>`**

Extend `DayCardProps` (line ~1212) and the destructure (line ~1227):

```tsx
interface DayCardProps {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  expanded: boolean
  onToggle: () => void
  dimBefore: string | null
  today: string
  onStartEdit: () => void
  onStopEdit: () => void
  dragHandle?: React.ReactNode
  locations: ItineraryLocation[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentUserId: string
}
```

Add `categories`, `members`, `currentUserId` to the `DayCard({...})` destructure, then pass them to `<DayView>` (line ~1252), after `dragHandle={dragHandle}`:

```tsx
      onStartEdit={onStartEdit}
      dragHandle={dragHandle}
      categories={categories}
      members={members}
      currentUserId={currentUserId}
    />
```

(Note: `DayEditor` at line ~1243 does NOT need these props — only `DayView` renders events.)

- [ ] **Step 6: Add the props to `DayView` and render `<EventExpense>` per event**

Add the import at the top of the file:

```tsx
import { EventExpense } from "./event-expense"
```

Extend the `DayView` destructure and inline type (line ~1266):

```tsx
  onStartEdit,
  dragHandle,
  categories,
  members,
  currentUserId,
}: {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  expanded: boolean
  onToggle: () => void
  dimBefore: string | null
  today: string
  onStartEdit: () => void
  dragHandle?: React.ReactNode
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentUserId: string
}) {
```

In the event map (line ~1328), render `<EventExpense>` after the inline text row and before the `EventRating` block. `tripId` is not a `DayView` prop, so read it — actually `DayView` has no `tripId`; use the day's trip via a new prop is unnecessary because `EventExpense` needs `tripId`. `tripId` IS available in `ItineraryTab` scope but not threaded to `DayView`. Thread it: add `tripId` to `DayCard`/`DayView` as well OR pass it through. To keep this minimal, add `tripId` to the `DayView` (and `DayCard`) props too.

Update `DayCardProps` and `DayCard` destructure to also include `tripId: string`, forward it from `DaySegmentView` (which already has `tripId` in scope) into `<DayCard tripId={tripId} .../>`, and from `DayCard` into `<DayView tripId={tripId} .../>`. Add `tripId: string` to the `DayView` inline type and destructure.

Then the event map becomes:

```tsx
              {sortEvents(day.events).map((ev, i) => (
                <div key={i}>
                  <div className="flex gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
                    {ev.time ? (
                      <span className="t-num shrink-0 whitespace-nowrap text-foreground/70">
                        {formatEventTime(ev.time, ev.endTime)}
                      </span>
                    ) : null}
                    <span>{ev.text}</span>
                    {ev.url ? (
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
                      >
                        ↗ source
                      </a>
                    ) : null}
                  </div>
                  <EventExpense
                    tripId={tripId}
                    tripSlug={tripSlug}
                    eventText={ev.text}
                    dayDate={day.dayDate}
                    locationId={day.locationId}
                    currentUserId={currentUserId}
                    categories={categories}
                    members={members}
                  />
                  {day.dayDate < today ? (
                    <EventRating
                      tripSlug={tripSlug}
                      dayId={day.id}
                      eventIndex={i}
                      rating={ev.rating}
                      note={ev.note}
                    />
                  ) : null}
                </div>
              ))}
```

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: no errors, no unused-var warnings (every threaded prop is consumed).

- [ ] **Step 8: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 9: Manual end-to-end check**

Run: `pnpm dev` (if it panics with `0xc0000142`, delete `.next/` and retry).
Then:
1. Open a trip, go to the Itinerary tab, expand a day that has at least one event.
2. Confirm each event shows a `+ expense` button beneath it.
3. Click it: amount + category + paid-by + `add` appear. Category defaults to the first category; paid-by defaults to you.
4. Enter an amount (e.g. `20`), click `add`. The form collapses back to `+ expense`. The event text and day are unchanged.
5. Go to the Budget tab. Confirm a new expense exists with **title = the event's text**, the amount you entered, the chosen category and payer, and dated to that day.
6. If the day is filed under a location, confirm the expense appears under that location in budget-by-location.

Expected: all six hold. If the expense title is empty or the amount is wrong, stop and diagnose before committing (trace the write path client -> `logExpense` -> `expenses` insert).

- [ ] **Step 10: Commit**

```bash
git add src/app/trips/[slug]/page.tsx src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): log an expense against a specific event"
```

- [ ] **Step 11: Update docs**

Add a line to `docs/TODO.md` recording that event-level expense logging shipped, and note the deferred "carry discovery category onto the event" follow-up slice. Commit:

```bash
git add docs/TODO.md
git commit -m "docs: record event-expense feature and follow-up slice"
```

---

## Self-Review

**Spec coverage:**
- "Tap an event, log a real expense into the budget" -> Task 1 (`EventExpense` calls `logExpense`) + Task 2 (rendered per event). Covered.
- "Amount required; category + paid-by editable with defaults" -> Task 1 form. Covered.
- "Title/day/location inherited silently" -> Task 1 (`title: eventText`, `dayDate`, `locationId` passed, not shown as fields) + Task 2 (values from `day`). Covered.
- "Itinerary unchanged, no event schema change" -> no event-type edit anywhere; `EventExpense` writes only to `expenses`. Covered.
- "Reuse `logExpense`, mirror `QuickExpense`" -> Task 1 imports and calls `logExpense`; layout mirrors `QuickExpense`. Covered.
- "Thread `categories`, `members`, `currentUserId` from `page.tsx`" -> Task 2 steps 1-6. Covered. (`tripId` also threaded to `DayView`, a detail the spec implies.)
- "Works both modes" -> behavior is date-independent; no mode branch. Covered.
- Out-of-scope items (no back-link, no edit-from-itinerary, no running total, discovery category deferred) -> none implemented. Correct.

**Placeholder scan:** No TBD/TODO-in-code, no "add error handling" hand-waves — the error path is the explicit `result.error` branch. Clear.

**Type consistency:** `EventExpenseProps` field names/types in Task 1 match the `<EventExpense>` usage in Task 2 step 6. `MemberToneEntry` and `ExpenseCategoryRow` imported from the same paths in both the new component and `itinerary-tab.tsx`. `logExpense` input matches `LogExpenseInput` verbatim. Consistent.

One noted deviation from the skill's TDD default: this repo has no test infrastructure and CLAUDE.md forbids inventing one, so tasks verify via lint + build + manual observation instead of automated tests. This is intentional and called out in Global Constraints.
