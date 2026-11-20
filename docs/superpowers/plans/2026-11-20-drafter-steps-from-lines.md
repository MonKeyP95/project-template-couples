# Drafter: steps from the lines, paid chip, custom categories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every saved budget line shows and edits in the guided drafter (custom categories,
place-tagged Transportation/Other, trip-wide per-place categories), with a paid chip, and a
couple can add a category from the edit list.

**Architecture:** Drafter steps become data: the fixed walk from `planBudgetSteps`, plus one
step per (category, scope) pair that saved lines use and no fixed step covers. A step owns its
category and default place; each row owns its own `locationId`, so nothing is parsed out of
bucket keys any more. A 0- or 1-place trip has one scope (the trip). Paid is a row field applied
after Apply's saves. Generate patches rows by client row id instead of rebuilding them.

**Tech Stack:** Next.js 16 App Router, React 19 client component, Server Actions, Supabase.

**Spec:** `docs/superpowers/specs/2026-11-20-drafter-steps-from-lines-design.md`

## Global Constraints

- No tests exist; do not add a test framework. Each task verifies with `pnpm lint` and `npx tsc --noEmit` (both must print no errors), plus the reasoning check the task names.
- Never run `pnpm build` while `pnpm dev` is running (shared `.next`). Build once, in Task 7.
- No migration. No new table, column or provider.
- No emojis; sparse comments; dates `en-GB`.
- `"use client"` files import types from `*-types.ts` or client-safe modules, never from `*-queries.ts`.
- "Scope" rule (DECISIONS 2026-11-20): with fewer than 2 places every line's scope is the trip; with 2+ places a line's scope is its `locationId` (null = trip-wide). No line is ever moved to another place.
- Category names are matched exactly (case-sensitive) when mapping lines to steps; the add-a-category form canonicalises case against existing names.

## Review Focus

1. 1-place trip holding a trip-wide and a place-tagged Accommodation line: one "Accommodation" step shows both, and Apply writes each back with its own `location_id` (Task 3 check).
2. 2-place trip with a trip-wide Accommodation line (added in the trip-wide editor): it gets its own "Accommodation" step in the Trip group and keeps `location_id` null after Apply (Task 3 check).
3. Add a category typed as "gifts" when "Gifts" exists: no `addExpenseCategory` call, the existing step (or a new step named "Gifts") opens (Task 5 check).
4. Mark paid, then change the amount, then Apply: the save runs before `payBudgetItem`, so the expense has the new amount (Task 6 check).
5. Generate with a custom-category line and a `daily` priced line: both rows survive unchanged; only unpriced rows are patched (Task 4 check).

---

### Task 1: Apply deletes the expense of a removed paid line

**Files:**
- Modify: `src/lib/trips/actions.ts` (`saveBudgetItems`, `savePreTripItems`)

**Interfaces:**
- Produces: `async function deleteItemsWithExpenses(supabase, ids: string[]): Promise<{ error?: string }>` (module-private), used by both saves in place of their `.delete().in("id", toDelete)` block.

- [ ] **Step 1:** Add `deleteItemsWithExpenses` above `saveBudgetItems`: select `paid_expense_id` for `ids`, delete those expenses (non-null ones), then delete the items. Same order as `deleteBudgetItem`. Type `supabase` as `Awaited<ReturnType<typeof createClient>>`.
- [ ] **Step 2:** Replace the delete block in `saveBudgetItems` and in `savePreTripItems` with a call to it.
- [ ] **Step 3:** Run `pnpm lint` and `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 4:** Reasoning check: a removed unpaid line issues no expense delete (empty list is skipped); a removed paid line's expense is deleted before the item, so the `on delete set null` FK never fires on it.
- [ ] **Step 5:** Commit `fix: removing a paid line in the drafter removes its expense`.

### Task 2: Pure step model

**Files:**
- Create: `src/app/trips/[slug]/budget-drafter-steps.ts` (no `"use client"`, no React)

**Interfaces:**
- Consumes: `BudgetStep` from `@/lib/ai/budget-planner`.
- Produces:
  ```ts
  export const CATEGORY_BY_STEP: Record<string, string>   // moved from budget-drafter.tsx
  export interface StepPlace { id: string; name: string }
  export interface DraftStep extends BudgetStep { category: string; locationId: string | null }
  export function isMultiPlace(places: StepPlace[]): boolean            // places.length >= 2
  export function scopeOf(locationId: string | null, places: StepPlace[]): string | null
  export function fromPlannedStep(step: BudgetStep, places: StepPlace[]): DraftStep
  export function extraStep(category: string, locationId: string | null, places: StepPlace[]): DraftStep
  export function stepFor(steps: DraftStep[], category: string, locationId: string | null, places: StepPlace[]): DraftStep | undefined
  export function insertStep(steps: DraftStep[], step: DraftStep, places: StepPlace[]): DraftStep[]
  export function withLineSteps(steps: DraftStep[], lines: { category: string; locationId: string | null }[], places: StepPlace[]): DraftStep[]
  ```

- [ ] **Step 1:** Write the module:
  - `scopeOf`: `isMultiPlace && locationId && places has it ? locationId : null`.
  - `fromPlannedStep`: category = `CATEGORY_BY_STEP[key prefix]`; `locationId` = the key's second part unless `"trip"`; when not multi-place, `place` and `placeWhen` become null.
  - `extraStep`: key `extra:${scope ?? "trip"}:${category}`; title = category; question `Anything in ${category}?`; hint null; addNoun = category lowercased; seed `[]`; `place` = that place's name when multi-place and scope set, else null; placeWhen null; `locationId` = the given one.
  - `stepFor`: first step with the same `category` and the same `scopeOf(locationId)` as `scopeOf(step.locationId)`.
  - `insertStep`: after the last step whose scope equals the new step's scope; append when none.
  - `withLineSteps`: for each line with no `stepFor` match, `insertStep(extraStep(...))`.
- [ ] **Step 2:** Run `pnpm lint` and `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Reasoning check, by hand on two cases: (a) places `[L]`, steps from `planBudgetSteps`, line `(Accommodation, null)` -> `stepFor` returns `accommodation:L` (both scopes null), no extra; (b) places `[L, M]`, line `(Accommodation, null)` -> no match, extra step `extra:trip:Accommodation` appended after `other:trip`.
- [ ] **Step 4:** Commit `feat: drafter step model from saved lines`.

