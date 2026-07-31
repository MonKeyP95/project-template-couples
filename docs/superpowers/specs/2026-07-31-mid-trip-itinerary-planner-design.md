# The itinerary planner during a running trip

Status: designed 2026-07-31, not yet built.

## The problem

Open a trip whose dates include today and the guided itinerary planner is gone.
`itinerary-tab.tsx` renders `{active ? null : (planningBlock + PlanItinerary)}`
against `tripActive(today, start, end)`, so the walkthrough disappears the
moment a trip starts.

The rest of the active-mode treatment is deliberate and stays: past days
collapse, empty slots before today are filtered out, earlier days dim, and
`planningBlock` (the `+ location` button and the itinerary `AssistantBlock`)
moves *below* the timeline at 70% opacity rather than vanishing. Only
`PlanItinerary` has no on-the-road presence at all.

That is a defect rather than a preference: on day 3 of a 14-day trip you still
want to plan days 4-14, and `/on-the-road` covers only today, so the itinerary
tab offers no replacement. It contradicts the standing rule that every feature
is designed for both modes.

## The hazard that shapes the design

The walk owns every event it shows, and applying **rewrites** rather than
diffing (see `DECISIONS.md`, 2026-07-29). `applyPlanEdits` ends with:

```ts
// Existing days: rewrite the event list to what the walk holds for that date.
for (const day of days) {
  const next = byDate.get(day.dayDate) ?? []
  ...
  await updateItineraryDay({ dayId: day.id, ..., events: next })
```

It iterates **every day the server reads from the database** and sets each day's
events to whatever the walk holds for that date -- an empty array if nothing.

The consequence is the trap in this whole slice: **seeding the walk with only
today-onward days, and doing nothing else, would destroy the past.** Days 28-30
Jul would carry no entries, `next` would be `[]`, and Apply would empty them --
including events carrying ratings and the events expenses link to. The obvious
client-side fix makes the data loss more likely, not less.

`applyPlanEntries` also re-reads days server-side
(`const existingDays = await getItineraryDays(input.tripId)`), so the client's
filtered list never reaches the rewrite loop anyway.

## Shape

Two halves. Only the first is a safety property.

### A. A server-derived floor

`applyPlanEntries` computes the floor itself rather than accepting one as input.
A client-supplied floor could be absent or wrong, and the blast radius is
"silently empties days that already happened" -- that decision does not belong
on the wire. The action already loads the trip, so it calls the existing
`tripActive`: an active trip floors at today, anything else has no floor.

The floor does exactly two things inside `applyPlanEdits`:

1. **The rewrite loop skips days before it.** A pre-floor day is never passed to
   `updateItineraryDay`, so it cannot be emptied, reordered, or touched.
2. **`fallbackDate` clamps to it.** Today `fallbackDate` resolves an undated row
   to its place's first day, else `days[0].dayDate` -- mid-trip both can be in
   the past, and a row targeting a skipped day would be silently dropped.

### B. Client scoping

`itinerary-tab.tsx` passes `days` filtered to `>= today` while the trip is
active, so the walk opens on the days that remain. `PlanItinerary` moves inside
`planningBlock`, which already renders in both branches, so mid-trip it appears
at the bottom of the tab, dimmed, beside `+ location` and the assistant. No new
placement logic and no second render site.

This half is UX only. If it were removed the data would still be safe.

### Locations stay unfiltered

Hiding places you have already left is tempting and wrong. The positional rename
is guarded by `input.places.length === locations.length`
(`itinerary-actions.ts:163`); sending fewer places than the trip has locations
breaks that count and silently disables renaming for the rest of the trip.
Showing a place you have left is mild noise; losing rename is a real regression.

### Undated rows land on the first remaining day of their place

With a floor in place, an undated new row resolves to the first day of its place
that is at or after the floor, falling back to the first trip day at or after
the floor. A row for the place you are in lands on today; a row for a place you
reach next week lands on that place's own first day, not on today.

## New pure helpers

Both live beside `tripActive` in `src/lib/trips/itinerary-types.ts`, pure and
client-safe:

- `planFloor(today, startDate, endDate): string | null` -- `today` while the
  trip is running, `null` otherwise. A thin named wrapper over `tripActive`, so
  the rule has one home and can be asserted directly. `endDate` is nullable on a
  trip, so callers pass `endDate ?? startDate`, matching what `itinerary-tab.tsx`
  already does for `tripEndDate`; a dateless dream never reaches this code.
- `firstDayAtOrAfter(days, floor, locationId?): string | undefined` -- the
  earliest day at or after `floor`, optionally restricted to one location.

## Files

- `src/lib/trips/itinerary-types.ts` -- the two helpers
- `src/lib/ai/itinerary-actions.ts` -- derive the floor in `applyPlanEntries`;
  thread it into `applyPlanEdits`; skip pre-floor days in the rewrite loop;
  clamp `fallbackDate`
- `src/app/trips/[slug]/itinerary-tab.tsx` -- move `PlanItinerary` into
  `planningBlock`; filter `days` to `>= today` when active

No migration, no new dependency, no new file, no change to `logExpense` or any
other action's signature.

## Deliberately not in scope

**The same rewrite hazard exists for a finished trip.** Once a trip ends
`tripActive` is false, so there is no floor, the planner offers the whole
itinerary, and Apply can overwrite days that already happened. That is
pre-existing behaviour and a separate decision -- flooring a past trip means
deciding whether its itinerary is editable at all, which this slice does not
answer.

Dateless dreams are also untouched: `DreamItineraryTab` contains no
`PlanItinerary` on any code path, which is a different question from this one.

## Success criteria

### Verified by Claude

1. `npx tsc --noEmit` and `pnpm lint` clean. `pnpm build` only if the dev server
   is down; otherwise recorded as owed.
2. The two pure helpers checked by a throwaway `tsx` script (this project has no
   test framework and must not gain one):
   - `planFloor("2026-07-31", "2026-07-28", "2026-08-10")` is `"2026-07-31"`
   - `planFloor("2026-07-20", "2026-07-28", "2026-08-10")` is `null`
   - `planFloor("2026-08-20", "2026-07-28", "2026-08-10")` is `null`
   - `firstDayAtOrAfter` returns today's date for a location straddling today,
     the location's own first day when the location is wholly future, the first
     trip day at or after the floor when no location matches, and the first day
     of all when `floor` is `null`
3. Read-verified: the `for (const day of days)` rewrite loop in `applyPlanEdits`
   `continue`s when `floor && day.dayDate < floor`, so `updateItineraryDay` is
   provably never reached for a pre-floor day.
4. `applyPlanEntries` derives the floor from the trip it already loads -- its
   input type gains no floor field.
5. `<PlanItinerary` appears exactly once in `itinerary-tab.tsx`, inside
   `planningBlock`.

### Verified by the user in-app

1. On a running trip, the Itinerary tab shows the planner at the bottom, dimmed,
   beside `+ location`.
2. Opening it seeds rows from today onward only -- nothing from earlier days.
3. **Apply, then check the days before today: events unchanged, ratings intact,
   expenses still linked.** This is the criterion the slice exists for.
4. A new undated row for the current place lands on today; one for a later place
   lands on that place's first day.
5. The Places step still lists every location, and renaming one still works.
6. A future-dated trip is unchanged -- planner at the top, whole trip editable.
7. At a 440px viewport the planner reads correctly at the bottom of the tab.
