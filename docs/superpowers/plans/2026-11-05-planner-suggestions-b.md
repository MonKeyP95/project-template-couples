# Planner Suggestions (Piece B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate writes the couple's walk entries as real events and stores the assistant's new ideas as suggestions only; the couple turns a suggestion into a real event (and, if priced, a budget line) through the day's normal event form.

**Architecture:** `trip_suggestions` is reshaped into the spec's table. `draftAndApplyItinerary` first calls `applyPlanEntries` (unchanged), then asks the planner agent for ideas via a new forced tool, places each idea on a blank day or in the box, and replaces the trip's suggestions. Options are filled lazily by a deterministic mock on first open, so piece C only swaps the mock for a search. The UI adds a suggestion box inside the itinerary's existing `DndContext`, a "Suggestion" line on blank days, an options dialog, a prefilled `DayEditor`, and a "Did you pay?" dialog.

**Tech Stack:** Next.js 16 server actions, Supabase (hand-applied SQL + RLS), `@dnd-kit/core`, shadcn `Dialog`, `runAgent`.

**Spec:** `docs/superpowers/specs/2026-11-05-planner-suggestions-design.md` (section "B. Suggestions with mock options")

## Global Constraints

- No test runner exists; do not add one. Verification is `pnpm lint`, `pnpm build`, grep, and one throwaway `node` check script in the scratchpad (Node 24 strips TS types natively).
- Do not run `pnpm build` while `pnpm dev` is running (shared `.next`).
- Migrations are pasted by hand and must be re-runnable.
- `"use client"` files import types/helpers only from `*-types.ts`, never `*-queries.ts`.
- No emojis; sparse comments; European date order if any date is shown.
- Options are labelled as sample data in the UI ("Sample data" text) while they come from the mock.
- Per-person price -> budget amount = price x number of workspace members.
- A suggestion never becomes an event except through the day's event form; Cancel at any step writes nothing.
- Spec decision (user, 2026-11-05): reshape the orphaned `trip_suggestions` table in place; the road-card revert path ends.

## Review Focus

