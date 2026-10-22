# New Trip Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/trips/new` with the mock's note-first flow (one basic-profile page + an optional preferences page), give dateless trips a day count with empty day slots, and let the edit page change the new fields.

**Architecture:** A pure parser module feeds a client form that holds both pages in local state and calls a slimmed `createTrip` Server Action. A new `trips.day_count` column carries a dateless trip's length; the dream itinerary renders positions `1..day_count` and the promote RPC keeps positions. Trip profile gains four free-text keys, cleaned by one shared helper.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Supabase (SQL applied by hand).

**Spec:** `docs/superpowers/specs/2026-10-22-new-trip-flow-design.md`

## Global Constraints

- No test framework exists; do not add one. Pure-function checks run as a throwaway script in the session scratchpad with `node` (Node 24 strips TS types).
- Every task ends with `pnpm lint` and `pnpm build` clean. Do not run `pnpm build` while `pnpm dev` is running (shared `.next`).
- Migrations re-runnable (`if not exists`, `create or replace`); applied by the user in the Supabase SQL editor.
- `"use client"` files import types/helpers from `*-types.ts` or pure modules, never `*-queries.ts`.
- Dates displayed `en-GB`, day before month. No emojis. Sparse comments.
- Commit only the files the task touched (the tree holds unrelated uncommitted edits; never `git add -A`).
- Existing design tokens/classes (`font-serif`, `font-mono`, `border-rule`, `text-muted-foreground`, `bg-foreground text-background`), not the mock's raw OKLCH.

## Review Focus

1. Typing into a field, then editing the note, must not overwrite that field (per-field touched flag) - pinned in Task 4's form logic.
2. Saving the edit page on an old trip must keep vibe/transport and on a new trip keep stay/move/acts/food - pinned by `cleanTripProfile` round-trip check (Task 2).
3. "a week in May" / "10 days to Celebrate": the first yields no place; the second shows as an editable "Where:" line - parser check (Task 3) and in-app list.
4. A dream whose rows exceed `day_count` (deleted days, or added via "+ add day") still renders every row and promotes to `greatest(day_count, max(day_index))` days - Task 1 SQL and Task 6 positions helper check.
5. Slug collision on create yields `-2`, `-3`, not an error - Task 5.

---

### Task 1: Migration - `day_count` and position-keeping promotion

**Files:**
- Create: `supabase/migrations/20261022000001_trip_day_count.sql`

- [ ] **Step 1:** Write the migration:
  - `alter table public.trips add column if not exists day_count int;` plus a `drop constraint if exists trips_day_count_check` / `add constraint trips_day_count_check check (day_count is null or day_count >= 1)`.
  - `create or replace function public.promote_dream_to_dated(p_trip_id uuid, p_start_date date) returns void` (same signature, SECURITY INVOKER, plpgsql). Read `v_count` (rows), `v_max` (max day_index), `v_days` (trips.day_count). Raise as today when `v_count = 0`. If `v_days is null`: today's behaviour exactly (row_number compaction, `end = start + v_count - 1`). Else: `end_date = start + greatest(v_days, v_max) - 1`, each row on `start + day_index - 1`. Both branches: `fuzzy_when = null`, `day_count = null`, delete dream rows.
- [ ] **Step 2:** Re-read the SQL for re-runnability (every statement idempotent).
- [ ] **Step 3:** Commit `feat(trips): day_count column and position-keeping dream promotion`.
- [ ] **Step 4:** Tell the user to paste the file into the SQL editor before Task 5 is used in-app.

### Task 2: Trip profile - four new keys, one cleaner, AI context

**Files:**
- Modify: `src/lib/trips/trip-profile-types.ts`
- Modify: `src/lib/trips/actions.ts` (createTrip profile block ~876-885, updateTrip `profilePatch` ~1079-1093, `saveTripProfile` ~1897-1925)
- Modify: `src/lib/ai/profile-context.ts`

**Interfaces:**
- Produces: `TripProfile` gains `stay: string; move: string; acts: string; food: string`. `EMPTY_TRIP_PROFILE` gains them as `""`. `parseTripProfile` reads them as strings else `""`. New `cleanTripProfile(p: TripProfile): TripProfile` - trims; caps idea 2000, others 500; filters transport/vibe to allowed sets.

- [ ] **Step 1:** Extend the type, empty value and parser.
- [ ] **Step 2:** Add `cleanTripProfile` and replace the three inline cleaning blocks in `actions.ts` with it.
- [ ] **Step 3:** In `buildProfileBlock`, after the transport line add: `Where they'll sleep: …`, `Getting around in their words: …` (from `move`), `Plans to do: …`, `Food: …` - each only when non-empty.
- [ ] **Step 4:** Scratch check: `cleanTripProfile(parseTripProfile({ vibe: ["Romantic"], stay: " hostel ", junk: 1 }))` returns `vibe ["Romantic"]`, `stay "hostel"`, all new keys present. Run with `node <scratch>/check-profile.ts` (copy the two pure functions into the script or import the file by path - it has no imports).
- [ ] **Step 5:** `pnpm lint && pnpm build` clean. Commit `feat(trips): stay/move/acts/food on the trip profile`.

