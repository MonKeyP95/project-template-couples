# Plan Itinerary on Dreams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the trip's "Plan your itinerary" walk on dreams, picking days instead of dates, with apply/Generate writing dream day cards into empty positions only.

**Architecture:** A pure module turns walk entries / drafted events into dream cards (spreading, bracketing, title priority, fallbacks). A new agent descriptor drafts in day numbers through a new registry tool. Two new server actions write cards (and close gaps when a length is first set). `PlanItinerary` gains an optional dream mode; the dated path is untouched.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, `@anthropic-ai/sdk` via `runAgent`.

**Spec:** `docs/superpowers/specs/2026-10-23-dream-plan-itinerary-design.md`

## Global Constraints

- No test framework; pure checks run as scratch scripts with `node` (import by `file:///` URL; the module must be import-free or type-only-import-free).
- `pnpm lint` + `pnpm exec tsc --noEmit -p .` clean per task; no `pnpm build` while `pnpm dev` runs.
- Dated planner behaviour unchanged: no edits to `propose_itinerary`, `agents/itinerary-planner.ts`, `draftAndApplyItinerary`, `applyPlanEntries`; `PlanItinerary` dated props/branches unchanged.
- No migration. Commit only touched files.

## Review Focus

1. A filled dream day is never written or moved by apply/Generate - pinned by the pure-module check (Task 1) and the write filter (Task 3).
2. Gap closing keeps order and never violates the unique (trip_id, day_index) - ascending sequential update (Task 3), checked by `closeGaps` (Task 1).
3. Dream entries on the last day with a bracket range ending past `dayCount` - clamp to `dayCount` like the dated clamp (Task 1).
4. Agent returns zero events + question - surfaced as the walk error (Task 3).
5. Dated walk regression - Task 4 keeps every dated branch; diff review at the end.

---

### Task 1: Pure dream-plan module

**Files:**
- Create: `src/lib/ai/dream-plan.ts` (no imports)

**Interfaces (Produces):**
- `export interface DreamPlanItem { category: string; place: string; text: string; day: number }` (day 0 = unplaced)
- `export interface DreamCardDraft { dayIndex: number; tag: string; title: string; sub: string; tone: "sea" | "clay" | "moss" | "sand" }`
- `export interface DaySpan { name: string; first: number; last: number }`
- `export function splitDays(dayCount: number, places: string[], fallback: string): DaySpan[]` - same rule as `planItinerarySkeleton`: even split, remainder to earlier places; empty places -> `[fallback]`.
- `export function entryItems(e: { category: string; place: string; subject: string; date?: string; endDate?: string }, dayCount: number): DreamPlanItem[]` - `date`/`endDate` hold day numbers as strings. Mirrors `entryDates` + `entriesToSkeleton`: no day -> one item with day 0; Accommodation/Transportation range -> two ends labelled `(check in)`/`(check out)`, `(pick up)`/`(drop off)`; others repeat; text = subject or category; days clamp to 1..dayCount.
- `export function placeItems(items: DreamPlanItem[], spans: DaySpan[], filled: Set<number>): DreamPlanItem[]` - day 0 or out of range -> first empty day in its place's span (place by case-insensitive name, else span 0); items whose day is filled are dropped.
- `export function buildCards(items: DreamPlanItem[], filled: Set<number>, tripPlace: string): DreamCardDraft[]` - group by day (skip filled); title from priority Activities > Food > Accommodation > Transportation > Other (stable within a category); rest joined into `sub` with " · "; tag = title item's place or `tripPlace`; tone Accommodation sand, Food clay, Activities sea, Transportation moss, Other sand. Sorted by day.
- `export function placesFromCards(cards: { dayIndex: number; tag: string }[]): string[]` - distinct tags in day order.
- `export function closeGaps(indices: number[]): { from: number; to: number }[]` - ascending; only moves where from != to.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Scratch check (`node`):
  - `splitDays(10, ["Lisbon","Ericeira"], "x")` -> Lisbon 1-5, Ericeira 6-10; `splitDays(5, [], "Portugal")` -> Portugal 1-5.
  - Items: Activities "Surf lesson" day 3, Food "Seafood" day 3, Accommodation "Surf house" 3-4 (via `entryItems`) with filled {4} -> `buildCards` gives one card day 3 titled "Surf lesson", sub "Seafood · Surf house (check in)"; nothing on day 4.
  - Trip-wide (place "") item -> tag = tripPlace.
  - `entryItems({category:"Food",place:"",subject:"",date:"2"}, 5)` -> text "Food".
  - `placeItems` moves a day-0 Ericeira item to the first empty Ericeira day.
  - `closeGaps([1,2,5])` -> `[{from:5,to:3}]`.
- [ ] **Step 3:** lint clean; commit `feat(ai): pure dream plan mapping`.

### Task 2: Dream planner agent

**Files:**
- Modify: `src/lib/ai/registry.ts` - add `propose_dream_itinerary` (copy of `propose_itinerary` with `day: { type: "integer", description: "Day number 1..N within the trip. 0 if you can't place it." }` in place of `date`; required list updated).
- Create: `src/lib/ai/agents/dream-itinerary-planner.ts`
- Modify: `src/lib/ai/claude.ts` - export `draftDreamItinerary`, types.

