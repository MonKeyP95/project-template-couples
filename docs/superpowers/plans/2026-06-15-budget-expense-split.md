# Budget / Expense Split + Compact Settle-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Budget tab's `Budget` pill into `Budget` (planning) + `Expense` (tracking), add a compact settle-up strip to both, and give the Settle up pill the settlement history.

**Architecture:** Extract a reusable `SettleUpButtons` from `SettleUpCard`, then edit `budget-tab.tsx`: widen the `View` union, add the Expense pill + spent-total header, move add-expense + ledger under Expense, render a compact settle strip in Budget and Expense, and list settlement history in the Settle up view. Pure presentation — no data, query, server-action, or migration changes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4. No test framework exists in this repo, so verification is `pnpm lint`, `pnpm build`, and a visual check at http://localhost:3000.

---

## File Structure

- **Modify** `src/app/trips/[slug]/settle-up-card.tsx` — extract `SettleUpButtons` (the partial+settle controls); `SettleUpCard` consumes it. Adds the reusable piece for the compact strip.
- **Modify** `src/app/trips/[slug]/budget-tab.tsx` — pills, Expense view, compact settle strip, settlement history. The orchestration file.

No new files: the compact strip, the Expense spent-total, and the history list are small inline pieces in `budget-tab.tsx`, consistent with `SplitBreakdown` already living there.

---

## Task 1: Extract `SettleUpButtons` from `SettleUpCard`

**Files:**
- Modify: `src/app/trips/[slug]/settle-up-card.tsx`

Goal: one component owns the `settle` + `partial` controls. Order becomes
`settle` then `partial` (what the compact strip wants).

- [ ] **Step 1: Replace the file body**

Replace the whole of `src/app/trips/[slug]/settle-up-card.tsx` with:

```tsx
"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { partialSettleUp, settleUp } from "@/lib/trips/actions"

import type { MemberToneEntry } from "./packing-tab"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

export interface SettleUpButtonsProps {
  owedCents: number
  tripId: string
  tripSlug: string
}

/** The settle + partial controls, shared by the full card and the compact strip. */
export function SettleUpButtons({
  owedCents,
  tripId,
  tripSlug,
}: SettleUpButtonsProps) {
  const [showInput, setShowInput] = React.useState(false)
  const [amount, setAmount] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submitPartial(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    startTransition(async () => {
      const result = await partialSettleUp(tripId, tripSlug, amount)
      if (result.error) {
        setError(result.error)
        return
      }
      setAmount("")
      setShowInput(false)
      setError(null)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <form action={settleUp.bind(null, tripId, tripSlug)}>
          <button
            type="submit"
            className="rounded-full border-0 bg-foreground px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
          >
            settle
          </button>
        </form>
        {showInput ? (
          <form onSubmit={submitPartial} className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={fmt(owedCents)}
              disabled={isPending}
              aria-label="Partial amount"
              className="t-num w-20 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full border-0 bg-foreground px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
            >
              ok
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowInput(true)
              setError(null)
            }}
            className="rounded-full border border-border bg-card px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            partial
          </button>
        )}
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}

export interface SettleUpCardProps {
  isSettled: boolean
  netBalanceCents: number
  creditor: MemberToneEntry | null
  debtor: MemberToneEntry | null
  tripId: string
  tripSlug: string
}

export function SettleUpCard({
  isSettled,
  netBalanceCents,
  creditor,
  debtor,
  tripId,
  tripSlug,
}: SettleUpCardProps) {
  const canSettle = !isSettled && creditor && debtor
  const owedCents = Math.abs(netBalanceCents)

  return (
    <div className="px-5 py-3.5">
      <div className="rounded-lg border border-border bg-card px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="mb-1">Settle-up</Label>
            {canSettle ? (
              <div className="text-[14px] leading-snug text-foreground">
                <span className="font-serif italic">{debtor.displayName}</span>{" "}
                owes{" "}
                <span className="font-serif italic">
                  {creditor.displayName}
                </span>
                <span className="t-num ml-1.5 text-foreground">
                  €{fmt(owedCents)}
                </span>
              </div>
            ) : (
              <div className="font-serif text-[14px] italic text-moss">
                All square.
              </div>
            )}
          </div>

          {canSettle ? (
            <SettleUpButtons
              owedCents={owedCents}
              tripId={tripId}
              tripSlug={tripSlug}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS. `SettleUpCard` still exports the same props; `budget-tab.tsx` is untouched so far.

- [ ] **Step 3: Visual check**

Run `pnpm dev`, open Budget tab → Settle up pill. The card looks the same except the buttons now read `settle` then `partial` (left to right). `partial` still expands to the amount input; `settle` still settles; errors still show.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/\[slug\]/settle-up-card.tsx
git commit -m "refactor(budget): extract SettleUpButtons from SettleUpCard"
```

