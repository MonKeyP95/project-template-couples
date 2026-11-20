# Budget planned-room line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `planned €X · €Y unplanned room` under the budget headline and in the drafter header.

**Architecture:** One display component in `budget-figures.tsx`, fed a planned total the tab computes from `budgetItems` (buffer line excluded). It replaces `AllocatedFigure`.

**Tech Stack:** React 19 client component, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-20-budget-planned-room-design.md`

## Global Constraints
- No tests exist; gate is `pnpm lint` + `npx tsc --noEmit` clean, then `pnpm build` (dev server not running).
- Copy exactly: `planned {X} · {Y} unplanned room`; over: `planned {X} · {Z} over your budget`.
- Money via `money(cents, currency)` from `useCurrency`, as the neighbouring figures do.

## Review Focus
1. A budget whose only line is the buffer: no line shows (planned is 0).
2. Planned exactly equal to the budget: shows `€0 unplanned room`, not clay.
3. The drafter header and the headline compute planned from the same items, so they agree.

---

### Task 1: PlannedRoom replaces AllocatedFigure

**Files:**
- Modify: `src/app/trips/[slug]/budget-figures.tsx` (delete `AllocatedFigure`, add `PlannedRoom`)
- Modify: `src/app/trips/[slug]/budget-tab.tsx` (compute planned once; render under `SpentFigure` and as the drafter `header`)

**Interfaces:**
- Produces: `export function PlannedRoom({ plannedCents, plannedBudgetCents, className }: { plannedCents: number; plannedBudgetCents: number; className?: string })` — renders null when either is 0 or less; clay text when `plannedCents > plannedBudgetCents`.
- In `budget-tab.tsx`: `const plannedLinesCents = budgetItems.filter((it) => !isBufferSubject(it.subject)).reduce(...)`.

- [ ] **Step 1:** Add `PlannedRoom` (one `div`, mono `text-[10px] tracking-[0.06em]`, muted; clay when over), delete `AllocatedFigure`.
- [ ] **Step 2:** In the tab, render `<PlannedRoom className="mt-1" .../>` right after `<SpentFigure>`, and pass `<PlannedRoom className="px-5 pt-3" .../>` as the drafter `header`.
- [ ] **Step 3:** `pnpm lint` and `npx tsc --noEmit`. Expected: clean. Trace Review Focus 1-3.
- [ ] **Step 4:** `pnpm build`. Expected: exit 0.
- [ ] **Step 5:** Update `docs/TODO.md` (implemented; unverified in app; the spec's 5 checks) and commit `feat: planned and unplanned room under the budget headline`.