### Task 3: Note parser module

**Files:**
- Create: `src/lib/trips/trip-note-parse.ts`

**Interfaces:**
- Produces:
  - `export interface NoteReading { days: number; budget: number; place: string; what: string }` (0 / "" when not found; budget in whole units)
  - `export function readNote(text: string, currency: string): NoteReading`
  - `export type PrefKey = "stay" | "move" | "acts" | "food" | "avoid"`
  - `export const PREF_TOPICS: { key: PrefKey; label: string; title: string; hint: string }[]` - labels Sleeping / Getting around / Doing / Eating / Avoid; titles and hints verbatim from the spec table.
  - `export function prefillPrefs(text: string): Record<PrefKey, string>`
  - `export function tripHeadline(what: string, place: string): string` - `"{What} in {Place}"`, else what, else place, else `"A trip"`, first letter upper-cased.

- [ ] **Step 1:** Port the mock's `parseDays`, `parseWhere`, `parseWhat`, `prefill`, `ACTIVITIES`, topic regexes (`project/Main.dc.html` lines 281-331) as module-private helpers. Changes from the mock: `parseWhere` returns "" when the match is a month or weekday name (English, full and 3-letter); `parseBudget(text, currency)` matches the currency's symbol (`currencySymbol` from `@/lib/money` - check it is client-safe, else inline a tiny map) and ISO code case-insensitively, plus `eur`/`euros` when currency is EUR, plus `budget (of|is)? N(k)?`.
- [ ] **Step 2:** Scratch check with `node`, assertions (currency "EUR"):
  - `"2 weeks surfing"` -> `{ days: 14, budget: 0, place: "", what: "Surfing" }`
  - `"10 days in Portugal, 1500 eur"` -> days 10, budget 1500, place "Portugal"
  - `"a week hiking in the Alps, budget 2k, we cook"` -> days 7, budget 2000, place "Alps", what "Hiking"; `prefillPrefs(...).food === "we cook"`
  - `"a week in May"` -> place ""
  - `"10 days, 1500 usd"` with "EUR" -> budget 0; with "USD" -> 1500
  - `tripHeadline("Surfing", "Portugal") === "Surfing in Portugal"`, `tripHeadline("", "") === "A trip"`
- [ ] **Step 3:** `pnpm lint` clean. Commit `feat(trips): note parser for the new trip flow`.

### Task 4: New trip form (both pages)

**Files:**
- Rewrite: `src/app/trips/new/new-trip-form.tsx` (split into `note-page.tsx` and `prefs-page.tsx` beside it if the file passes ~200 lines)
- Modify: `src/app/trips/new/page.tsx` - pass `currency={workspace.currency}` to `NewTripForm`

**Interfaces:**
- Consumes: Task 3 exports; Task 5's `createTrip(input: CreateTripInput)`.
- State: `note`, `days`, `start`, `showDates`, `budget`, `place`, `unsure`, `what`, `prefs: Record<PrefKey,string>`, `touched: Set<"days"|"budget"|"place"|PrefKey>`, `page: "note" | "prefs"`.

- [ ] **Step 1:** Page 1 per spec "Page 1": eyebrow, serif headline, sub-line, textarea, three example chips (mock line 281), How long + "+ Add dates" (start input, "to {Sat 4 Jul}" via `toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })`), Budget with currency symbol prefix and "whole trip", Where in its two states, Continue disabled while `days < 1`.
- [ ] **Step 2:** Note `onChange`: run `readNote` + `prefillPrefs`; set every field not in `touched`. A field's own `onChange` adds it to `touched`. Example chips set the note through the same handler.
- [ ] **Step 3:** Page 2 per spec "Page 2": Back (keeps state), Optional eyebrow, `tripHeadline` headline, five textareas from `PREF_TOPICS`, Skip (create without prefs) and Create trip. Error text under the buttons. On success `router.push(`/trips/${slug}`)`.
- [ ] **Step 4:** `pnpm lint && pnpm build` clean (after Task 5 lands in the same commit if the types require it). Commit `feat(trips): note-first new trip flow` together with Task 5.

### Task 5: `createTrip` for the new flow

**Files:**
- Modify: `src/lib/trips/actions.ts` (`CreateTripInput` ~785, `createTrip` ~813-960)

**Interfaces:**
- Produces: `CreateTripInput = { note: string; days: number; startDate: string | null; budget: number; place: string | null; what: string; prefs: Record<PrefKey, string> | null }`. Result unchanged (`{ error?, slug? }`).

- [ ] **Step 1:** Validate `days` integer 1..365 and `startDate` shape. Derive `name = tripHeadline(what, place ?? "")`, `endDate = startDate + days - 1` (UTC date math), `day_count = startDate ? null : days`, `planned_budget_cents = Math.round(budget * 100)`, `country = place?.trim() || null`, `trip_profile = cleanTripProfile({ ...EMPTY_TRIP_PROFILE, idea: note, ...(prefs ?? {}) })`.
- [ ] **Step 2:** Insert with slug retry: `base = slugify(name) || "trip"`, try `base`, then `base-2` .. `base-9` on `23505`; `.select("id").single()` replaces the separate lookup.
- [ ] **Step 3:** Keep members + default categories (`EXPENSE_CATEGORIES`, no custom categories input). Remove now-unused validation (isDream, fuzzyWhen, lat/lng).
- [ ] **Step 4:** `pnpm lint && pnpm build` clean; commit with Task 4.