1. **Generate fails at the model step** — the couple's entries are already saved, but the previous suggestions must survive (delete-then-insert happens only after the model returns ideas). Task 2, Step 3 pins the order.
2. **Running trip, idea on a past blank day** — goes to the box, never onto a day that already happened. Task 1 check: `ideaDay(2, 5, blank, 3) === null`.
3. **Idea whose `place` matches no location, or `day` out of 1..N** — still stored, `location_id`/`day_index` null, shows in the box. Task 1 checks `ideaDay(0|9, ...)`; Task 2 stores it.
4. **A blank day with a suggestion gets filled by hand** — the suggestion must move to the box, not sit on a planned day. Task 4 splits on the client by "is this day still blank".
5. **Option with no price** — no paid question, no budget row. Task 1 check `costCents(null price) === null`; Task 5 skips the dialog.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261105000001_planner_suggestions.sql` | Drop the old-shape table (guarded), create the new one + RLS |
| `src/lib/trips/suggestion-types.ts` | Types, row mapping, `mockOptions`, `ideaDay`, `costCents`. **No imports** (so the node check can load it) |
| `src/lib/trips/suggestion-queries.ts` | `getTripSuggestions(tripId)` |
| `src/lib/trips/suggestion-actions.ts` | `loadSuggestionOptions`, `deleteSuggestion`, `addSuggestionCost` |
| `src/lib/ai/agents/itinerary-planner.ts` | Agent returns `ideas`, not events |
| `src/lib/ai/registry.ts` | `propose_ideas` tool replaces `propose_itinerary` |
| `src/lib/ai/itinerary-actions.ts` | Generate rewired |
| `src/app/trips/[slug]/suggestion-box.tsx` | Box, draggable card, day line |
| `src/app/trips/[slug]/suggestion-dialogs.tsx` | Options chooser + paid question |
| `src/app/trips/[slug]/itinerary-tab.tsx` | Wiring: box, drop handling, prefilled `DayEditor` |
| `src/app/trips/[slug]/page.tsx` | Load suggestions, pass to `ItineraryTab` |

---

### Task 1: Table, types, queries

**Files:**
- Create: `supabase/migrations/20261105000001_planner_suggestions.sql`
- Create: `src/lib/trips/suggestion-types.ts`
- Create: `src/lib/trips/suggestion-queries.ts`
- Modify: `docs/DECISIONS.md` (append one row)

**Interfaces:**
- Produces (all in `suggestion-types.ts`):
  - `type SuggestionKind = "big" | "small"`
  - `interface SuggestionOption { name: string; location: string; priceCents: number | null; priceUnit: "total" | "per_person"; url: string; reviews: string }`
  - `interface TripSuggestion { id: string; kind: SuggestionKind; category: string; title: string; locationId: string | null; dayIndex: number | null; why: string; options: SuggestionOption[] | null }`
  - `interface TripSuggestionRow` (snake_case columns; `options` as `{ name, location, price_cents, price_unit, url, reviews }[] | null`)
  - `rowToSuggestion(row: TripSuggestionRow): TripSuggestion`
  - `optionsToJson(options: SuggestionOption[]): TripSuggestionRow["options"]`
  - `mockOptions(kind: SuggestionKind, title: string, place: string): SuggestionOption[]`
  - `ideaDay(day: number, dayCount: number, blank: ReadonlySet<number>, floor: number | null): number | null`
  - `costCents(option: SuggestionOption, memberCount: number): number | null`
- Produces: `getTripSuggestions(tripId: string): Promise<TripSuggestion[]>` in `suggestion-queries.ts`, ordered by `created_at`.

- [ ] **Step 1: Write the migration**

Header comment: what the table holds, that it replaces the orphaned road-card table, idempotent. Body:
  - A `do $$` block that `drop table public.trip_suggestions` **only if** `information_schema.columns` still has `trip_suggestions.day_date` (the old shape). A second run finds no `day_date` and keeps the live rows.
  - `create table if not exists public.trip_suggestions`: `id uuid pk default gen_random_uuid()`, `trip_id uuid not null references trips(id) on delete cascade`, `created_by uuid not null default auth.uid()`, `created_at timestamptz not null default now()`, `kind text not null`, `category text not null`, `title text not null`, `location_id uuid references itinerary_locations(id) on delete set null`, `day_index integer`, `why text not null default ''`, `options jsonb`.
  - Drop-then-add check constraint `trip_suggestions_kind_check` (`kind in ('big','small')`).
  - `create index if not exists trip_suggestions_trip_idx on (trip_id)`.
  - RLS enabled; four policies copied from `20260617000001_trip_budget_items.sql` (`to authenticated`, `is_trip_workspace_member(trip_id)`, update has `using` + `with check`), each preceded by `drop policy if exists`.

- [ ] **Step 2: Write `suggestion-types.ts`** with the interfaces above and these rules:
  - `ideaDay`: returns `day` only if `1 <= day <= dayCount`, `blank.has(day)`, and (`floor === null || day >= floor`); else `null`.
  - `costCents`: `null` when `priceCents` is null; `priceCents * memberCount` for `per_person`; `priceCents` for `total`.
  - `mockOptions`: deterministic from a simple string hash of `title`. Big -> 3 options, small -> 1. Names read like places (e.g. `` `${place || "Local"} ${title}` `` plus a distinguishing suffix per option: "Classic", "Small group", "Private"); `location` = `place`; prices in whole euros as cents (big: base `4000 + (hash % 6) * 1000`, options x1, x0.75, x1.6 rounded to 100; small: `1500 + (hash % 4) * 500`), `priceUnit: "per_person"`; `url` = `https://example.com/` + slug of name; `reviews` = `` `${(4 + (hash % 9) / 10).toFixed(1)} (sample)` ``.

- [ ] **Step 3: Check the pure functions**

Write `<scratchpad>/check-suggestions.mjs`:

```js
import assert from "node:assert/strict"
import { ideaDay, mockOptions, costCents } from "file:///C:/Users/Noam%20West/projects/project-template-couples/src/lib/trips/suggestion-types.ts"
const blank = new Set([2, 3])
assert.equal(ideaDay(2, 5, blank, null), 2)
assert.equal(ideaDay(1, 5, blank, null), null)   // planned day
assert.equal(ideaDay(0, 5, blank, null), null)   // no preference
assert.equal(ideaDay(9, 5, blank, null), null)   // out of range
assert.equal(ideaDay(2, 5, blank, 3), null)      // already happened
const big = mockOptions("big", "Kayak trip", "Lagos")
assert.equal(big.length, 3)
assert.equal(mockOptions("small", "Seafood dinner", "Lagos").length, 1)
assert.deepEqual(big, mockOptions("big", "Kayak trip", "Lagos"))
assert.ok(big.every((o) => o.url.startsWith("https://example.com/") && o.priceCents > 0))
assert.equal(costCents({ ...big[0], priceCents: 3000, priceUnit: "per_person" }, 2), 6000)
assert.equal(costCents({ ...big[0], priceCents: 3000, priceUnit: "total" }, 2), 3000)
assert.equal(costCents({ ...big[0], priceCents: null }, 2), null)
console.log("ok")
```

Run: `node <scratchpad>/check-suggestions.mjs` — Expected: `ok`.

- [ ] **Step 4: Write `suggestion-queries.ts`** following `budget-item-queries.ts` (select the columns, `.returns<TripSuggestionRow[]>()`, map with `rowToSuggestion`).

