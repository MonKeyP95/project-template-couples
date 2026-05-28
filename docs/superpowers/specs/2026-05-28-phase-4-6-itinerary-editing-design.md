# Phase 4.6 — Itinerary Editing (dated trips) — design

**Date:** 2026-05-28
**Status:** Approved, ready for implementation plan.
**Carries from:** `docs/TODO.md` Backlog (2026-05-28 doc audit) → "Add / edit / delete itinerary days from the UI". `PLAN.md:22` lists "richer itinerary editing" as a Phase 4 candidate. Currently `itinerary_days` rows exist only via the Phase 3 SQL seed; the timeline is read-only from the user's perspective.

## Goal

Let any workspace member add a new itinerary day, edit any of an existing day's fields (including `day_date`), and delete a day — all inline on the existing itinerary timeline of `/trips/[slug]?tab=itinerary`. Closes the read-only gap that has stood since Phase 3 step 8.

## Non-goals (deferred to separate slices)

- **Itinerary for dreams (numbered days).** Dreams have no `day_date`. Supporting them requires a real schema decision: relax `itinerary_days.day_date NOT NULL` and add a `day_index int` column (option A), or add a parallel `dream_itinerary` sub-table (option B). Out of scope for this slice; tracked as **Slice B — Itinerary for dreams** in the carried list. The existing `DreamItineraryStub` stays unchanged.
- **Drag-to-reschedule.** Visual drag of a day from one date (or position) to another. Would need `@dnd-kit/sortable` (no drag library in the project yet) and swap-or-reject semantics. Out of scope; tracked as **Slice C — Drag to reschedule**.
- **Date-range validation** (must fall within trip `start_date`…`end_date`). Skipped per user selection in brainstorming. Typo'd far-out dates silently go through. Trivial to add later: one extra check in the action's validation block.
- **Multi-event per day** (a day with several events at different times). The current `itinerary_days` is one row per day. Multi-event would need a child `itinerary_events` table — bigger product call, not on the radar.
- **Bulk delete / reorder selection UI.** Out of scope.

## Schema

No new table. The Phase 3 `itinerary_days` table (`20260527000003_phase_3_itinerary.sql`) already covers everything: `id`, `trip_id` (FK + cascade), `day_date` (with `unique (trip_id, day_date)`), `title`, `sub`, `tag`, `tone` (CHECK in `sea/clay/moss/sand`), `created_by`, `created_at`. RLS via `is_trip_workspace_member()` already covers the new CRUD.

**One small migration** to enable Realtime broadcasts on inserts/updates/deletes:

`supabase/migrations/20260528000004_phase_4_6_itinerary_realtime.sql`

```sql
-- Phase 4.6: add itinerary_days to the Realtime publication so the
-- new ItineraryTab can subscribe to live INSERT / UPDATE / DELETE events.
-- Mirrors the pattern in 20260526000003_phase_3_packing.sql which added
-- packing_items the same way.
--
-- Idempotent: the do-block swallows the duplicate_object error if the
-- table is already in the publication.

do $$
begin
  alter publication supabase_realtime add table public.itinerary_days;
exception
  when duplicate_object then null;
end $$;
```

## Server Actions

Three new exports appended to `src/lib/trips/actions.ts`. Follow the existing patterns. All three `revalidatePath('/trips/'+tripSlug)`; the Realtime channel handles cross-client live sync, revalidate covers same-client navigation.

### `addItineraryDay(input): Promise<AddItineraryDayResult>`

```ts
export interface AddItineraryDayInput {
  tripId: string
  tripSlug: string
  dayDate: string  // yyyy-mm-dd
  title: string
  sub: string
  tag: string
  tone: "sea" | "clay" | "moss" | "sand"
}

export interface AddItineraryDayResult {
  error?: string
  /** Populated on success — full row so client can prepend optimistically. */
  day?: ItineraryDay
}
```

