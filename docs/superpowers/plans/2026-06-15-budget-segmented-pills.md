# Budget Segmented Pill Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the budget tab a packing-style pill bar (Budget / Saved / Settle up) that switches between three views instead of one long scroll.

**Architecture:** Lift packing's segment button into the shared `together` component library, then convert `BudgetTab` to a client component with a `view` state that conditionally renders each section. `BudgetFigures` is split into a spent block and a saved block so each figure can render under its own pill. Pure presentation — no data-model, query, or server-action changes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4. No test framework exists in this repo, so each task is verified with `pnpm lint`, `pnpm build`, and a visual check at http://localhost:3000.

---

## File Structure

- **Create** `src/components/together/seg-btn.tsx` — shared pill button with a `tone` prop (`"clay" | "sea"`). One responsibility: render one segment pill.
- **Modify** `src/components/together/index.ts` — export `SegBtn`.
- **Modify** `src/app/trips/[slug]/packing-tab.tsx` — drop the local `SegBtn`, import the shared one (clay tone). No behavior change.
- **Modify** `src/app/trips/[slug]/budget-figures.tsx` — split the single `BudgetFigures` into two exported components: `SpentFigure` (spent block + bar) and `SavedFigure` (saved block + bar + `SavingsDetails`).
- **Modify** `src/app/trips/[slug]/budget-tab.tsx` — `"use client"`, add `view` state, render the pill bar in the header, conditionally render content per view.

A reviewer should be able to read each file alone: `seg-btn.tsx` is a leaf UI atom; `budget-figures.tsx` owns the figure blocks; `budget-tab.tsx` owns layout + view switching.

---

## Task 1: Shared `SegBtn` component

**Files:**
- Create: `src/components/together/seg-btn.tsx`
- Modify: `src/components/together/index.ts`

- [ ] **Step 1: Create the component**

Mirror packing's existing pill exactly (`packing-tab.tsx:333-357`), adding a `tone` prop. The active style swaps clay for sea per tone; inactive style is identical for both.

```tsx
export type SegTone = "clay" | "sea"

export interface SegBtnProps {
  active: boolean
  onClick: () => void
  tone?: SegTone
  children: React.ReactNode
}

const ACTIVE: Record<SegTone, string> = {
  clay: "border-clay bg-clay text-background",
  sea: "border-sea bg-sea text-background",
}

export function SegBtn({ active, onClick, tone = "clay", children }: SegBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors " +
        (active
          ? ACTIVE[tone]
          : "border-rule bg-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  )
}
```

Add the React import at the top: `import * as React from "react"`.

- [ ] **Step 2: Export it from the barrel**

Add to `src/components/together/index.ts`:

```ts
export { SegBtn, type SegBtnProps, type SegTone } from "./seg-btn"
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS (no new errors). The component is unused so far, which is fine.

- [ ] **Step 4: Commit**

```bash
git add src/components/together/seg-btn.tsx src/components/together/index.ts
git commit -m "feat(together): shared SegBtn pill (clay/sea tone)"
```

---

## Task 2: Refactor packing to the shared `SegBtn`

**Files:**
- Modify: `src/app/trips/[slug]/packing-tab.tsx`

This is a no-visual-change refactor: packing keeps the clay tone it already had.

- [ ] **Step 1: Import the shared SegBtn**

In the `@/components/together` import block at the top of `packing-tab.tsx` (currently `CheckRow, Coord, Label, SuggestionCard, TopoBg`), add `SegBtn`:

```tsx
import { CheckRow, Coord, Label, SegBtn, SuggestionCard, TopoBg } from "@/components/together"
```

- [ ] **Step 2: Delete the local SegBtn**

Remove the entire local `function SegBtn({ ... }) { ... }` definition (`packing-tab.tsx:333-357`). The three call sites (`packing-tab.tsx:278-288`) need no change — they already pass `active`, `onClick`, and children, and default `tone="clay"` matches.

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS. No unused-symbol warning for the removed function.

- [ ] **Step 4: Visual check**

Run `pnpm dev`, open a trip's Packing tab. The My list / Shared / Partner pills look and behave exactly as before (clay active state).

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/packing-tab.tsx
git commit -m "refactor(packing): use shared SegBtn"
```

---

