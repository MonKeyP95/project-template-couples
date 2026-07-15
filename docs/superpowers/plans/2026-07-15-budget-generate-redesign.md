# Budget Generate Redesign Implementation Plan

> **For agentic workers:** executed inline in-session. No test framework exists;
> each task's gate is `pnpm lint` + `pnpm build` clean, plus a manual note where
> a pure function warrants a spot check. Steps use `- [ ]` for tracking.

**Goal:** Reshape "Plan a budget" into the itinerary-planner twin — walk seeded
from the itinerary, a buffer step recommended from the couple's history, then a
Generate that fills price gaps with bounded web search and honestly marks every
figure, reviewed before write.

**Architecture:** Client walk in `budget-drafter.tsx`; server Generate in
`budget-actions.ts` calling a new suggest-only `draftBudgetFill` seam in
`claude.ts` (built-in `web_search` + structured submit, mirroring `discover`).
Three additive columns on `trip_budget_items` carry the marks. Buffer % is a pure
recommendation over `TripBudgetSummary[]`.

**Tech Stack:** Next.js 16, React 19, TS 5, Supabase, `@anthropic-ai/sdk`.

## Global Constraints

- Table is `trip_budget_items`. Design system + copy per repo. European dates.
- Migrations are pasted into the Supabase SQL editor by hand and MUST be
  idempotent (`add column if not exists`).
- Suggest-only: nothing under `lib/ai` writes; the couple's Apply is the write.
- `amount_cents` stays NOT NULL; an unknown-price line is `amount_cents = 0` +
  `price_unknown = true`.
- Planning-mode only (drafter already gated off on-the-road in `budget-tab`).

---

### Task 1: Data model — columns, types, save path

**Files:**
- Create: `supabase/migrations/<n>_budget_item_marks.sql`
- Modify: `src/lib/trips/budget-item-types.ts`
- Modify: `src/lib/trips/actions.ts` (SaveBudgetItemInput, saveBudgetItems,
  saveBudgetItemsForScope)
- Modify: the budget-items read query (add columns to the SELECT)

**Interfaces produced:**
- `BudgetItem` gains `estimated: boolean`, `sourceUrl: string | null`,
  `priceUnknown: boolean`.
- `SaveBudgetItemInput` gains `estimated?: boolean`, `sourceUrl?: string | null`,
  `priceUnknown?: boolean`.

- [ ] **Step 1: Migration** — idempotent, three columns:
```sql
alter table trip_budget_items add column if not exists estimated boolean not null default false;
alter table trip_budget_items add column if not exists source_url text;
alter table trip_budget_items add column if not exists price_unknown boolean not null default false;
```
- [ ] **Step 2:** Add the three fields to `BudgetItem`, `BudgetItemRow`
  (`estimated`, `source_url`, `price_unknown`), and map them in
  `rowToBudgetItem`.
- [ ] **Step 3:** `SaveBudgetItemInput` + both save actions: include
  `estimated`, `source_url`, `price_unknown` in the inserted/updated rows
  (default false/null when absent). Planned-total reduce is unchanged (unknown
  lines are 0).
- [ ] **Step 4:** Find the budget-items SELECT (the query behind
  `initialItems`/`budgetItems`) and add `estimated, source_url, price_unknown`.
- [ ] **Step 5:** `pnpm lint` + `pnpm build`. Paste the migration into Supabase.
  Commit.

---

### Task 2: Pure — drop mock seeds, buffer recommender

**Files:**
- Modify: `src/lib/ai/budget-planner.ts` (remove mock cost seeds)
- Modify: `src/lib/trips/budget-history-types.ts` (add `recommendBufferPct`)

**Interfaces produced:**
- `recommendBufferPct(summaries: TripBudgetSummary[]): { pct: number; reason: string }`
  — mean whole-trip variance `(totalActual - totalPlanned)/totalPlanned` over
  summaries with `totalPlannedCents > 0`; clamp to a sane band (e.g. 5..25),
  round to a 5% step. No history -> `{ pct: 10, reason: "a typical starting
  buffer" }`. History -> e.g. `{ pct: 15, reason: "your trips have run ~12%
  over plan" }`.