- Validates: `title.trim() != ""`, `tag.trim() != ""`, `dayDate` matches `/^\d{4}-\d{2}-\d{2}$/`, `tone in ITINERARY_TONES` (a new module-local const `["sea", "clay", "moss", "sand"] as const`).
- `sub` is optional — empty string allowed (the existing seed has empty subs on some days).
- Reads `auth.uid()` for `created_by`. RLS gates membership.
- On `23505` (unique `(trip_id, day_date)` collision): returns `{ error: "Another day already uses that date." }`.
- Returns the full `ItineraryDay` (re-derived via `rowToItineraryDay` — see Query Layer below).

### `updateItineraryDay(input): Promise<UpdateItineraryDayResult>`

```ts
export interface UpdateItineraryDayInput {
  dayId: string
  tripSlug: string
  dayDate: string
  title: string
  sub: string
  tag: string
  tone: "sea" | "clay" | "moss" | "sand"
}

export interface UpdateItineraryDayResult {
  error?: string
}
```

- Identical validation to `addItineraryDay`.
- Single `UPDATE itinerary_days SET day_date, title, sub, tag, tone WHERE id = dayId`. `created_by` and `created_at` never touched.
- Same `23505` → friendly-error translation (covers the "I changed the date to one another day uses" case).

### `deleteItineraryDay(dayId, tripSlug): Promise<void>`

- Throws on error (form-action shape like `deleteNote` / `deleteTrip`).
- Single `DELETE FROM itinerary_days WHERE id = dayId`. RLS gates.

## Query layer

Existing `src/lib/trips/itinerary-queries.ts` already exports `ItineraryDay` and `getItineraryDays`. Two small additions:

1. **Export `rowToItineraryDay`** (currently inlined inside `getItineraryDays`) so `addItineraryDay` can re-derive the `d`/`dow`/`date` ordinal+display fields from the inserted row. Tiny refactor: lift the existing `.map(...)` body into a named function and export it.
2. **Export `ITINERARY_TONES`** (`["sea", "clay", "moss", "sand"] as const`) plus its type alias `ItineraryTone`. The pill picker in the UI imports this; the validation block in the action imports it. Currently the tone literal type is defined inline on `ItineraryDay`; replace with `tone: ItineraryTone`.

**Ordinal re-derivation behavior** (worth flagging for the implementer): the `d` field (`"01"`, `"02"`…) is derived from the day's position in the sorted list, not from any column. So an `UPDATE day_date` shifts not only that day's ordinal but every later day's too. A `revalidatePath` triggers a full refetch via `getTripItineraryDays`, so the ordinals stay correct without any client-side recomputation. Realtime UPDATE events arrive as individual row deltas — the client's local-state reconciliation re-sorts by `day_date` after each event, then re-pads ordinals via a small helper. (Spec for that helper: take a sorted-by-day_date array, return the same array with `d` recomputed as `String(i + 1).padStart(2, "0")`.)

## UI

### New file: `src/app/trips/[slug]/itinerary-tab.tsx` (`"use client"`)

Replaces the currently-server-rendered `ItineraryView` (which lives inline in `page.tsx`). The existing day-row rendering moves into this client file so it can host edit state, the add form, and the Realtime channel. The `SuggestionCard` at the bottom of the existing `ItineraryView` (`/ assistant` stub from Phase 3 step 10) moves with it — preserved as the Phase 5 anchor, not deleted.

**Component structure:**

```
<ItineraryTab>
  <header>/ Itinerary    drafted by ●M+G</header>
  <DayList>
    <DayCard isEditing={editingId === day.id} ...>   // per day
      <DayView | DayEditor based on isEditing>
    </DayCard>
    ...
  </DayList>
  <AddDayRow />              // collapsed +-button or expanded form
  <SuggestionCard ... />     // preserved Phase 5 anchor
</ItineraryTab>
```