## Task 3: Split `BudgetFigures` into `SpentFigure` and `SavedFigure`

**Files:**
- Modify: `src/app/trips/[slug]/budget-figures.tsx`

Today `BudgetFigures` (`budget-figures.tsx:137-254`) renders the spent block (`:165-197`) and the saved block (`:199-251`) one after the other. Split them into two exported components so each can live under its own pill. Keep `AmountField`, `SavingsDetails`, `fmt`, and `Cue` unchanged.

- [ ] **Step 1: Replace `BudgetFigures` with two components**

Delete the `BudgetFigures` function and `BudgetFiguresProps` interface, and replace with the two below. Each computes only the values it needs.

```tsx
export interface SpentFigureProps {
  tripId: string
  tripSlug: string
  spentCents: number
  plannedBudgetCents: number
}

export function SpentFigure({
  tripId,
  tripSlug,
  spentCents,
  plannedBudgetCents,
}: SpentFigureProps) {
  const hasPlanned = plannedBudgetCents > 0
  const leftCents = Math.max(0, plannedBudgetCents - spentCents)
  const spentPct = hasPlanned
    ? Math.min(100, Math.round((spentCents / plannedBudgetCents) * 100))
    : 0

  const savePlanned = (cents: number) =>
    updateTripBudget({ tripId, tripSlug, plannedBudgetCents: cents })

  return (
    <>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="t-display text-[22px] text-muted-foreground">€</span>
        <span className="t-display t-num text-[42px] leading-none text-foreground">
          {fmt(spentCents)}
        </span>
        <AmountField
          valueCents={plannedBudgetCents}
          onSave={savePlanned}
          trigger={
            hasPlanned ? (
              <span className="t-display text-[22px] text-muted-foreground">
                {" "}/ €{fmt(plannedBudgetCents)}
              </span>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                + set a budget
              </span>
            )
          }
        />
      </div>

      {hasPlanned ? (
        <>
          <div className="mt-3">
            <Bar pct={spentPct} tone="sea" />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>{spentPct}% of planned</span>
            <span>€{fmt(leftCents)} left</span>
          </div>
        </>
      ) : null}
    </>
  )
}

export interface SavedFigureProps {
  tripId: string
  tripSlug: string
  plannedBudgetCents: number
  savedCents: number
  contributions: SavingsContribution[]
  perUser: Record<string, number>
  members: Record<string, MemberToneEntry>
}

export function SavedFigure({
  tripId,
  tripSlug,
  plannedBudgetCents,
  savedCents,
  contributions,
  perUser,
  members,
}: SavedFigureProps) {
  const [expanded, setExpanded] = React.useState(false)
  const hasPlanned = plannedBudgetCents > 0
  const savedToGo = Math.max(0, plannedBudgetCents - savedCents)
  const savedPct = hasPlanned
    ? Math.min(100, Math.round((savedCents / plannedBudgetCents) * 100))
    : 0

  const saveSaved = (cents: number) =>
    addSavingsContribution({ tripId, tripSlug, amountCents: cents })

  return (
    <div className="mt-2">
      <div className="flex items-baseline gap-1">
        <span className="t-display text-[18px] text-muted-foreground">€</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="t-display t-num border-0 bg-transparent p-0 text-[28px] leading-none text-foreground"
        >
          {fmt(savedCents)}
        </button>
        <AmountField
          additive
          valueCents={savedCents}
          onSave={saveSaved}
          trigger={
            savedCents > 0 ? (
              hasPlanned ? (
                <span className="t-display text-[18px] text-muted-foreground">
                  {" "}/ €{fmt(plannedBudgetCents)}
                </span>
              ) : (
                <span className="t-display text-[18px] text-muted-foreground" />
              )
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                + set savings
              </span>
            )
          }
        />
      </div>
      {hasPlanned && savedCents > 0 ? (
        <>
          <div className="mt-3">
            <Bar pct={savedPct} tone="moss" />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>{savedPct}% saved</span>
            <span>€{fmt(savedToGo)} to go</span>
          </div>
        </>
      ) : null}
      {expanded ? (
        <SavingsDetails
          contributions={contributions}
          perUser={perUser}
          members={members}
          tripSlug={tripSlug}
        />
      ) : null}
    </div>
  )
}
```