- [ ] **Step 5: Append a DECISIONS row** — "`trip_suggestions` reshaped for planner suggestions": the 2026-08-12 row kept the table for a revert; piece B reuses the approved name, the migration drops the old shape only when `day_date` exists, so the road card can no longer be revived by revert alone, and re-pasting `20260803000002` would now fail on its index (don't).

- [ ] **Step 6: Verify** — `pnpm lint` clean. Ask the user to paste the migration into the SQL editor (twice is fine).

- [ ] **Step 7: Commit** — `feat(suggestions): trip_suggestions table and types`

---

### Task 2: Planner returns ideas; Generate rewired

**Files:**
- Modify: `src/lib/ai/registry.ts` (`propose_itinerary` at :52-98)
- Modify: `src/lib/ai/agents/itinerary-planner.ts`
- Modify: `src/lib/ai/claude.ts` (:21-22 re-export `DraftedIdea` instead of `DraftedItineraryEvent`)
- Modify: `src/lib/ai/itinerary-actions.ts` (`draftAndApplyItinerary` at :395-475)
- Modify: `src/lib/ai/itinerary-planner.ts` (remove `itemsToSkeleton` / `DraftItem` if nothing else uses them after this task — grep)

**Interfaces:**
- Consumes: `ideaDay`, `TripSuggestion` fields (Task 1); `applyPlanEntries` (unchanged).
- Produces: `interface DraftedIdea { kind: "big" | "small"; category: string; title: string; place: string; day: number; why: string }`; `draftItinerary(context): Promise<{ ideas: DraftedIdea[]; question: string }>`; `draftAndApplyItinerary(...)` keeps its input type, returns `Promise<{ error?: string }>`.

- [ ] **Step 1: Replace the tool.** In `registry.ts` rename `propose_itinerary` to `propose_ideas` ("Return new ideas for the couple to choose from."), `strict: true`, `ideas` array of objects with required `kind` (enum big/small, "big = an activity worth comparing options for; small = a place to eat or drink"), `category` (same five-value enum), `title` ("Short, e.g. 'Kayak trip'"), `place` (exact place name or empty), `day` (integer, 0 = no preference), `why` ("One short line: why this suits them"); plus `question` as today.

- [ ] **Step 2: Update the agent.** Output becomes `{ ideas, question }`; `tools`/`toolChoice` name `propose_ideas`. Prompt changes:
  - First line: `Suggest new ideas for a ${dayCount}-day trip to ${destination}; days are numbered 1..${dayCount}.`
  - Known plans line: `Already planned by them (do not suggest these again; suggest around them): ${known}.`
  - Free text line: keep, reworded to "what they want, in their words".
  - System: suggestions only, never re-propose their plans; about one big idea per place and three to five small (eat/drink) ideas in total; `day` only when an idea clearly belongs on a day, else 0; keep the grounding, sparseness, no-invented-prices and clarifying-question rules.

- [ ] **Step 3: Rewire `draftAndApplyItinerary`** in this order:
  1. `const applied = await applyPlanEntries(input)`; return its error if any. (It already persists avoid and the day count.)
  2. Reload the trip (`getTripBySlug`) for `dayCount`; build the `locations` grounding exactly as today.
  3. Call `draftItinerary`. If `ideas` is empty and `question` is set, return `{ error: question }` (entries stay saved).
  4. Read `getItineraryDays` and `getItineraryLocations`; `blank` = day indexes of rows where `!isPlannedRow`; `floor = await writeFloor(trip)`.
  5. Map each idea to an insert row: `kind`, `category`, `title`, `why`, `day_index = ideaDay(idea.day, dayCount, blank, floor)`, `location_id` = location whose name matches `place` (trimmed, case-insensitive), else the location of the day it landed on, else null; `options` null.
  6. Only now: delete the trip's `trip_suggestions` rows, then insert the new ones. Return the first error.
  7. `revalidatePath(`/trips/${tripSlug}`)`; return `{}`.
  Keep the existing `try/catch` around the model call only.

- [ ] **Step 4: Verify** — `pnpm lint` and `pnpm build` clean; `grep -n "propose_itinerary\|itemsToSkeleton\|DraftItem" -r src` returns nothing; `grep -n "addItineraryDay\|updateItineraryDay" src/lib/ai/itinerary-actions.ts` shows no call inside `draftAndApplyItinerary`.

- [ ] **Step 5: Commit** — `feat(planner): Generate saves your plans and stores ideas as suggestions`

---

### Task 3: Suggestion actions

**Files:**
- Create: `src/lib/trips/suggestion-actions.ts` (`"use server"`)

**Interfaces:**
- Consumes: `mockOptions`, `optionsToJson`, `costCents`, `rowToSuggestion` (Task 1); `payBudgetItem(itemId, tripSlug, dayDate)` from `src/lib/trips/actions.ts`; `getCurrentWorkspace`.
- Produces:
  - `loadSuggestionOptions(id: string, tripSlug: string): Promise<{ options?: SuggestionOption[]; error?: string }>` — reads the row; if `options` is null, computes `mockOptions(kind, title, location name or "")`, stores it, returns it. A second call returns the stored value without recomputing.
  - `deleteSuggestion(id: string, tripSlug: string): Promise<{ error?: string }>` — used by Dismiss and by a successful save.
  - `addSuggestionCost(input: { tripId: string; tripSlug: string; category: string; subject: string; option: SuggestionOption; locationId: string | null; dayDate: string | null; paid: boolean }): Promise<{ error?: string }>`

- [ ] **Step 1: Implement `loadSuggestionOptions` and `deleteSuggestion`**, each ending in `revalidatePath`.

- [ ] **Step 2: Implement `addSuggestionCost`:**
  - Member count: rows in `workspace_members` for the current workspace.
  - `amount = costCents(option, count)`; if null, return `{}` (nothing to write).
  - Insert one `trip_budget_items` row: `category`, `subject`, `amount_cents = amount`, `location_id`, `estimated: true`, `source_url: option.url`, `sort_order` = current max in that category + 1. Select its id.
  - Recompute `trips.planned_budget_cents` as the sum of the trip's items (same query as `saveBudgetItemsForScope`, actions.ts:2713-2721).
  - If `paid`, `return await payBudgetItem(id, tripSlug, dayDate)`.

- [ ] **Step 3: Verify** — `pnpm lint` and `pnpm build` clean.

- [ ] **Step 4: Commit** — `feat(suggestions): options, dismiss and cost actions`

---

### Task 4: Show suggestions (box, day line, dismiss)

**Files:**
- Create: `src/app/trips/[slug]/suggestion-box.tsx` (`"use client"`)
- Modify: `src/app/trips/[slug]/page.tsx` (load in the `Promise.all` at :223, pass at :304)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

**Interfaces:**
- Consumes: `TripSuggestion` (Task 1), `deleteSuggestion` (Task 3).
- Produces:
  - `SuggestionBox({ suggestions, tripSlug }: { suggestions: TripSuggestion[]; tripSlug: string })`
  - `SuggestionLine({ suggestion, onOpen }: { suggestion: TripSuggestion; onOpen: () => void })`
  - Draggable id format: `` `suggestion:${id}` `` (exported const `SUGGESTION_DRAG_PREFIX = "suggestion:"`).
  - `ItineraryTab` new prop `suggestions: TripSuggestion[]`.

- [ ] **Step 1: Load and pass.** `getTripSuggestions(header.id)` in `page.tsx`'s `Promise.all`; pass as `suggestions` to `ItineraryTab`. Use the prop directly (no local state): every write revalidates the page.

- [ ] **Step 2: Split in `ItineraryTab`.** `blankIndexes` = `days.filter((d) => !isPlannedRow(d))` day indexes. On-day = `s.dayIndex !== null && blankIndexes.has(s.dayIndex)`; everything else goes to the box.

- [ ] **Step 3: Build `suggestion-box.tsx`.**
  - Box: rendered inside the existing `DndContext` (itinerary-tab.tsx:1214), above `{rendered}`, on every viewport; hidden when empty. Heading "Suggestions"; one card per suggestion: kind as a small label ("Idea" / "Eat & drink"), title, `why`, a **Dismiss** button calling `deleteSuggestion`. Each card is `useDraggable({ id: SUGGESTION_DRAG_PREFIX + id })`.
  - Day line: on a blank day's `DayView` (itinerary-tab.tsx:1558, the `empty` branch), one line per on-day suggestion, labelled **Suggestion**, dashed and muted so it never reads as an event; a button calling `onOpen`. Thread a `suggestions` array and `onOpenSuggestion` through `DaySegmentView` -> `cardProps` -> `DayCard` -> `DayView`. In this task `onOpen` is a no-op placeholder that Task 5 replaces.
  - `DragOverlay`: when `dragId` starts with the prefix, show the card's title.
  - `onDragEnd`: if the active id starts with the prefix, return before `planDrop` (Task 5 adds the handling).

- [ ] **Step 4: Verify** — `pnpm lint` and `pnpm build` clean.

- [ ] **Step 5: Commit** — `feat(suggestions): suggestion box and day lines`

---

### Task 5: Add flow (drop/tap -> choose -> form -> paid?)

**Files:**
- Create: `src/app/trips/[slug]/suggestion-dialogs.tsx` (`"use client"`, shadcn `Dialog` from `@/components/ui/dialog`)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`onDragEnd` :560, `DayCardProps` :1423, `DayCard` :1465, `DayEditor` :1756)