**`DayView`** renders the existing day-row layout (left: ordinal `d` + `dow` + connector line; right: card with `MonoBadge tag` + `title` + `sub`, per-tone left border via existing `itineraryBorder` map). Adds `✎` and `×` affordances inside the card, bottom-right — same tone as the notes-tab ones (`text-muted-foreground hover:text-foreground` for edit, `hover:text-clay` for delete).

**`DayEditor`** renders a form with five fields:

- **Date** — native `<input type="date">`, pre-filled with `day.day_date` (yyyy-mm-dd).
- **Tag** — text input, pre-filled with `day.tag`. Free-text (4-12 chars practical, no hard limit enforced); `MonoBadge` styles it mono+uppercase visually.
- **Title** — text input, pre-filled with `day.title`.
- **Sub** — text input, pre-filled with `day.sub`.
- **Tone** — four pills `[● sea] [● clay] [● moss] [● sand]`, radio-style single-select, each pill showing a colored dot prefix. Same pattern as the `paid_by` toggle in `LogExpenseRow`.

Save / cancel buttons at the bottom-right, matching `NoteEditor` shape. `useState(day.fieldValues)` initializers fire on mount → no `useEffect` reset needed → React 19 lint clean by construction (per `memory/feedback-react19-lint-gotchas.md`).

**`DayCard`** is the parent that switches between `DayView` and `DayEditor` based on `editingId === day.id`. Same lifted-state shape as `NoteCard` in the notes tab.

**`AddDayRow`** sits at the bottom of the day list, above `SuggestionCard`:

- **Collapsed:** dashed-border `+ add day` button styled like the `+ new trip` CTA on `/home`.
- **Expanded:** the same five-field form as `DayEditor`, with the date pre-filled to `(max existing day_date + 1 day)` or `trip.start_date` if no days exist (computed once on expand). `save` calls `addItineraryDay`, clears + collapses on success. `cancel` collapses without saving.

**Empty state:** when `initialItems.length === 0` AND trip is not a dream, render a small italic line "No days planned yet — add the first one." plus the `AddDayRow` (so the user can act). The dream `DreamItineraryStub` (rendered upstream in `page.tsx` when `header.startDate === null`) continues unchanged.

### Optimistic state + Realtime

`ItineraryTab` holds `useState<ItineraryDay[]>(initialItems)`. Patterns mirror `PackingTab`:

- **Optimistic add:** on `addItineraryDay` returning success, prepend (then re-sort by `day_date`, then re-pad ordinals).
- **Optimistic update:** on `updateItineraryDay` success, splice the updated row in place (then re-sort + re-pad).
- **Optimistic delete:** remove from local state before the action resolves; on error revert.
- **Realtime channel:** `useEffect` opens a Supabase channel filtered on `trip_id = tripId`, listens for `INSERT`/`UPDATE`/`DELETE` on `public.itinerary_days`. Each event reconciles against local state via id-dedupe (the actor's own event is a no-op because the row is already there from the optimistic update). On reconcile, re-sort by `day_date` + re-pad ordinals.

### Integration with `page.tsx`

Three small edits to `src/app/trips/[slug]/page.tsx`:

1. **Add import** `import { ItineraryTab } from "./itinerary-tab"`.
2. **Always fetch itinerary** for dated trips (drop the lazy `activeTab === "itinerary"` guard for non-dreams, so the count can show on Desktop tabs from any tab). Or keep it lazy and accept "Itinerary count only appears when you're on the Itinerary tab" — same as current. Recommend: **keep lazy**; consistency over a small UX nicety.
3. **Replace** the existing inline conditional:

   ```tsx
   {activeTab === "itinerary" ? (
     itinerary && itinerary.length > 0 ? (
       <ItineraryView itinerary={itinerary} />
     ) : header.startDate === null ? (
       <DreamItineraryStub />
     ) : (
       <TabStub label="Itinerary" />
     )
   ) : ...}
   ```

   With:

   ```tsx
   {activeTab === "itinerary" ? (
     header.startDate === null ? (
       <DreamItineraryStub />
     ) : (
       <ItineraryTab
         tripId={header.id}
         tripSlug={header.slug}
         tripStartDate={header.startDate}
         initialItems={itinerary ?? []}
         members={memberTones}
       />
     )
   ) : ...}
   ```

   `tripStartDate` is non-null for dated trips (the only branch that renders `ItineraryTab`). `AddDayRow` uses it as the fallback pre-fill when no days exist yet.

   `ItineraryTab` handles both populated and empty states internally, so the `TabStub label="Itinerary"` branch goes away. `ItineraryView` (the inline server-rendered helper) and its `ItineraryRow` companion are no longer used and can be removed from `page.tsx`.

4. **Move the `SuggestionCard`** from inside the old `ItineraryView` into `ItineraryTab` (below the day list, above the closing tag). This preserves the Phase 5 AI anchor.

## File-level summary

**New files:**

- `supabase/migrations/20260528000004_phase_4_6_itinerary_realtime.sql` — adds `itinerary_days` to the Realtime publication.
- `src/app/trips/[slug]/itinerary-tab.tsx` — client component (DayCard / DayView / DayEditor / AddDayRow + Realtime channel + optimistic state).

**Modified files:**

- `src/lib/trips/actions.ts` — append `addItineraryDay`, `updateItineraryDay`, `deleteItineraryDay` plus input/result types. Import `ITINERARY_TONES`, `rowToItineraryDay`, `ItineraryDay` from `itinerary-queries.ts`.
- `src/lib/trips/itinerary-queries.ts` — export `rowToItineraryDay` (lifted from the existing inlined `.map(...)`) and `ITINERARY_TONES` + `ItineraryTone` type. Replace inline tone literal on `ItineraryDay` with `ItineraryTone`.
- `src/app/trips/[slug]/page.tsx` — drop inline `ItineraryView` + `ItineraryRow` helpers + `TabStub` branch for itinerary; add `ItineraryTab` import; rewire conditional render.

**Unmodified (called out so the plan doesn't drift):**

- `src/components/together/suggestion-card.tsx` — preserved verbatim; just moves render location.
- `DreamItineraryStub` — unchanged.
- All other tabs (packing, budget, notes) — unchanged.

## Decisions worth a `DECISIONS.md` row after shipping

1. **Realtime for itinerary, RefreshOnVisible for notes** — opposite Realtime call from the notes slice despite both being trip-content. Rationale: itinerary is synchronous-collaborative (planning together the night before a trip); notes are async (jotting stuff over weeks). The kitchen-table case decides Realtime is worth the WebSocket.
2. **Date editable with `23505` collision translation** — symmetric form for add and edit; collision (target date already used by another day) returns "Another day already uses that date." Mirrors the slug-rename pattern in `updateTrip`.
3. **No date-range validation in v1** — explicit YAGNI; typo'd dates silently go through. One-line addition to the action's validation block when felt.
4. **Tone-as-pills, tag-as-free-text** — pills for the 4-value bounded enum; free-text for the open-ended label. Matches the `LogExpenseRow` paid_by toggle pattern for the bounded case.
5. **`SuggestionCard` moves into `ItineraryTab`, doesn't get deleted** — Phase 5's AI surface anchor stays exactly where users expect it (below the day list).

## Out-of-spec follow-ups (carried)

- **Slice B — Itinerary for dreams.** Numbered days (1, 2, 3…) for trips without dates. Real schema decision: relax `day_date NOT NULL` + add `day_index int`, or add parallel `dream_itinerary` table. Brainstorm separately.
- **Slice C — Drag to reschedule.** Add `@dnd-kit/sortable`, drag handlers on the day list, swap-or-reject when dragging to an occupied date. Works for both dated trips and dreams (once B ships).
- **Date-range validation** (must fall within trip start/end) — one-line action-validation extension whenever the looseness bites.
- **Multi-event per day / events with times** — new child table; out of current scope.