Note: the old saved block had a `Label`("Saved so far") + `mt-5` wrapper that belonged to the stacked layout. In the new design the pill labels the view, so the `Label` is dropped and the wrapper margin reduced to `mt-2` to sit under the header pills. The `Label` import may now be unused in this file — remove it from the `@/components/together` import if so (Step 2 verifies).

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: build FAILS at `budget-tab.tsx` because it still imports `BudgetFigures` (fixed in Task 4). Lint should flag no *new* issues inside `budget-figures.tsx` itself (watch for an unused `Label` import — remove it if reported).

Because the build break is expected and resolved in the next task, commit and proceed.

- [ ] **Step 3: Commit**

```bash
git add src/app/trips/[slug]/budget-figures.tsx
git commit -m "refactor(budget): split BudgetFigures into SpentFigure + SavedFigure"
```

---

## Task 4: Convert `BudgetTab` to client + add the pill bar

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the whole file with the version below. Changes from today: `"use client"` + React import; `view` state; pill bar in the header; per-view figure (`SpentFigure` / `SavedFigure` / none); content conditionally rendered per pill. `SplitBreakdown` and `fmt` stay as-is. The `BudgetHeader` helper is inlined into the component because it now needs the `view` state and pills.

```tsx
"use client"

import * as React from "react"

import { Avatar, Label, SegBtn, TopoBg } from "@/components/together"
import {
  type BudgetSummary,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import { type SavingsContribution } from "@/lib/trips/savings-types"
import {
  type BudgetMove,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import { type ItineraryLocation } from "@/lib/trips/location-types"

import { BudgetByLocation } from "./budget-by-location"
import { SavedFigure, SpentFigure } from "./budget-figures"
import { Ledger } from "./budget-ledger"
import { LogExpenseRow } from "./log-expense-row"
import type { MemberToneEntry } from "./packing-tab"
import { SettleUpCard } from "./settle-up-card"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

type View = "budget" | "saved" | "settle"

export interface BudgetTabProps {
  tripId: string
  tripSlug: string
  tripName: string
  expenses: Expense[]
  expenseCategories: ExpenseCategoryRow[]
  summary: BudgetSummary
  members: Record<string, MemberToneEntry>
  plannedBudgetCents: number
  savedCents: number
  savingsContributions: SavingsContribution[]
  savedPerUser: Record<string, number>
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  moves: BudgetMove[]
  currentUserId: string
}

export function BudgetTab({
  tripId,
  tripSlug,
  tripName,
  expenses,
  expenseCategories,
  summary,
  members,
  plannedBudgetCents,
  savedCents,
  savingsContributions,
  savedPerUser,
  locations,
  itineraryDays,
  moves,
  currentUserId,
}: BudgetTabProps) {
  const [view, setView] = React.useState<View>("budget")
  const totalCents = summary.expenseTotalCents
  const isSettled = summary.netBalanceCents === 0
  const creditor = summary.creditorUserId ? members[summary.creditorUserId] : null
  const debtor = summary.debtorUserId ? members[summary.debtorUserId] : null

  return (
    <section>
      <div className="relative overflow-hidden bg-dusk-tint px-5 pt-6 pb-4">
        <TopoBg tone="sea" opacity={0.1} />
        <div className="relative">
          <Label>Budget · {tripName}</Label>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <SegBtn tone="sea" active={view === "budget"} onClick={() => setView("budget")}>
              Budget
            </SegBtn>
            <SegBtn tone="sea" active={view === "saved"} onClick={() => setView("saved")}>
              Saved
            </SegBtn>
            <SegBtn tone="sea" active={view === "settle"} onClick={() => setView("settle")}>
              Settle up
            </SegBtn>
          </div>
          {view === "budget" ? (
            <SpentFigure
              tripId={tripId}
              tripSlug={tripSlug}
              spentCents={totalCents}
              plannedBudgetCents={plannedBudgetCents}
            />
          ) : null}
          {view === "saved" ? (
            <SavedFigure
              tripId={tripId}
              tripSlug={tripSlug}
              plannedBudgetCents={plannedBudgetCents}
              savedCents={savedCents}
              contributions={savingsContributions}
              perUser={savedPerUser}
              members={members}
            />
          ) : null}
        </div>
      </div>

      {view === "budget" ? (
        <>
          <LogExpenseRow
            tripId={tripId}
            tripSlug={tripSlug}
            currentUserId={currentUserId}
            members={members}
            locations={locations}
            categories={expenseCategories}
          />
          <BudgetByLocation
            tripId={tripId}
            tripSlug={tripSlug}
            masterBudgetCents={plannedBudgetCents}
            locations={locations}
            expenses={expenses}
            itineraryDays={itineraryDays}
            members={members}
            moves={moves}
            categories={expenseCategories}
          />
          <Ledger
            expenses={expenses}
            moves={moves}
            members={members}
            tripSlug={tripSlug}
            locations={locations}
            itineraryDays={itineraryDays}
            categories={expenseCategories}
          />
        </>
      ) : null}

      {view === "settle" ? (
        <>
          <SettleUpCard
            isSettled={isSettled}
            netBalanceCents={summary.netBalanceCents}
            creditor={creditor}
            debtor={debtor}
            tripId={tripId}
            tripSlug={tripSlug}
          />
          <SplitBreakdown members={members} paidByUser={summary.expensePaidByUser} />
        </>
      ) : null}
    </section>
  )
}

function SplitBreakdown({
  members,
  paidByUser,
}: {
  members: Record<string, MemberToneEntry>
  paidByUser: Record<string, number>
}) {
  const entries = Object.entries(members)
  if (entries.length !== 2) return null
  return (
    <div className="px-5 pb-3 pt-3">
      <div className="grid grid-cols-2 gap-2.5">
        {entries.map(([userId, member]) => (
          <div
            key={userId}
            className="rounded-lg border border-border bg-card px-3.5 py-3"
          >
            <div className="flex items-center gap-2">
              <Avatar name={member.initial} size={18} tone={member.tone} />
              <span className="font-serif text-[14px] italic text-foreground">
                {member.displayName}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              paid
            </div>
            <div className="t-num mt-0.5 text-[22px] text-foreground">
              €{fmt(paidByUser[userId] ?? 0)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Note: `SplitBreakdown`'s wrapper gained `pt-3` because it no longer follows the settle-up card inside a stack with its own top spacing — verify visually in Step 3 and adjust if it looks tight.

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS. The Task 3 build break is now resolved (no more `BudgetFigures` import).

- [ ] **Step 3: Visual check**

Run `pnpm dev`, open a trip's Budget tab:
- Three sea-toned pills appear under "Budget · {name}"; Budget is active by default.
- **Budget**: spent/planned figure + sea bar, then log expense, by-location, ledger.
- **Saved**: saved figure + moss bar; tapping the saved number expands the contributions log.
- **Settle up**: settle-up card + the two paid-by cards. No big figure in the header.
- Inline edits still work: "+ set a budget" / edit budget, "+ set savings" / add savings.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(budget): segmented pill bar (Budget/Saved/Settle up)"
```