### Task 3: Drafter runs on DraftSteps and row-owned places

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx`

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces: `ItemRow` gains `locationId: string | null`; `Session.steps: DraftStep[]`; `newRow(locationId: string | null, fields?: Partial<ItemRow>): ItemRow`; `stepByKey(key: string): DraftStep | undefined`.

- [ ] **Step 1:** Delete local `CATEGORY_BY_STEP`, `STEP_BY_CATEGORY`, `PER_LOCATION`; import from `./budget-drafter-steps`. Build `places: StepPlace[]` from `locations`.
- [ ] **Step 2:** `bucketDays(locationId)` counts `itineraryDays` with that `locationId`, else `totalDays`. `resolveQty(stepKey, row)` reads the category from `stepByKey`; nights rule when category is `"Accommodation"`; days from `row.locationId`.
- [ ] **Step 3:** `savedRows()` returns `{ category, locationId, row }[]` for every item that is not the buffer and not `PRE_TRIP_CATEGORY` (no other `continue`; no fallback place). `seedSession` builds `steps = withLineSteps(planned.map(fromPlannedStep), saved, places)`, then puts each saved row in `stepFor(...)`'s bucket with its own `locationId`. Itinerary seeds go to their key's step with `step.locationId`. Pre-trip rows get `locationId: null`.
- [ ] **Step 4:** `addItem` uses `stepByKey(bucketId)?.locationId ?? null`. `collectLines` and `apply` take `category` from the step and `locationId` / place name from the row. Remove every `bucketId.split(":")`.
- [ ] **Step 5:** Run `pnpm lint` and `npx tsc --noEmit`. Expected: clean. `grep -n 'split(":")' "src/app/trips/[slug]/budget-drafter.tsx"` prints nothing.
- [ ] **Step 6:** Reasoning check, Review Focus 1 and 2: trace both lines from `initialItems` through `savedRows` -> `stepFor` -> `apply`'s `locationId` and confirm each is written back unchanged.
- [ ] **Step 7:** Commit `feat: drafter shows every saved line in its own step`.

### Task 4: Generate patches rows by id

**Files:**
- Modify: `src/lib/ai/budget-actions.ts`, `src/app/trips/[slug]/budget-drafter.tsx` (`collectLines`, `filledToItems`, `generate`)

**Interfaces:**
- Produces: `EnteredLine.rowId: string` and `FilledBudgetLine.rowId: string`, replacing `serverId` on both (the drafter is the only caller).

- [ ] **Step 1:** In `budget-actions.ts` rename the pass-through `serverId` to `rowId` (required string) on both types and every object built.
- [ ] **Step 2:** `collectLines` sends `rowId: r.id`. Replace `filledToItems` with `applyFills(items, lines)`: for each line with `estimated || priceUnknown`, patch the row whose `id === rowId` with `value` (`""` when unknown, else `moneyInput(amountCents)`), `estimated`, `sourceUrl`, `priceUnknown`, `freq: "once"`, `count: 1`. Typed-price rows are not touched. `generate` sets `items` to `applyFills(s.items, r.lines)`.
- [ ] **Step 3:** Run `pnpm lint` and `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 4:** Reasoning check, Review Focus 5: a priced `daily` row and a custom-category row keep their freq, step and `serverId` after Generate.
- [ ] **Step 5:** Commit `fix: Generate keeps every drafter line in place`.