### Task 6: Trip page - day count, answers, empty day slots

**Files:**
- Modify: `src/lib/trips/queries.ts` - select `day_count`; `TripHeader.dayCount: number | null`
- Modify: `src/lib/trips/dream-itinerary-types.ts`
- Modify: `src/lib/trips/actions.ts` (`AddDreamDayInput`, `addDreamItineraryDay` ~2383-2455)
- Modify: `src/app/trips/[slug]/page.tsx` (dayCount ~401 and wherever `DreamItineraryTab` is rendered, ~304)
- Modify: `src/app/trips/[slug]/mobile-trip.tsx` (`TripCard`)
- Modify: `src/app/trips/[slug]/dream-itinerary-tab.tsx`

**Interfaces:**
- Produces:
  - `withDreamOrdinals(days: DreamDay[], positional = false)` - when `positional`, `d` = padded `dayIndex` instead of the sort position.
  - `export type DreamSlot = { kind: "day"; day: DreamDay } | { kind: "empty"; dayIndex: number }`
  - `export function dreamSlots(days: DreamDay[], dayCount: number): DreamSlot[]` - positions `1..max(dayCount, max dayIndex)`, rows in place, gaps as empty.
  - `AddDreamDayInput.dayIndex?: number` - when set, insert exactly one row at that index (ignore `count`).
  - `DreamItineraryTab` prop `dayCount: number | null`.

- [ ] **Step 1:** Scratch check `dreamSlots`: rows at 3 and 12 with dayCount 10 -> 12 slots, kinds `empty,empty,day,empty×7,empty,day`... precisely: index 3 and 12 are `day`, others `empty`, length 12. `dreamSlots([], 3)` -> three empties.
- [ ] **Step 2:** Implement types helpers; `addDreamItineraryDay` uses `input.dayIndex` when given.
- [ ] **Step 3:** `queries.ts` exposes `dayCount`. `page.tsx` dream dayCount = `header.dayCount ?? dreamItinerary.length`; pass `dayCount={header.dayCount}` to `DreamItineraryTab`.
- [ ] **Step 4:** `TripCard`: rows Sleeping/Getting around/Doing/Eating/Avoid from new fields; append old Vibe and transport rows when non-empty; Getting around shows `move` else the transport chips. Itinerary detail: dated `"{n} days"`, dateless `"{n} days · no dates yet"` when `dayCount > 0`, else `"no dates yet"`.
- [ ] **Step 5:** `DreamItineraryTab`: when `dayCount` is set, use `positional` ordinals everywhere `withDreamOrdinals` is called and render `dreamSlots` - filled slots as today's sortable cards (SortableContext items stay the row ids), empty slots as a dashed `Day N   + add` button (min-h 48px) that expands the existing add form with `dayIndex` fixed and the count input hidden. With `dayCount` null: unchanged.
- [ ] **Step 6:** `pnpm lint && pnpm build` clean. Commit `feat(trips): day count and empty day slots on dreams`.

### Task 7: Edit page - answers and how long

**Files:**
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx`, `src/app/trips/[slug]/edit/page.tsx`
- Modify: `src/lib/trips/actions.ts` (`UpdateTripInput`, `updateTrip`)

**Interfaces:**
- Produces: `UpdateTripInput.dayCount: number | null`; `EditTripInitial.dayCount: number | null`.

- [ ] **Step 1:** `updateTrip`: dream branch writes `day_count: input.dayCount` (validate 1..365 or null); the two dated branches write `day_count: null` (the RPC path: the RPC clears it; set it only in the non-RPC update).
- [ ] **Step 2:** Form: state for stay/move/acts/food (avoid stays in the walkthrough); a "Preferences" block of four textareas using `PREF_TOPICS` titles/hints, in the edit form's existing input style; "How long" days input shown only while `isDream`. Send `profile: { ...initialProfile, idea, transport, vibe, vibeNote, avoid, stay, move, acts, food }` and `dayCount: isDream ? Number(days) || null : null`.
- [ ] **Step 3:** `pnpm lint && pnpm build` clean. Commit `feat(trips): edit trip answers and dream length`.

### Task 8: Docs

**Files:** `docs/TODO.md`, `docs/DECISIONS.md` (both already hold uncommitted edits - stage only with `git add -p` hunks you wrote, or ask)

- [ ] **Step 1:** TODO: "New trip flow - implemented; build and lint clean; unverified in app" plus the spec's in-app checklist and "paste `20261022000001_trip_day_count.sql`".
- [ ] **Step 2:** DECISIONS rows: one flow for trips/dreams (dates decide the label); pattern matching over AI for the note; `day_count` only for dateless trips with real positions; vibe chips dropped from creation.
- [ ] **Step 3:** Commit `docs: new trip flow in TODO and DECISIONS`.
