# Plan itinerary on dreams - design

Date: 2026-10-23. Follows `2026-10-22-new-trip-flow-design.md`.

## Why

The user's planning vision: basic profile -> the couple adds what they want ->
the assistant fills the gaps -> they review. A trip with dates has the guided
**Plan your itinerary** walk (`src/app/trips/[slug]/plan-itinerary.tsx`). A
dream (no dates) has never had it, so the new note-first flow - where "no
dates" is common - lands people on an itinerary with no assistant. The user's
words: "the dream trip is just a header" - it should work like a trip, with
the same button and walk.

## Decision (user's)

Option 1: **same button, same walk; results land in the dream's day cards.**
Not option 2 (making a dream's itinerary the dated itinerary, numbered) -
that rewrites the dated itinerary and reverses the "empty days stay derived"
decision.

## Goals

- The dream itinerary tab shows the same "Plan your itinerary" button,
  opening the same walk: Places -> per place Accommodation / Food /
  Activities -> Transportation -> Anything else -> review with Generate and
  apply.
- Wherever the dated walk picks a date or range, the dream walk picks a day
  or a day range (`Day 3`, `Day 3 - 5`), within `1..dayCount`.
- **Generate** drafts a rough plan and writes it into **empty positions
  only**; days the couple filled are inputs (known plans), never changed.
- **apply** writes the couple's own entries, no AI, onto the days they picked
  (empty positions only).

## Non-goals

- A review/confirm step before writing. The dated planner writes on
  Generate; the dream one does the same (the user asked for "the same").
  Vision step 4 (review + confirm) is the later assistant project.
- Reading existing dream days back into the walk's rows (the dated walk
  seeds from events; dream cards have no categories). The walk opens with the
  places only; filled days reach the AI as known plans.
- Locations, events, times on dreams. A dream day stays one card.
- Changing the dated planner's behaviour.

## Anti-goals

- Overwriting or moving a day the couple filled.
- Inventing a place the couple did not name (same grounding rule as the dated
  planner: never leap from a country to a city).
- Asking the user for things the walk already asks on trips in a different
  shape - the walk must feel the same.

## The walk on a dream

Reuse `PlanItinerary` with a small "calendar" seam rather than a fork:

- **Day pickers.** Each entry row's date input (and the range toggle) is a
  day select `Day 1..Day N` for dreams. `ItemRow.whenStart/whenEnd` hold the
  day number as a string for dreams; `rangeLabel` shows `Day 3` /
  `Day 3 - 5`. The free note stays.
- **Places step.** Seeds with the distinct `tag`s of existing dream cards in
  day order; with no cards, the trip's place (`country`, else the name).
  This deliberately differs from the dated walk, which seeds `tripName`
  (`plan-itinerary.tsx:73-76`): on a dream, `country` holds the typed place
  and `name` is a headline. (My call.) For a dream with `dayCount` null
  (older dreams), this step also asks "How many days?" (required, min = the
  number of cards, max 365), and `openWalk` must not skip the Places step in
  that case (`plan-itinerary.tsx:145-149` jumps past it when days exist).
- **Title.** "Plan your itinerary" when no dream days exist, "Edit your
  itinerary" otherwise (same rule as dated).
- **Generate / apply** call dream actions (below) instead of the dated ones.

Builder's call: how the seam is expressed (a `calendar: "dates" | "days"`
prop plus `dayCount`, or two thin wrappers around a shared body). Keep the
dated path's behaviour byte-for-byte the same.

## Server actions (new, in `src/lib/ai/itinerary-actions.ts`)

- `applyDreamPlanEntries({ tripId, tripSlug, places, entries, avoid, dayCount })`
  - Writes `avoid` back (existing `persistAvoid`) and `day_count` if it was
    asked for. **Setting a length on an older dream first closes gaps**:
    cards are renumbered 1..k in their current order (existing
    `reschedule_dream_itinerary_days` RPC or equivalent), so no card visibly
    jumps. (My call - honours "never move a filled day".)
  - Entries are spread onto days exactly as the dated walk spreads them onto
    dates (`entryDates`, `itinerary-planner.ts:271-291`): Accommodation and
    Transportation ranges land on their two ends with the same bracket labels
    ("Check in: X" / "Check out: X", "Pick up" / "Drop off"); other categories
    repeat across the range. Run on day numbers instead of dates.
  - One card per empty day from everything landing on it: `tag` = the
    entry's place (trip's place for trip-wide entries); `title` from the
    highest-priority item - Activities, then Food, then Accommodation, then
    Transportation, then Other - so a stay does not title every day; the rest
    join `sub` with " · "; `tone` from the title item's category
    (Accommodation sand, Food clay, Activities sea, Transportation moss,
    Other sand). An item with only a day picked uses its category as its text
    (as the dated path does, `itinerary-actions.ts:200`), since `title` and
    `tag` must be non-empty. (My calls.)
  - Filled days are never written. Entries without a day: ignored by apply
    (as on trips); they still feed Generate.