- [ ] **Step 1:** In `budget-planner.ts`, set every step `seed: []` and remove
  the mock cost constants (`LODGING_PER_NIGHT_CENTS` etc.) and their use. Keep
  `estimateItemCents` only if still referenced; otherwise remove.
- [ ] **Step 2:** Add `recommendBufferPct` to `budget-history-types.ts` (pure,
  client-safe — no server imports).
- [ ] **Step 3:** `pnpm lint` + `pnpm build`. Spot-check `recommendBufferPct`
  with a tiny `tsx` snippet (no history -> 10; one trip 20% over -> 20). Commit.

---

### Task 3: Seam — `draftBudgetFill` in claude.ts (additive)

**Files:**
- Modify: `src/lib/ai/claude.ts`

**Interfaces produced:**
- `BudgetFillContext { destination; tripDays; memberCount; budgetBand;
  profileBlock; tasteDirective; locations: {name;nights;dateLabel}[];
  priced: {category;place;subject;whenLabel;amountEuros}[];
  unpriced: {category;place;subject;whenLabel}[] }`
- `BudgetFillLine { category; place; subject; whenLabel; amountEuros: number |
  null; sourceUrl: string | null }`
- `draftBudgetFill(ctx): Promise<{ fills: (number|null)[]; fillSources:
  (string|null)[]; additions: BudgetFillLine[] } | null>` — `fills[i]` is the
  price (or null) for `unpriced[i]`, index-matched; `additions` are new
  recommended lines. Returns null on failure.

- [ ] **Step 1:** Add a `BUDGET_FILL_TOOLS` array: the built-in
  `{ type: "web_search_20250305", name: "web_search", max_uses: 5 }` plus a
  strict `submit_budget` tool whose input has `fills` (array of
  `{ index, amountEuros: number|null, sourceUrl: string|null }`) and `additions`
  (array of `{ category(enum 5), place, subject, whenLabel, amountEuros:
  number|null, sourceUrl: string|null }`).
- [ ] **Step 2:** Add `BUDGET_FILL_SYSTEM`: never converse; search ONLY named /
  big-ticket items (specific accommodation, transport, named activities),
  estimate generic gaps (daily food, misc); **never fabricate** — if you can't
  ground or reasonably estimate a price, return `amountEuros: null`; attach the
  backing `sourceUrl` when a search produced the number, else null; whole-euro,
  whole-party, whole-line figures.
- [ ] **Step 3:** Add `budgetFillPrompt(ctx)` rendering profileBlock,
  tasteDirective, budget band, places, the priced lines (as fixed context —
  "already decided, do not re-price"), and the indexed unpriced lines.
- [ ] **Step 4:** Add `draftBudgetFill` with the same bounded `pause_turn`
  resume loop as `discover` (max ~6 rounds), returning the `submit_budget`
  input parsed into `{ fills, fillSources, additions }`.
- [ ] **Step 5:** `pnpm lint` + `pnpm build`. Commit. (Old `draftBudgetSeeds`
  still present — removed in Task 6.)

---

### Task 4: Action — `draftAndFillBudget` (additive)

**Files:**
- Modify: `src/lib/ai/budget-actions.ts`

**Interfaces produced:**
- `FilledBudgetLine { category; place; subject; whenLabel; amountCents: number;
  estimated: boolean; sourceUrl: string | null; priceUnknown: boolean }`
- `draftAndFillBudget(input: { tripId; tripSlug; priced: EnteredLine[];
  unpriced: EnteredLine[] }): Promise<{ error?: string; lines?:
  FilledBudgetLine[] }>` where `EnteredLine = { category; place; subject;
  whenLabel; amountEuros: number | null }`. Assembles the review model; does NOT
  write.

- [ ] **Step 1:** Guards (workspace, trip). `buildAssistantContext`. Build
  `BudgetFillContext`; call `draftBudgetFill`.
