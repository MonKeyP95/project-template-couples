# Budget box: edit planned lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Edit, pay, unpay, delete and add planned lines from an opened breakdown row.

**Architecture:** Two single-line server actions in `src/lib/trips/actions.ts`; a new client file
`budget-planned-list.tsx` holding the planned list, its line editor and the add form;
`RowDetail` swaps its read-only Planned list for it.

**Tech Stack:** Next.js 16 server actions, React 19, Supabase.

**Spec:** `docs/superpowers/specs/2026-11-20-budget-edit-planned-lines-design.md`

## Global Constraints
- No tests exist; verification is `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` (dev server not running).
- Saving a planned amount never touches `expenses` (option a).
- Buffer line (`isBufferSubject`) is read-only.

## Review Focus
- Mark paid on a 0 amount: `payBudgetItem` returns "Set a cost before paying."; the editor shows it.
- Blank subject: allowed (display falls back to the category name).
- Amount input: parse with `Number()` like the ledger editor; non-numeric or negative disables Save.
- Before you go add: category fixed to Pre-trip, no picker.
- By place add: category picker defaults to the first trip category.

---

### Task 1: Server actions

**Files:** Modify `src/lib/trips/actions.ts` (after `deleteBudgetItem`).

- [ ] `updateBudgetItem(input: { itemId: string; tripSlug: string; subject: string; amountCents: number }): Promise<{ error?: string }>` — validates `validCents`, updates `subject` (trimmed) + `amount_cents` only, revalidates.
- [ ] `addBudgetItem(input: { tripId: string; tripSlug: string; category: string; locationId: string | null; subject: string; amountCents: number }): Promise<{ error?: string }>` — validates category (non-empty, <= 40) and cents; `sort_order` = count of that trip's lines in that category; `when_label: ""`; revalidates.
- [ ] `pnpm exec tsc --noEmit` clean.

### Task 2: Planned list UI

**Files:** Create `src/app/trips/[slug]/budget-planned-list.tsx`; modify `budget-by-category.tsx` (`RowDetail`, export `DetailList`, `DetailLine`, `NOTE_CLASS`), `budget-by-place.tsx`.

- [ ] `PlannedList({ items, plannedWhere, planDefaults, tripId, tripSlug, categories, fmt })` where
  `planDefaults: { category?: string; locationId: string | null }` (category undefined = show picker).
  Tapping a non-buffer line opens `PlannedLineEditor` (subject, amount, Save, Cancel, Delete, Mark paid / Unpay; Escape cancels).
  "+ add planned" opens `PlannedLineAdd`.
- [ ] `RowDetail` takes `planDefaults` and renders `PlannedList` (shown even when empty so "+ add planned" exists).
- [ ] By category: `{ category, locationId: null }`. By place: pretrip -> `{ category: PRE_TRIP, locationId: null }`, trip -> `{ locationId: null }`, place -> `{ locationId: key }`.
- [ ] lint + tsc + build clean; commit.

### Task 3: Docs
- [ ] `docs/TODO.md` entry (implemented, unverified in app, in-app checks from the spec); commit.