---

## Task 2: Split Budget/Expense pills + move add-expense + ledger

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Widen the `View` union**

Find:

```tsx
type View = "budget" | "saved" | "settle"
```

Replace with:

```tsx
type View = "budget" | "expense" | "saved" | "settle"
```

- [ ] **Step 2: Add the Expense pill**

Find:

```tsx
            <SegBtn tone="sea" active={view === "budget"} onClick={() => setView("budget")}>
              Budget
            </SegBtn>
            <SegBtn tone="sea" active={view === "saved"} onClick={() => setView("saved")}>
              Saved
            </SegBtn>
```

Replace with:

```tsx
            <SegBtn tone="sea" active={view === "budget"} onClick={() => setView("budget")}>
              Budget
            </SegBtn>
            <SegBtn tone="sea" active={view === "expense"} onClick={() => setView("expense")}>
              Expense
            </SegBtn>
            <SegBtn tone="sea" active={view === "saved"} onClick={() => setView("saved")}>
              Saved
            </SegBtn>
```

- [ ] **Step 3: Add the Expense header figure**

Find:

```tsx
          {view === "budget" ? (
            <SpentFigure
              tripId={tripId}
              tripSlug={tripSlug}
              spentCents={totalCents}
              plannedBudgetCents={plannedBudgetCents}
            />
          ) : null}
          {view === "saved" ? (
```

Replace with (insert the Expense block in the middle):

```tsx
          {view === "budget" ? (
            <SpentFigure
              tripId={tripId}
              tripSlug={tripSlug}
              spentCents={totalCents}
              plannedBudgetCents={plannedBudgetCents}
            />
          ) : null}
          {view === "expense" ? (
            <div className="mt-2 flex items-baseline gap-1">
              <span className="t-display text-[22px] text-muted-foreground">€</span>
              <span className="t-display t-num text-[42px] leading-none text-foreground">
                {fmt(totalCents)}
              </span>
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                spent
              </span>
            </div>
          ) : null}
          {view === "saved" ? (
```

- [ ] **Step 4: Move add-expense + ledger into the Expense view**

Find:

```tsx
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
```

Replace with:

```tsx
      {view === "budget" ? (
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
      ) : null}

      {view === "expense" ? (
        <>
          <LogExpenseRow
            tripId={tripId}
            tripSlug={tripSlug}
            currentUserId={currentUserId}
            members={members}
            locations={locations}
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
```

- [ ] **Step 5: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/\[slug\]/budget-tab.tsx
git commit -m "feat(budget): split Budget pill into Budget + Expense"
```

---

## Task 3: Compact settle strip in Budget + Expense

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Import `SettleUpButtons`**

Find:

```tsx
import { SettleUpCard } from "./settle-up-card"
```

Replace with:

```tsx
import { SettleUpButtons, SettleUpCard } from "./settle-up-card"
```

- [ ] **Step 2: Add the `CompactSettle` helper**

Add this function at the bottom of the file, after `SplitBreakdown`:

```tsx
function CompactSettle({
  summary,
  currentUserId,
  tripId,
  tripSlug,
}: {
  summary: BudgetSummary
  currentUserId: string
  tripId: string
  tripSlug: string
}) {
  const owedCents = Math.abs(summary.netBalanceCents)
  const canSettle =
    summary.netBalanceCents !== 0 &&
    !!summary.creditorUserId &&
    !!summary.debtorUserId
  if (!canSettle) return null

  const youPay = summary.debtorUserId === currentUserId
  const youGet = summary.creditorUserId === currentUserId
  const label = youPay ? "you pay" : youGet ? "you're owed" : "owed"

  return (
    <div className="border-b border-border px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <SettleUpButtons owedCents={owedCents} tripId={tripId} tripSlug={tripSlug} />
        <div className="text-right">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="t-num text-[18px] text-foreground">€{fmt(owedCents)}</div>
        </div>
      </div>
    </div>
  )
}
```

(`BudgetSummary` is already imported at the top of `budget-tab.tsx`; `fmt` already exists.)

- [ ] **Step 3: Render the strip in Budget and Expense**

In the Budget content block (from Task 2 Step 4), wrap so the strip comes first:

Find:

```tsx
      {view === "budget" ? (
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
      ) : null}

      {view === "expense" ? (
        <>
          <LogExpenseRow
```

Replace with:

```tsx
      {view === "budget" ? (
        <>
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
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
        </>
      ) : null}

      {view === "expense" ? (
        <>
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
          />
          <LogExpenseRow
```

(The rest of the Expense block — `LogExpenseRow` … `Ledger` … `</>` — stays as Task 2 left it.)

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Visual check**

Run `pnpm dev`. On a trip with an unsettled balance, the Budget and Expense
views each show a strip at the top: `settle` + `partial` buttons on the left,
and on the right `you pay €X` (if you owe) or `you're owed €X` (if you're up).
Settling or a partial settle from the strip updates the figures. On a settled
trip the strip is absent.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/\[slug\]/budget-tab.tsx
git commit -m "feat(budget): compact settle strip in Budget + Expense"
```

---

## Task 4: Settlement history in the Settle up pill

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Render history under the settle view**

Find the settle view block:

```tsx
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
```

Replace with (add `SettlementHistory`):

```tsx
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
          <SettlementHistory expenses={expenses} members={members} />
        </>
      ) : null}
```

- [ ] **Step 2: Add the `SettlementHistory` helper**

Add at the bottom of the file, after `CompactSettle`:

```tsx
const HISTORY_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
})