- [ ] **Step 2:** Assemble `lines`: (a) every `priced` line -> estimated:false,
  priceUnknown:false; (b) each `unpriced[i]` -> if `fills[i]` a number:
  amountCents=round(*100), estimated:true, sourceUrl=fillSources[i],
  priceUnknown:false; if null: amountCents:0, estimated:false, priceUnknown:true;
  (c) each `addition` -> estimated:true when it has a number else priceUnknown,
  amountCents accordingly. On `draftBudgetFill` null -> return `priced` lines
  only (the "couldn't reach the assistant" fallback), no marks.
- [ ] **Step 3:** `pnpm lint` + `pnpm build`. Commit. (Old `draftBudget` still
  present.)

---

### Task 5: UI — reshape `budget-drafter.tsx` + wire `budget-tab.tsx`

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1:** `budget-tab.tsx`: fetch `getItineraryDays(tripId)` (has events)
  and the couple's `TripBudgetSummary[]` (via the existing profile-budget path),
  pass both to `BudgetDrafter`. (Server component wiring; the drafter is a client
  component so pass plain data.)
- [ ] **Step 2:** Seed the walk from the itinerary: for each event with a
  location + category, add a candidate row `{ subject: event.text, value: "" }`
  to bucket `${categoryKey}:${locationId}`; trip-wide categories seed the
  trip-wide steps. Replaces the old mock-seed prefill.
- [ ] **Step 3:** Add the buffer phase after the category steps: choices 5/10/
  custom, default from `recommendBufferPct(summaries)` with its one-line reason.
  Store the chosen `pct` in state.
- [ ] **Step 4:** Move Generate to the review: it calls `draftAndFillBudget`
  with the session's priced/unpriced split, then loads the returned `lines` into
  the review, tagged with marks. Keep an Apply that saves. Keep the
  "couldn't reach the assistant" fallback.
- [ ] **Step 5:** Render the four line states in the review: plain / "est." /
  "est." + source link / "no reliable price — add it". Honest total: sum priced
  lines, append "+ N to price" when any `priceUnknown`. Editing an est. number
  clears its marks (becomes yours).
- [ ] **Step 6:** On Apply, serialize every line to `SaveBudgetItemInput`
  including `estimated`, `sourceUrl`, `priceUnknown`, and append the computed
  buffer line (`Other`, `Buffer (pct%)`, `round(subtotal*pct/100)`), then
  `saveBudgetItems`. Disable "mark paid" on an unknown-price line (in the budget
  ledger UI that shows marks).
- [ ] **Step 7:** `pnpm lint` + `pnpm build`. Manual click-path with assistant
  on. Commit.

---

### Task 6: Cleanup + docs

**Files:**
- Modify: `src/lib/ai/claude.ts`, `src/lib/ai/budget-actions.ts`,
  `src/lib/ai/budget-planner.ts` (remove dead code)
- Modify: `docs/DECISIONS.md`, `docs/TODO.md`

- [ ] **Step 1:** Remove `draftBudgetSeeds`, `BUDGET_TOOL`, `BUDGET_SYSTEM`,
  `budgetPrompt`, `DraftedBudgetItem`, `BudgetDraftContext` from `claude.ts`;
  `draftBudget`, `mergeSeeds`, `toSeed`, and now-unused consts from
  `budget-actions.ts`; any orphaned exports in `budget-planner.ts`.
- [ ] **Step 2:** DECISIONS rows (from the spec's "Decisions To Record"). TODO
  update.
- [ ] **Step 3:** `pnpm lint` + `pnpm build`. Commit.

## Self-Review

- Spec coverage: seeding (T5.2), buffer + recommendation (T2, T5.3), Generate +
  bounded search (T3), four-state marking + honest total (T1, T5.5), review-
  before-write (T4, T5.4), no-reliable-price (T3.2, T4.2), removals (T6). All
  covered.
- Type consistency: `estimated`/`sourceUrl`/`priceUnknown` names identical
  across BudgetItem, SaveBudgetItemInput, FilledBudgetLine, and the SQL
  (`source_url`, `price_unknown`). Index-matched `fills[i]` ↔ `unpriced[i]`.
- Green at every task: new seam/action added before old removed (T3/T4 additive,
  T6 deletes).