### Task 5: Edit list grouped by place, plus add a category

**Files:**
- Create: `src/app/trips/[slug]/budget-drafter-add-category.tsx`
- Modify: `src/app/trips/[slug]/budget-drafter-list.tsx`, `src/app/trips/[slug]/budget-drafter.tsx` (`renderList`, new `addCategory`), `src/app/trips/[slug]/budget-tab.tsx` (pass `expenseCategories`)

**Interfaces:**
- Produces:
  ```ts
  export function AddCategoryForm(props: {
    categories: string[]            // fixed six + trip categories, minus Pre-trip, deduped
    places: StepPlace[]             // [] on a 0-1 place trip: no place select
    disabled: boolean
    onAdd: (category: string, locationId: string | null) => void
  }): React.JSX.Element
  ```
  `BudgetDrafterList` gains `footer?: React.ReactNode`, rendered after the groups, before Total.
  `BudgetDrafterProps` gains `expenseCategories: ExpenseCategoryRow[]`.

- [ ] **Step 1:** `AddCategoryForm`: collapsed it is a full-width list-row button `+ add a category` (same row style as the list). Open: a text input with a `datalist` of `categories`, a `select` (only when `places.length > 0`) with `Trip-wide` (null) then each place, and `add` / `cancel` buttons in the list's mono button style. Trim; ignore empty; max 40 chars.
- [ ] **Step 2:** `renderList` groups: `Before you go`; then on a multi-place trip one group per place (title = place name, rows = steps with that scope, label = `step.title`) and a `Trip` group for scope null; on a 0-1 place trip one `Trip` group as today; then `Finish`. Pass `<AddCategoryForm>` as `footer`.
- [ ] **Step 3:** `addCategory(name, locationId)` in the drafter: canonicalise against `categories` case-insensitively; if the name is in neither the fixed six nor `expenseCategories`, `await addExpenseCategory(tripId, tripSlug, name)` and stop on error. Then `stepFor` it, or `insertStep(extraStep(...))` with one `newRow(locationId)`; then `setStepIndex` to that step.
- [ ] **Step 4:** Run `pnpm lint` and `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 5:** Reasoning check, Review Focus 3.
- [ ] **Step 6:** Commit `feat: drafter edit list by place, add a category`.

### Task 6: Paid chip, applied on Apply

**Files:**
- Create: `src/app/trips/[slug]/paid-chip.tsx`
- Modify: `src/app/trips/[slug]/budget-drafter.tsx` (`ItemRow`, `savedRows`, `savedPreTripRows`, `renderRow`, `apply`), `src/app/trips/[slug]/budget-drafter-pretrip.tsx` (`PreTripRowLike`, `PreTripStepBody`)

**Interfaces:**
- Produces: `export function PaidChip({ paid, disabled, onToggle }: { paid: boolean; disabled: boolean; onToggle: () => void })` — `paid ✓` in moss / `to pay` in clay, the place editor's pill classes. `ItemRow` gains `paidExpenseId: string | null` (as saved) and `paid: boolean` (wanted). `PreTripRowLike` gains `serverId?: string; paid: boolean`; `PreTripStepBody` gains `onTogglePaid: (id: string) => void`.

- [ ] **Step 1:** Saved rows (category and pre-trip) load `paidExpenseId` and `paid = paidExpenseId != null`; new rows `null` / `false`.
- [ ] **Step 2:** Show `PaidChip` in `renderRow` and in each `PreTripStepBody` row when `serverId` is set and the price is above 0. Toggling flips `paid` locally only.
- [ ] **Step 3:** In `apply`, after `saveBudgetItems` succeeds, for every kept row with `serverId` where `paid !== (paidExpenseId != null)`, await `payBudgetItem(serverId, tripSlug, deviceToday())` or `unpayBudgetItem(serverId, tripSlug)`; stop and `setError` on the first error. Then close.
- [ ] **Step 4:** Run `pnpm lint` and `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 5:** Reasoning check, Review Focus 4, and: Cancel calls no action (`setSession(null)` only).
- [ ] **Step 6:** Commit `feat: paid chip in the drafter`.

### Task 7: Docs and build

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1:** `docs/TODO.md`: add a "Current Phase" entry, "implemented; lint + tsc clean; build passes; unverified in app; no migration", with the spec's 8 in-app checks.
- [ ] **Step 2:** `docs/DECISIONS.md`: one row — drafter steps come from the lines; rows own their place; paid marks apply on Apply; removing a paid line removes its expense.
- [ ] **Step 3:** Confirm `pnpm dev` is not running, then `pnpm build`. Expected: build succeeds.
- [ ] **Step 4:** Commit `docs: drafter steps from lines`.