---

## Task 5: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record the task in TODO.md**

Add a line under the appropriate completed/recent section noting the budget tab now uses a Budget / Saved / Settle up pill bar (matching packing).

- [ ] **Step 2: Record the decision in DECISIONS.md**

Append a row: budget reorganized from a single stacked view into a three-pill segmented view (Budget / Saved / Settle up) to match packing; `SegBtn` lifted into the shared `together` library; `BudgetFigures` split into `SpentFigure` + `SavedFigure`.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record budget segmented pill bar"
```

---

## Self-Review

**Spec coverage:**
- Pill bar matching packing → Task 1 (shared SegBtn) + Task 4 (rendered in header). ✓
- Three pills Budget / Saved / Settle up → Task 4. ✓
- Section mapping (Spend / Save / Settle) → Task 4 conditional rendering. ✓
- Figure below pills, per view → Task 3 (split) + Task 4 (per-view render). ✓
- `BudgetTab` → client component → Task 4. ✓
- Lift SegBtn to shared → Task 1 + Task 2 (packing refactor). ✓
- No data/query changes → confirmed; only presentation files touched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `View` = `"budget" | "saved" | "settle"` (Task 4) matches the pills. `SpentFigure`/`SavedFigure` prop names in Task 3 match the call sites in Task 4. `SegBtn` `tone` prop (Task 1) matches usage in packing (default clay) and budget (`tone="sea"`). ✓
