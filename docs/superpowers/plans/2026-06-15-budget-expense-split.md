# Budget / Expense Pill Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Budget tab's `Budget` pill into two pills — `Budget` (planning) and `Expense` (tracking) — moving add-expense + ledger under Expense.

**Architecture:** Single-file edit to `budget-tab.tsx`. Add `"expense"` to the `View` union, add an Expense pill, render a lightweight spent-total header for the Expense view, and move `LogExpenseRow` + `Ledger` from the Budget view to the Expense view (`BudgetByLocation` stays under Budget). Pure presentation — no data, query, server-action, or migration changes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4. No test framework exists in this repo, so verification is `pnpm lint`, `pnpm build`, and a visual check at http://localhost:3000.

---

## File Structure

- **Modify** `src/app/trips/[slug]/budget-tab.tsx` — the only file. It already owns the `view` state and per-view rendering; this task extends both.

No new files: the Expense header is a small inline block, consistent with `SplitBreakdown` already living inline in this file.

---

## Task 1: Add the Expense pill and move add-expense + ledger

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

Find the pill row:

```tsx
            <SegBtn tone="sea" active={view === "budget"} onClick={() => setView("budget")}>
              Budget
            </SegBtn>
            <SegBtn tone="sea" active={view === "saved"} onClick={() => setView("saved")}>
              Saved
            </SegBtn>
```

Replace with (insert the Expense pill between Budget and Saved):

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

Find the header figure block (the `SpentFigure` / `SavedFigure` conditionals inside the dusk-tint header):

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

Insert an Expense spent-total block between the Budget and Saved conditionals, so it reads:

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

(`fmt` and `totalCents` already exist in this component — `totalCents = summary.expenseTotalCents`.)

- [ ] **Step 4: Move add-expense + ledger into the Expense view**

Find the Budget content block:

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

Replace with two blocks — Budget keeps `BudgetByLocation`; a new Expense block holds `LogExpenseRow` + `Ledger`:

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
Expected: PASS, no new errors. (`SpentFigure`, `BudgetByLocation`, `LogExpenseRow`, `Ledger` are all still imported and used.)

- [ ] **Step 6: Visual check**

Run `pnpm dev`, open a trip's Budget tab:
- Four sea-toned pills: Budget / Expense / Saved / Settle up. Budget active by default.
- **Budget**: spent/planned figure + sea bar, then budget-by-location. No add-expense, no ledger.
- **Expense**: a "€… spent" header, then the add-expense row and the ledger.
- **Saved** and **Settle up**: unchanged from before.
- Adding an expense from the Expense pill still works and updates the ledger.

- [ ] **Step 7: Commit**

```bash
git add src/app/trips/\[slug\]/budget-tab.tsx
git commit -m "feat(budget): split Budget pill into Budget + Expense"
```

---

## Task 2: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record in TODO.md**

Add a line/paragraph near the recent highlights noting the Budget tab now has a fourth pill, **Expense**, holding add-expense + ledger, while **Budget** keeps the spent/planned figure + budget-by-location.

- [ ] **Step 2: Record in DECISIONS.md**

Append a row: the Budget pill was split into `Budget` (planning: spent/planned figure + budget-by-location) and `Expense` (tracking: add-expense + ledger) to separate planning from actuals; the Expense view shows a simple spent total. Pure presentation, no data change.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record budget/expense pill split"
```

---

## Self-Review

**Spec coverage:**
- New `Expense` pill inside Budget tab → Task 1 Step 2. ✓
- `View` gains `"expense"`, default stays `"budget"` → Task 1 Step 1 (default unchanged). ✓
- Budget header = `SpentFigure`; budget-by-location stays in Budget → Task 1 Steps 3-4. ✓
- Expense header = simple spent total → Task 1 Step 3. ✓
- Expense content = `LogExpenseRow` + `Ledger` → Task 1 Step 4. ✓
- Saved / Settle up unchanged → not touched. ✓
- No data/query/migration changes → only `budget-tab.tsx` + docs touched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full before/after code. ✓

**Type consistency:** `View = "budget" | "expense" | "saved" | "settle"` (Step 1) matches the four pills (Step 2) and the four conditionals (Steps 3-4). `totalCents` / `fmt` referenced in Step 3 already exist in the component. ✓
