# Budget Pill: Add-Expense + Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `LogExpenseRow` + `Ledger` in the Budget pill as well as the Expense pill.

**Architecture:** Single-file edit to `budget-tab.tsx` — append the two components to the Budget view block. Pure presentation, no data/query/migration changes.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind v4. No test framework; verify with `pnpm lint`, `pnpm build`, and a visual check.

---

## Task 1: Append add-expense + ledger to the Budget view

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Add the components after `BudgetByLocation`**

Find:

```tsx
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
```

Replace with:

```tsx
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

      {view === "expense" ? (
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Visual check**

Run `pnpm dev`, Budget tab → Budget pill: after budget-by-location you now see
the add-expense row and the ledger; adding an expense works and the ledger
updates. Expense pill unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/\[slug\]/budget-tab.tsx
git commit -m "feat(budget): show add-expense + ledger in Budget pill too"
```

---

## Task 2: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Extend the budget highlight in TODO.md** noting add-expense + ledger now appear in the Budget pill as well as Expense.

- [ ] **Step 2: Append a DECISIONS.md row** noting the Budget pill also shows add-expense + ledger (duplicated with Expense by request).

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: budget pill also shows add-expense + ledger"
```

---

## Self-Review

**Spec coverage:** add-expense + ledger appended to Budget view → Task 1. Expense/Saved/Settle untouched. No data changes. ✓
**Placeholder scan:** none. ✓
**Type consistency:** `LogExpenseRow` / `Ledger` props are byte-identical to their existing use in the Expense view; all referenced vars (`currentUserId`, `expenses`, `moves`, etc.) exist in the component. ✓
