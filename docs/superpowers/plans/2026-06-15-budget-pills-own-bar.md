# Budget Pills-Own-Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the budget pills bar its own strip by moving the per-view figures out of the dusk-tint header into each view's content.

**Architecture:** Single-file edit to `budget-tab.tsx`. Remove the three figure conditionals from the header, leaving `label + pills`; render each figure as the first (padded) block of its view's content.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4. No test framework exists in this repo, so verification is `pnpm lint`, `pnpm build`, and a visual check at http://localhost:3000.

---

## File Structure

- **Modify** `src/app/trips/[slug]/budget-tab.tsx` — the only file.

---

## Task 1: Move figures out of the header into content

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Strip the figures from the header**

Find:

```tsx
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <SegBtn tone="sea" active={view === "budget"} onClick={() => setView("budget")}>
              Budget
            </SegBtn>
            <SegBtn tone="sea" active={view === "expense"} onClick={() => setView("expense")}>
              Expense
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
```

Replace with (header keeps only the pills row):

```tsx
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <SegBtn tone="sea" active={view === "budget"} onClick={() => setView("budget")}>
              Budget
            </SegBtn>
            <SegBtn tone="sea" active={view === "expense"} onClick={() => setView("expense")}>
              Expense
            </SegBtn>
            <SegBtn tone="sea" active={view === "saved"} onClick={() => setView("saved")}>
              Saved
            </SegBtn>
            <SegBtn tone="sea" active={view === "settle"} onClick={() => setView("settle")}>
              Settle up
            </SegBtn>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Add the figure as the first content block per view**

Find the Budget content block:

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
```

Replace with (insert the `SpentFigure` wrapper first):

```tsx
      {view === "budget" ? (
        <>
          <div className="border-b border-border px-5 pt-4 pb-4">
            <SpentFigure
              tripId={tripId}
              tripSlug={tripSlug}
              spentCents={totalCents}
              plannedBudgetCents={plannedBudgetCents}
            />
          </div>
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
          />
          <BudgetByLocation
```

- [ ] **Step 3: Add the spent-total figure to the Expense view**

Find the Expense content block:

```tsx
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

Replace with (insert the spent-total wrapper first):

```tsx
      {view === "expense" ? (
        <>
          <div className="border-b border-border px-5 pt-4 pb-4">
            <div className="flex items-baseline gap-1">
              <span className="t-display text-[22px] text-muted-foreground">€</span>
              <span className="t-display t-num text-[42px] leading-none text-foreground">
                {fmt(totalCents)}
              </span>
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                spent
              </span>
            </div>
          </div>
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
          />
          <LogExpenseRow
```

(The inner figure's old `mt-2` is dropped — the `pt-4` wrapper provides the top spacing.)

- [ ] **Step 4: Add the Saved view content block**

Find the Settle up content block (which currently follows the Expense block directly):

```tsx
      {view === "settle" ? (
        <>
          <SettleUpCard
```

Insert a new Saved block immediately before it:

```tsx
      {view === "saved" ? (
        <div className="px-5 pt-4 pb-4">
          <SavedFigure
            tripId={tripId}
            tripSlug={tripSlug}
            plannedBudgetCents={plannedBudgetCents}
            savedCents={savedCents}
            contributions={savingsContributions}
            perUser={savedPerUser}
            members={members}
          />
        </div>
      ) : null}

      {view === "settle" ? (
        <>
          <SettleUpCard
```

- [ ] **Step 5: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS. All of `SpentFigure`, `SavedFigure`, `fmt`, and the savings props are still used.

- [ ] **Step 6: Visual check**

Run `pnpm dev`, open a trip's Budget tab:
- Dusk-tint header shows only `Budget · {name}` + the four pills, with a clean bottom edge.
- **Budget**: spent/planned figure + bar sits as the first white block (with a bottom border), then the compact settle strip, then budget-by-location.
- **Expense**: the `€… spent` block first, then settle strip, add expense, ledger.
- **Saved**: the saved figure + bar in the content area; tapping the saved number still expands the contributions log.
- **Settle up**: unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/app/trips/\[slug\]/budget-tab.tsx
git commit -m "feat(budget): pills bar on its own; figures move to content"
```

---

## Task 2: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record in TODO.md**

Extend the budget highlight: the dusk-tint header is now label + pills only; each
view's figure (spent / spent-total / saved) renders as the first block of its
content instead of inside the header.

- [ ] **Step 2: Record in DECISIONS.md**

Append a row: budget figures moved out of the pills header into each view's
content so the pills bar stands on its own. Pure presentation.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record budget pills-own-bar layout"
```

---

## Self-Review

**Spec coverage:**
- Header reduced to label + pills → Task 1 Step 1. ✓
- Budget figure → first content block with border → Task 1 Step 2. ✓
- Expense spent-total → first content block with border → Task 1 Step 3. ✓
- Saved figure → new content block, no bottom border → Task 1 Step 4. ✓
- Settle up unchanged → not touched. ✓
- No data/query/migration changes → only `budget-tab.tsx` + docs. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full before/after code. ✓

**Type consistency:** No type or signature changes. `SpentFigure` / `SavedFigure` props in the moved blocks are byte-identical to the removed header blocks; `totalCents` / `fmt` already exist in the component. ✓
