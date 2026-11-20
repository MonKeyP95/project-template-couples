# Budget One Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One budget box: by-category view, plus a read-only by-place view behind a switch when the trip has 2+ places.

**Architecture:** A pure `byPlaceLines` mirrors `byCategoryLines` (same status/bar rules). A `BudgetBreakdown` wrapper owns the section header (label, or the switch) and renders `BudgetByCategory` or `BudgetByPlace`, which share the row/detail primitives. The editable `PlannedBudget` box is deleted.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-20-budget-one-box-design.md`

## Global Constraints

- No test framework: pure functions are checked with a scratch `pnpm dlx tsx` script in the scratchpad, not committed.
- Dates `en-GB`. No emojis. Client files import from `*-types.ts`, never `*-queries.ts`.
- Row names: "Before you go", each place name, "Trip-wide".

## Review Focus

- Pre-trip expense with a `locationId` -> still Before you go (category wins).
- Place with no plan and no spend -> hidden.
- Expense on a day with no place -> Trip-wide.
- Deleting the last place while "by place" is selected -> category view shows (switch hidden, view falls back).
- Buffer line (trip-wide, Other) counts under Trip-wide, so places sum to the same total as categories.

---

### Task 1: `byPlaceLines`

**Files:** Create `src/lib/trips/budget-by-place-types.ts`; modify `src/lib/trips/budget-by-category-types.ts` (export `lineStatus`, `linePct`).

**Interfaces:**
- Produces: `interface PlaceLine { key: string; name: string; plannedCents: number; actualCents: number; status: CategoryStatus; pct: number }` and
  `byPlaceLines(expenses: (ExpenseSpend & { locationId: string | null; dayDate: string | null })[], items: (PlannedSpend & { locationId: string | null })[], locations: { id: string; name: string }[], dayMap: Record<string, string>, tripStarted: boolean): PlaceLine[]`.
  Keys: `"pretrip"`, location id, `"trip"`. Order: Before you go, locations in given order, Trip-wide. Rows with 0 planned and 0 actual dropped. Settlements skipped.

- [ ] Scratch check: Pre-trip item/expense -> pretrip; tagged item -> its place; expense on a place's day -> that place; day-less untagged expense -> trip; empty place absent.
- [ ] Implement; run scratch check; commit.

### Task 2: By-place view + switch

**Files:** Modify `src/app/trips/[slug]/budget-by-category.tsx` (export `BudgetRow` = `CategoryRow` taking `name` + line fields, `DetailList`, `DetailLine`, `NOTE_CLASS`; drop its own outer border/label); create `src/app/trips/[slug]/budget-by-place.tsx` (`BudgetByPlace`), `src/app/trips/[slug]/budget-breakdown.tsx` (`BudgetBreakdown`: returns null with no budget items; header is `<Label>By category</Label>` with <2 places, else two `SegBtn tone="sea"`; view state falls back to category when places < 2).
- Place detail: Planned lines (subject or category, paid / not yet), Spent (latest 5, date · payer).

- [ ] Implement; `pnpm lint`; commit.

### Task 3: Delete the Planned box

**Files:** Modify `src/app/trips/[slug]/budget-tab.tsx` (render `BudgetBreakdown` in the headline box; delete `PlannedBudget`, `scopeKey`, unused imports); `docs/TODO.md`.

- [ ] Implement; `pnpm lint` and `pnpm build` (dev server must not be running); commit.