- The spreading and card-building is a pure module (e.g.
  `src/lib/ai/dream-plan.ts`) so it can be checked without the database.
- `draftAndApplyDreamItinerary({ tripId, tripSlug, places, entries, freeText, avoid, dayCount })`
  - Known plans = the walk's entries **plus** every existing dream card
    (`Day N: tag - title - sub`).
  - Calls the dream planner agent (below), maps events to positions, and
    writes only empty positions, building cards as in apply.
  - An event with no day, or a day out of range, falls back to the first
    empty day in its place's span; an event on a filled day is dropped (as
    the dated path skips taken dates, `itinerary-actions.ts:123-126`). (My
    call.)
  - If the agent returns a clarifying `question` and no events, the action
    returns it as the error text so the walk shows it (the dated path
    silently succeeds with nothing written; this is a deliberate
    improvement for dreams only). (My call.)
  - Otherwise same contract as `draftAndApplyItinerary` (never throws; one
    friendly error string). Pressing Generate is approval, so it runs
    regardless of the global assistant toggle.

## The agent - a new descriptor

The dated agent's tool (`propose_itinerary`, `src/lib/ai/registry.ts:79-88`,
`strict: true`) describes `date` as YYYY-MM-DD, and that text is shared, so
day mode cannot live in the same descriptor without contradicting it or
changing the dated planner. Instead: **new descriptor
`src/lib/ai/agents/dream-itinerary-planner.ts`** with a new registry tool
`propose_dream_itinerary` whose events carry `day` (integer 1..N, 0 = can't
place it) in place of `date`, other fields as `propose_itinerary`. Its system
prompt is the dated one's grounding/sparseness rules with the date sentences
replaced by day ones, plus: "Several items may share a day; the app turns
each day into one short card." Same model as the dated planner. Exported
through `src/lib/ai/claude.ts` like the others. (My call; keeps the dated
path untouched and follows "one file per agent".)

Places in day mode: split `1..N` across the walk's places in order, the same
way `planItinerarySkeleton` splits dated days (reuse its splitting, on day
numbers); each place's `dateLabel` reads `Days 1-4`.

## Trip page

`DreamItineraryTab` renders `PlanItinerary` (day mode) under the slots and
the "+ add day" row - **just the planner**, not the `AssistantBlock` /
`PlanningPlaceDoor` pair the dated tab shows above it: the block's day
overview reads only `itinerary_days` (`suggestion-actions.ts:287-304`, would
say "No days yet" on every dream) and the door writes dated events
(`find-a-place-planning.tsx`). (My call; bringing those to dreams is a
separate slice.) `page.tsx:301-306` passes the extra props the planner needs
(`tripName`, `destination` = country ?? name, `avoid`).

The dated tab passes `plannerDays` (days from today onward on an active
trip, `itinerary-tab.tsx:552`); dream mode has no "today", so it passes all
cards.

## Constraints

- Client files import from `*-types.ts`/pure modules only.
- No new table, no migration (positions and `day_count` already exist).
- Dates/day labels `en-GB` style; no emojis; sparse comments.
- Commit only touched files; never `pnpm build` while `pnpm dev` runs.

## Success criteria

Verified by Claude:

1. `pnpm lint` and `tsc --noEmit` clean.
2. Pure mapping (entries/events -> dream cards) returns: an Activities entry
   and a Food entry on Day 3 plus a Day 3-4 Accommodation, with Day 4 already
   filled -> Day 3 one card titled by the activity, sub holding the food and
   "Check in: ..."; Day 4 untouched; a trip-wide entry tagged with the trip's
   place; an entry with only a day picked titled by its category.
2b. Gap closing: cards at day_index 1, 2, 5 with a new length of 6 end at
   1, 2, 3; a length below the card count is rejected.
3. Day splitting for places `["Lisbon","Ericeira"]` over 10 days gives
   Lisbon 1-5, Ericeira 6-10 (or whatever `planItinerarySkeleton`'s rule
   yields for dates, applied to days - the same split).
4. The dated walk's code path is unchanged (diff review: dated callers pass
   the same props and hit the same actions).

Verified by the user in-app:

1. A dream's itinerary shows "Plan your itinerary" under the day slots.
2. The walk has the same steps as on a trip; its pickers say Day 1..N.
3. apply puts entries on the chosen empty days; filled days unchanged.
4. Generate fills empty days with place-tagged cards built around the filled
   ones and the five answers; no filled day changes.
5. An older dream without a length asks "How many days?" and then shows that
   many slots, with its existing cards on Day 1..k in their old order.
6b. Reopening the walk after a Generate lists the same places again.
6c. If the planner can't ground the place, its question shows in the walk.
6. The trip version of the planner still works as before.