**Interfaces:**
- Consumes: `loadSuggestionOptions`, `deleteSuggestion`, `addSuggestionCost` (Task 3); `newEventDraft` from `event-draft-rows.tsx`.
- Produces:
  - `OptionsDialog({ suggestion, options, onPick, onCancel }: { suggestion: TripSuggestion; options: SuggestionOption[]; onPick: (o: SuggestionOption) => void; onCancel: () => void })`
  - `PaidDialog({ onAnswer }: { onAnswer: (paid: boolean) => void })` — "Did you pay for this already?", buttons **Yes** / **Not yet**, no other way out.
  - `type AddFlow = { stage: "choose"; suggestion; dayId; options } | { stage: "form"; suggestion; dayId; option } | { stage: "paid"; suggestion; option; dayDate: string | null; locationId: string | null } | null` (state in `ItineraryTab`).
  - `DayEditor` new optional props `prefill?: EventDraft` and `onSaved?: () => void`.

- [ ] **Step 1: Start the flow.** `startAdd(suggestion, dayId)`:
  - Ignore if the target day is before `todayIndex` while the trip is running (same check as `placeBack`).
  - `loadSuggestionOptions`; on error, stop.
  - Small: go straight to `form` with `options[0]`. Big: `choose`.
  - `onDragEnd`: prefixed active id + `over` is a day in `days` -> `startAdd`. Any other target does nothing (card stays in the box).
  - The day line's `onOpen` -> `startAdd(suggestion, day.id)`.