**Interfaces (Produces):**
- `export interface DreamDraftContext { destination: string; dayCount: number; places: { name: string; first: number; last: number }[]; brief: string; prefs: string; freeText: string; avoid: string; knownPlans: string[]; profileBlock: string; tasteDirective: string }`
- `export function draftDreamItinerary(c: DreamDraftContext): Promise<{ events: { category: string; place: string; text: string; day: number; time: string }[]; question: string }>`

- [ ] **Step 1:** Descriptor `dream-itinerary-planner`, same model/maxTokens/toolChoice pattern as `itinerary-planner`. System = the dated system text with the date sentences replaced: "Set day to a whole day number within 1..N, or 0 if you cannot place it." plus "Several items may share a day; the app turns each day into one short card. Days already planned are listed as known plans - do not propose anything for them." Prompt: `Draft a ${N}-day itinerary for ${destination}; no dates yet, days are numbered 1..${N}.` `Places in order: Lisbon (Days 1-5); ...` then known plans, brief, prefs, freeText, avoid, profile, taste - same shape as `itineraryPrompt`.
- [ ] **Step 2:** tsc + lint clean; commit `feat(ai): dream itinerary planner agent`.

### Task 3: Dream plan server actions

**Files:**
- Create: `src/lib/ai/dream-itinerary-actions.ts` (`"use server"`)

**Interfaces:**
- Consumes: Task 1 module, Task 2 `draftDreamItinerary`, `getTripBySlug`, `getDreamItineraryDays`, `buildAssistantContext` (same import as `itinerary-actions.ts`), `saveTripProfile`-based avoid write (copy `persistAvoid`'s 10 lines or export it from `itinerary-actions.ts` - prefer export).
- Produces:
  - `applyDreamPlanEntries(input: DreamPlanInput): Promise<{ error?: string }>`
  - `draftAndApplyDreamItinerary(input: DreamPlanInput & { freeText: string }): Promise<{ error?: string }>`
  - `interface DreamPlanInput { tripId: string; tripSlug: string; places: string[]; entries: PlanEntry[]; avoid: string; dayCount: number | null }` (`dayCount` non-null only when the walk asked for it)

- [ ] **Step 1:** Shared prelude `prepare(input)`: load trip + cards; persist avoid; if `input.dayCount` set: reject when < cards.length or > 365, run `closeGaps` as sequential ascending `update day_index` per move, then `update trips set day_count`; reload cards. Resolve `dayCount = trip.dayCount ?? input.dayCount`; error "How many days is this trip?" when still null. `tripPlace = trip.country ?? trip.name`; `spans = splitDays(dayCount, places, tripPlace)`; `filled = new Set(cards.map(c => c.dayIndex))`.
- [ ] **Step 2:** `insertCards(tripId, cards)`: one insert of rows `{ trip_id, day_index, title, sub, tag, tone, created_by }`; revalidate `/trips/${slug}`.
- [ ] **Step 3:** apply: `entries.flatMap(entryItems)` -> drop day 0 -> `buildCards(..., filled, tripPlace)` -> insert.
- [ ] **Step 4:** Generate: known plans = entries as `subject in place (when) [category]` + cards as `Day N: tag - title - sub`; call agent with `brief = trip.tripProfile.idea`, `prefs` = stay/move/acts/food joined with labels; zero events + question -> `{ error: question }`; else events -> items (`day`) -> `placeItems` -> `buildCards` -> insert. try/catch -> "Couldn't draft right now — try again."
- [ ] **Step 5:** tsc + lint clean; commit `feat(ai): dream plan apply and generate actions`.

### Task 4: Walk dream mode + dream tab

**Files:**
- Modify: `src/app/trips/[slug]/plan-itinerary.tsx`
- Modify: `src/app/trips/[slug]/dream-itinerary-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx` (~301-306)

**Interfaces:**
- `PlanItineraryProps.dream?: { dayCount: number | null; cards: { dayIndex: number; tag: string }[] }` - absent = dated, unchanged.
- `DreamItineraryTab` new props: `tripName: string; destination: string; avoid: string`.

- [ ] **Step 1:** In `PlanItinerary`, when `dream` is set: places seed `placesFromCards(dream.cards)` else `[destination]`; title by `dream.cards.length`; `openWalk` skips Places only if cards exist **and** `dream.dayCount !== null`; Places step shows "How many days?" numeric input (required) when `dream.dayCount === null`; row date inputs become `<select>` "Day 1..N" (N = dayCount or the typed one) with the same range toggle; `rangeLabel` -> `Day 3` / `Day 3 – 5`; `apply`/`generate` call Task 3 actions (dayCount sent only when asked). Dated branches untouched.
- [ ] **Step 2:** `DreamItineraryTab` renders `<PlanItinerary ... dream={{ dayCount, cards: days }} days={[]} locations={[]} />` under the add row; page passes `tripName={header.name}`, `destination={header.country ?? header.name}`, `avoid={header.tripProfile.avoid}`.
- [ ] **Step 3:** tsc + lint clean; review `git diff` of `plan-itinerary.tsx` for dated-path changes (none besides the added branches); commit `feat(trips): plan itinerary walk on dreams`.

### Task 5: Docs

- [ ] TODO entry (implemented; unverified in app; spec's in-app list) and a DECISIONS row (separate dream agent + tool; cards titled by activity priority; gap closing on first length), staged with the HEAD-blob technique so foreign hunks stay unstaged. Commit `docs: plan itinerary on dreams`.