function SettlementHistory({
  expenses,
  members,
}: {
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
}) {
  const settlements = expenses
    .filter((e) => e.isSettlement)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="px-5 pb-5 pt-1">
      <Label>Settlement history</Label>
      {settlements.length === 0 ? (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          No settlements yet
        </div>
      ) : (
        <div className="mt-2">
          {settlements.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 border-t border-border py-2.5"
            >
              <div className="flex items-center gap-2">
                <Avatar
                  name={members[s.paidBy]?.initial ?? "?"}
                  size={16}
                  tone={members[s.paidBy]?.tone ?? "sea"}
                />
                <span className="text-[13px] text-foreground">
                  {members[s.paidBy]?.displayName ?? "Someone"} paid
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {HISTORY_DATE.format(new Date(s.createdAt))}
                </span>
                <span className="t-num text-[14px] text-foreground">
                  €{fmt(s.amountCents)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

This uses `Avatar` and `Label` (already imported from `@/components/together` in `budget-tab.tsx`), `Expense` and `MemberToneEntry` (already imported), and `fmt` (already defined). `en-GB` keeps the day-before-month date order used across the app.

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Visual check**

Run `pnpm dev`. Settle up pill now shows, below the split cards, a "Settlement
history" list — each past settle/partial as `<name> paid · DD Mon · €X`, newest
first. A trip with no settlements shows "No settlements yet". Do a partial
settle from a compact strip and confirm a new row appears here.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/\[slug\]/budget-tab.tsx
git commit -m "feat(budget): settlement history in Settle up pill"
```

---

## Task 5: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record in TODO.md**

Add a paragraph near the recent highlights: the Budget tab now has four pills
(Budget / Expense / Saved / Settle up); add-expense + ledger moved to Expense;
a compact settle strip (`settle` + `partial` + your pay/owed amount) appears in
Budget and Expense; the Settle up pill keeps the full card + split and gained a
settlement history list. `SettleUpButtons` was extracted from `SettleUpCard`.

- [ ] **Step 2: Record in DECISIONS.md**

Append a row: Budget pill split into Budget (planning) + Expense (tracking);
settle-up surfaced compactly in both via an extracted `SettleUpButtons`, with the
full breakdown + settlement history kept in the Settle up pill. Settlement
history derives from `is_settlement` expense rows — no new data. Pure
presentation.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record budget/expense split + compact settle-up"
```

---

## Self-Review

**Spec coverage:**
- `Budget` / `Expense` / `Saved` / `Settle up` pills, default `budget` → Task 2. ✓
- Budget = SpentFigure + by-location; Expense = spent total + add + ledger → Task 2. ✓
- `SettleUpButtons` extracted, order settle-then-partial → Task 1. ✓
- Compact strip in Budget + Expense, 3 elements (settle, partial, your amount), hidden when square → Task 3. ✓
- Per-user "you pay" / "you're owed" from `summary` + `currentUserId` → Task 3 Step 2. ✓
- Settle up pill = full card + split + settlement history → Task 4. ✓
- Saved unchanged → not touched. ✓
- No data/query/migration changes → only `settle-up-card.tsx`, `budget-tab.tsx`, docs. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full before/after code. ✓

**Type consistency:** `View` union (Task 2 Step 1) matches the four pills (Step 2) and conditionals (Steps 3-4, Task 3-4). `SettleUpButtons` props `{ owedCents, tripId, tripSlug }` (Task 1) match both call sites (Task 1 card, Task 3 strip). `CompactSettle` and `SettlementHistory` use `summary` (`BudgetSummary`), `Expense`, `MemberToneEntry`, `Avatar`, `Label`, `fmt` — all already imported/defined in `budget-tab.tsx`. ✓
