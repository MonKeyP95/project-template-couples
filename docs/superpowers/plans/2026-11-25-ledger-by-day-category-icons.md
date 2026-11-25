# Ledger by Day + Category Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Group the budget ledger into day boxes and replace category names with coloured icons, in the ledger and on the road.

**Architecture:** A pure grouping helper; one `CategoryIcon` component plus a name-based tone rule shared by bars and icons; ledger, ledger row, category rows and quick expense consume them.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-25-ledger-by-day-category-icons-design.md`

## Global Constraints
- No migration. en-GB dates. No emojis. Short functions, sparse comments.
- No test runner: pure helper checked by a scratch `node` script.

## Review Focus
1. Expense with a category not in the trip list (deleted/renamed) -> muted tag icon, no crash.
2. Settlement rows -> handshake icon, excluded from the day total.
3. A day holding only settlements -> box shows, total 0.
4. Quick expense with no categories -> no icon row, submit still guarded.
5. Many categories on a phone -> icon row wraps, no sideways scroll.

---

### Task 1: Grouping helper
**Files:** Create `src/lib/trips/ledger-days.ts` (import-free).
**Produces:** `groupByDay<T extends { dayDate: string | null; createdAt: string; isSettlement: boolean; cents: number }>(rows: T[]): { dayDate: string | null; totalCents: number; rows: T[] }[]` -- dated days newest first, rows in a day newest `createdAt` first, one `dayDate: null` group last if any; total sums non-settlement `cents`.
- [ ] Scratch check: two days + an undated + a settlement; assert order, row order, totals (settlement excluded), undated last.
- [ ] Run (fails), implement, run (passes). Commit.

### Task 2: CategoryIcon + tone rule
**Files:** Create `src/components/together/category-icon.tsx`; export from `src/components/together/index.ts`.
**Produces:** `categoryToneOf(name: string, names: string[]): BarTone` (index in `names` -> `categoryTone`, else `"muted"`); `CategoryIcon({ name, tone, size? })` -- lucide icon per the spec map, tinted round chip (`bg-<tone>-tint text-<tone>`; sea2 uses sea-tint; muted uses `bg-muted text-muted-foreground`), `aria-label={name}`.
- [ ] Implement; lint. Commit.

### Task 3: Ledger by day
**Files:** Modify `budget-ledger.tsx`, `ledger-row.tsx`.
- Ledger: expenses -> `groupByDay` (cents = `homeCents`); each group a rounded bordered box with header (`Wed 12 Mar` / `Undated`, total via `money`); then a "Savings & moves" box with moves + savings by `createdAt` desc. Ledger takes nothing new: tones from `categories` names (sorted by `sortOrder`).
- LedgerRow: new prop `tone: BarTone`; date column replaced by `CategoryIcon`; `MonoBadge` and `CATEGORY_TONE` removed.
- [ ] Implement; lint + tsc. Commit.

### Task 4: Icons on the road + bars by name
**Files:** Modify `budget-by-category.tsx` (`BudgetRow` optional `icon` prop; category view passes `CategoryIcon`; tone via `categoryToneOf`), `on-the-road/quick-expense.tsx` (icon buttons replace the select; selected name beside).
- [ ] Implement; lint + tsc; ask before `pnpm build`. Update TODO + DECISIONS. Commit.
