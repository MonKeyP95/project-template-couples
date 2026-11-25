# Accept a home trip idea: idea -> filled walk -> rough itinerary

_Brainstormed 2026-11-25. Not built._

## Intent

The home assistant suggests a trip, but the only buttons are "another" and "dismiss": a good idea is a dead
end. Add a third button that accepts the idea and turns it into a trip with as little typing as possible.
The AI's job ends at the suggestion. Everything after it is plain code the couple can edit, and the existing
itinerary and budget assistants stay optional for going further.

## Layers (who does what)

1. **Suggestion + walk answers: one LLM call.** The trip-idea call that writes the suggestion also returns the
   new-trip walk's answers and a rough route. No second call when accepting.
2. **Rough itinerary: no LLM.** Days and locations built from the route, travel days marked; the idea's activities
   become suggestions on their location's days.
3. **Budget: no LLM.** The walk's own budget question; the couple types their estimate. Left blank by the idea
   (the agent never invents prices).
4. **Further:** the existing itinerary walk / Generate and budget Generate, unchanged.

## Goals

- Accepting opens the existing new-trip walk (`/trips/new`) with every answer the idea knows filled in; the
  couple edits anything before creating.
- Creating the trip always builds the rough itinerary (decided 2026-11-25; no "just the basics" switch): one
  location per stop with its days, the first day of each later stop marked as its travel day, and each
  activity as a `trip_suggestions` row.
- Works for both a saved idea and a one-off idea (typed ask or option pill).

## Non-goals

- No new screen for the itinerary: the existing itinerary tab, its suggestion box and drag-to-day are used.
- No second LLM call on accept or on create.
- No dates and no budget from the AI.
- No change to the itinerary or budget assistants.

## Anti-goals (a failure even if it works)

- An activity written straight onto a day as an event. Ideas only ever become events through the day's form
  (existing rule).
- A filled walk the couple can't freely override.
- Invented prices or dates appearing anywhere.

## Approaches considered

- **A. Pass the idea's text as `?note=` and let the existing regex reader fill the walk.** Almost no code, but
  the reader is built for short notes, not AI prose; the fill would be patchy. Rejected.
- **B. The idea call returns the walk's answers and route as structured data (picked).** Same single call, a
  slightly longer output; accurate because the model states what it picked.

For the activities:

- **1. Write them as events on days.** Rejected: breaks the "ideas never become events by themselves" rule.
- **2. All in the suggestion box.** Clean, but the itinerary opens empty.
- **3. On their location's blank days as suggestions, overflow in the box (picked).** Opens looking planned,
  every item still a suggestion; reuses the existing "a suggestion sits on a blank day" behaviour.

## Design

### The idea carries a plan

`propose_trip_idea` gains a `plan` object, returned with label/body/options:

```
plan: {
  place: string          // trip-level destination, the walk's "where"
  what: string           // the walk's "what", short
  days: number           // rough total length, 0 = unknown
  prefs: { stay, move, acts, food, avoid }   // the walk's page-2 answers, "" when unknown
  stops: [{
    name: string         // location name; one stop = the trip's place
    nights: number
    travelDay: boolean   // arriving here takes most of a day (never on the first stop)
    activities: [{ title, kind: "big" | "small", category }]   // category from ITINERARY_CATEGORIES
  }]
}
```

- The saved idea stores it in `home_ideas` as one new `plan jsonb` column (idempotent migration).
- A one-off idea keeps it in client state, like its text today.
- The trip-idea system prompt says: no dates, no prices, stops only when the trip really has more than one base.

### Accept

- A third action on the idea card, "let's do it" (label is my call), next to "another" and "dismiss".
- It opens `/trips/new` with the plan passed along (transport is the builder's call: URL param or similar;
  it must work for one-off ideas that are not stored).
- The walk pre-fills place, what, days and the five prefs from the plan. The idea's body goes into the note.
  Plan-filled fields count as touched (set by hand), so the note reader never overwrites them; `what` and `days`
  become touchable fields for this (my call). The couple's edits always win.
- Accepting does not switch AI mode on: no call is made (my call).
- A saved idea from before the `plan` column has `plan` null: accept still works and fills only the note, like
  the New adventure box today (my call).

### The route on the walk (decided 2026-11-25: option A)

- The walk shows one read-only line, e.g. "Route: Malta 5 nights · Gozo 3 nights (travel day)", with an "x" that
  drops the route. No editable stop list; locations are edited in the itinerary tab after creation.
- Changing **where** drops the route (it belonged to the old destination).
- Changing the **length** (days, or dates) adjusts the last stop's nights to match; if that would take the last
  stop below 1 night, drop stops from the end until it fits (my call on the edge case).
- No route (dropped, or a one-stop idea): the itinerary is one location named after the trip's place, as today.

### Create

- `createTrip` (or a step right after it) receives the stops.
- **Nights to days (my call):** a stop with N nights gets N days; the trip's length is the sum of nights, and the
  walk's length is kept equal to it by the rule above.
- **Travel days (decided 2026-11-25):** no day without a location. A stop with `travelDay` has its first day filed
  under that stop's location and titled "Travel to <stop>". It is a normal day of that location (a dinner on
  arrival fits), not an extra day.
- A new pure function turns stops into the skeleton: locations in order with their day spans and travel-day
  titles. The existing `planItinerarySkeleton` splits evenly and has no travel days, so it is not reused as-is;
  the existing skeleton writer (`applyItinerarySkeleton`) is reused if it fits.
- Each activity becomes a `trip_suggestions` row tied to its stop's location, on that location's first blank
  day not already holding one. **Never on a travel day** (decided 2026-11-25); the couple can still add or drag
  something there themselves. The rest have `day_index` null (the box). Same shape as the planner's `ideaRows`.
- Works for dated trips and dreams (day numbers either way).

## Constraints

- Every SQL file re-runnable; applied by hand in the SQL editor; RLS on.
- `"use client"` files import only from `*-types.ts`.
- Numbers (nights, days) come from the model once and are then the couple's to edit; never AI-rewritten.

## Left to the builder

- How the plan travels from home to `/trips/new`.
- Whether skeleton building lives inside `createTrip` or a follow-up action.
- Tool schema wording and limits (max stops, max activities per stop).

## Success criteria

_Verified by Claude:_
- `pnpm build` and `pnpm lint` clean.
- The stops-to-skeleton function returns the right day indices, locations and "Travel to" titles for: one stop;
  two stops with a travel day on the second; the last-stop adjustment when the length grows, shrinks, or
  shrinks past the last stop.
- Activity placement puts each activity on its location's first free blank day, never on a travel day, and
  overflows to the box.
- Migration re-runs without error.

_Verified by the user in-app:_
1. A saved idea has a "let's do it" button; tapping it opens the walk with place, what, days and prefs filled.
2. Editing any filled field and creating the trip keeps the edit.
3. A two-stop idea shows its route line on the walk and creates two locations; the second one's first day is
   titled "Travel to <stop>". Changing where on the walk removes the route line.
4. The idea's activities appear as suggestions on their location's days; extras sit in the box and drag to a day.
5. A one-off idea (option pill) accepts the same way.
6. No AI call happens between tapping "let's do it" and seeing the new trip.