- [ ] **Step 2: Options dialog.** Options side by side on desktop, stacked on mobile: name, location, price (`moneyRounded`, "/ person" when per-person, "No price" when null), link (opens in a new tab), reviews, and a "Sample data" note. Pick -> `form` stage with `editingId = dayId`. Cancel -> `null`.

- [ ] **Step 3: Prefilled form.** While `addFlow.stage === "form"`, `cardProps.prefill` for `editingId === day.id` = `{ ...newEventDraft("", "", option.name, option.url, option.location), category: suggestion.category }`. `DayEditor` initial events: existing drafts (or none on a blank day) followed by `prefill`. On save success it calls `onSaved()` then `onDone()`.
  - `onSaved`: `deleteSuggestion`; if `option.priceCents !== null`, set stage `paid` (with the day's `dayDate` and `locationId`, falling back to the suggestion's `locationId`), else `null`.
  - `onStopEdit` clears the flow only if still in `form`: `setAddFlow((f) => (f?.stage === "form" ? null : f))` — a functional update, because `onSaved` has just set `paid` in the same tick.

- [ ] **Step 4: Paid dialog.** `onAnswer(paid)` -> `addSuggestionCost({ ..., subject: option.name, category: suggestion.category, paid })`, then `setAddFlow(null)`.

- [ ] **Step 5: Verify** — `pnpm lint` and `pnpm build` clean. Reason through the data path: the only event write is `updateItineraryDay` from `DayEditor.save`; Cancel in either dialog or the form only clears local state.

- [ ] **Step 6: Commit** — `feat(suggestions): add a suggestion through the day form`

---

### Task 6: Docs

- [ ] Update `docs/TODO.md`: piece B *implemented; unverified in app*, with the in-app checklist below; piece C next.
- [ ] Append DECISIONS rows for the calls made here: options filled lazily on first open (so C only swaps the source); per-person price x workspace member count; the box sits above the days on every viewport, inside the itinerary's one `DndContext`.
- [ ] Commit — `docs: planner suggestions piece B`

---

## Success Criteria

**Verified by Claude**
- Migration re-runnable: the drop is guarded by the old `day_date` column; table, constraint, index and four policies all use `if [not] exists` / drop-then-create; policies match `trip_budget_items`.
- `check-suggestions.mjs` prints `ok`.
- `draftAndApplyItinerary` writes events only through `applyPlanEntries`; no model idea reaches `itinerary_days` (grep, Task 2 Step 4).
- An idea on a blank day keeps its `day_index`; on a planned or past day, `null` (`ideaDay` check).
- Saving the prefilled form writes one event via `updateItineraryDay` and deletes the suggestion; cancelling writes nothing.
- "Not yet" inserts one budget item; "Yes" also calls `payBudgetItem` (one linked expense).
- `pnpm lint` and `pnpm build` clean.

**Verified by the user in-app**
1. After Generate, empty days show suggestions labelled as such; planned days show none; the rest are in the box.
2. Dragging a small card onto a day opens the event form pre-filled (name, link, category, location); saving with a time adds a real event on that day.
3. Dragging a big card onto a day shows its 3 options first; choosing one opens the pre-filled event form.
4. Cancelling at any step writes nothing and the card is back in the box.
5. After saving a priced suggestion, "Not yet" adds a planned cost under the right budget category; "Yes" also adds an expense.
6. Dismiss removes a card; Generate again does not pile up old cards.
7. Works on a phone viewport.
