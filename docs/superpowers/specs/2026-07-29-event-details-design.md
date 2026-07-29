# Free-text details on an itinerary event

**Date:** 2026-07-29
**Status:** design, approved

## Problem

An itinerary event is one line of text — "Dinner at Stefano's". There is nowhere
to put what you actually need at the moment the event arrives: the address, the
booking name, the door code, "cash only". Today that either gets crammed into the
event text, making the day unreadable, or lives outside the app.

## Why not reuse `note`

`ItineraryEvent` already has `note?: string`, but it belongs to `EventRating`: a
retrospective note captured *with* a rating, only reachable once
`day.dayDate < today` (`itinerary-tab.tsx:1427`), and `rateEvent` writes it from
its own input. Reusing it would mean rating a dinner wipes its address. Details
are plan-time information with a different lifetime, so they get their own field.

## Design

### 1. The field

`details?: string` on `ItineraryEvent`. Optional, omitted when empty, the same
shape as `url` and `category`. Events are jsonb — no migration.

### 2. Authoring

One free-text line per event in the day editor, directly under the existing
"link (optional)" input (`itinerary-tab.tsx:1933-1946`). A `rows={2}` textarea
rather than an `<input>`: details wrap ("Booked 19:30 under Noam. Via Roma 4, ring
the top bell. Cash only."), and the project already uses that shape for the trip
`avoid` answer and the planner's free text. Add-a-day and edit-a-day share this
editor, so both get it from the one change.

### 3. Reading — planning mode

Details render under the event text inside the already-expanded day
(`itinerary-tab.tsx:1400`), in muted secondary type. **No new gesture:** pressing
the day is the reveal. Pressing the event text still opens the expense form,
unchanged. An event with no details renders exactly as it does today.

### 4. Reading — on the road

Details render under the event in `TodayUpcoming` (`today-upcoming.tsx:75`), so
they are in front of you when the event comes up.

Deliberately **not** in `today-past.tsx`: an address you have already used is
noise on a screen whose job is what happens next.

### 5. Write path

Six places re-shape an event and would silently drop a new field. All six must
carry `details`:

1. `ItineraryEvent` — `itinerary-types.ts:4`
2. `parseEvents` — `itinerary-types.ts:90`
3. `normalizeDayEvents` — `actions.ts:1487`
4. `EventDraft` + `newEventDraft` + the day-to-draft map — `itinerary-tab.tsx:111`, `:123`, `:150`
5. The add-day draft-to-event map — `itinerary-tab.tsx:1521`
6. The edit-day draft-to-event map — `itinerary-tab.tsx:1621`

Two paths already carry unknown fields through and need no change: `rateEvent`
(`actions.ts:1631`) spreads the existing event, and the guided walk's
`applyPlanEdits` spreads `{...original, text, category}`, so details survive both
a rating and an itinerary edit.

### 6. Not in a public share

`shared-trip-types.ts:27-38` keeps only `time`, `endTime` and `text` on purpose.
Details stay stripped — booking names and door codes should not leave the
workspace.

## Success criteria

### Verified by Claude

1. `pnpm lint` and `pnpm exec tsc --noEmit` pass; `pnpm build` passes when the dev server is stopped.
2. `parseEvents({ text: "x", details: "y" })` yields an event carrying `details: "y"`; `parseEvents({ text: "x", details: "" })` yields one with no `details` key.
3. `normalizeDayEvents([{ time: "", text: "x", details: " y " }])` yields `details: "y"`; a whitespace-only value yields no `details` key.
4. The day-to-draft map and both draft-to-event maps round-trip `details` — a saved day loaded into the editor and saved again unchanged keeps its details.
5. `shared-trip-types.ts`'s `parseEvents` still emits no `details` key.
6. No migration file is added.

### Verified by the user in-app

1. Adding a day: each event row has a details box under its link box.
2. Editing a day: existing details appear in that box and survive a save.
3. Expanding a day shows the details under the event text; a collapsed day does not.
4. An event with no details looks exactly as it did before.
5. Pressing the event text still opens the expense form.
6. Rating a past event does not erase its details.
7. On `/on-the-road`, an upcoming event shows its details; a past one does not.
8. Editing the itinerary through the guided walk does not erase details.
9. Readable at a phone viewport, light and dark.
