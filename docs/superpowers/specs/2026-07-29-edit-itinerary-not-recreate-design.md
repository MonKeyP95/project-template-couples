# Editing an itinerary through the guided walk

**Date:** 2026-07-29
**Status:** design, approved

## Problem

Reopening "Plan your itinerary" on a trip that already has one behaves like a
fresh start, not an edit. Two independent causes:

1. **The walk never remembers.** `plan-itinerary.tsx:75-82` seeds every open with
   `placeNames=[""]`, `items={}`, `freeText=""`. Nothing is read back.
2. **The write path is add-only and unaware of the real itinerary.** Both terminal
   actions build `planItinerarySkeleton` — an even split of the trip's days across
   the places you just typed — ignoring the actual locations and their date spans.
   `applyItinerarySkeleton` (`itinerary-actions.ts:94-97`) then *skips any date that
   already has a day*.

So a second run either silently drops nearly everything (all dates taken) or
creates locations alongside the existing ones.

This matters beyond tidiness: the guided walk is the easiest front door for asking
the assistant for help, so it has to be usable on a trip mid-plan, not only on an
empty one.

## Approach

Mirror the budget drafter, which already solved this: it takes `initialItems`,
reads them back into step buckets (`savedRows()`), keeps a `serverId` on prefilled
rows so a save updates in place (`savedPreTripRows()`), and relabels its button
"Edit budget" when one exists (`budget-drafter.tsx:611`).

No new concepts. No AI changes.

## Design

### 1. Prop

`PlanItinerary` gains `locations: ItineraryLocation[]` and `days: ItineraryDay[]`.
Both are already in scope at `itinerary-tab.tsx:703-704` — pass them through.

### 2. Prefill

A pure, client-safe function in `itinerary-planner.ts`, twin of `savedRows()`:

- **Places step** ← existing location names in order, each carrying its location id.
- **Entry steps** ← every event of every day, as one row:
  - `subject` = `event.text`
  - `whenStart` = the day's `dayDate`
  - `serverId` = `${day.id}#${eventIndex}` — the handle that makes a save a patch
- **Step routing** by `event.category`: Accommodation / Food / Activities go to the
  per-place step for the day's location; Transportation and Other go to the
  trip-wide steps. A missing category routes to Other. A day with no location
  falls to place 0 (same fallback as `savedRows()`).
- **No itinerary yet** → the walk opens blank, exactly as today.

Every event is representable as a row, so nothing is invisible to the walk.

### 3. Save (`apply`)

`PlanEntry` gains an optional `serverId`. `applyPlanEntries` branches at the top:
when the trip already has itinerary days, take the edit path.

The rule is one sentence: **the walk owns every event, and applying writes the
walk's state back.**

- A row with a `serverId` patches that event: `text`, `category` and date come from
  the row; `time`, `endTime`, `url`, `rating` and `note` are carried over from the
  original event object. Ratings and booking links survive a re-save.
- A prefilled row you deleted means that event is gone.
- A row whose date you changed moves that event to the day for the new date.
- A row with no `serverId` is new and is added as today.
- A day left with no events stays as an empty day. The walk never deletes days.
- A new row on a date that has no day creates one under the location whose span
  covers that date, else under the place chosen in the walk.

The edit path does not call `planItinerarySkeleton` or `entriesToSkeleton` at all:
every entry already carries a real date, so there is nothing to scaffold. This is
less code than patching the even-split scaffold, and it is cause (2) fixed.

### 4. Places

Prefilled place rows carry their location id. Renaming one renames that location
(`renameItineraryLocation`). A newly typed place creates a location as today.
**Removing a place row does not delete the location** — deleting a location is
destructive and already has a home in the itinerary tab.

### 5. Label

The closed button reads "Edit your itinerary" when the trip has itinerary days,
"Plan your itinerary" when it does not.

### 6. Generate — unchanged

`generate()` and `draftAndApplyItinerary` are not touched. Because the entries now
include everything already in the itinerary, Claude receives the real plan as
`knownPlans` and fills gaps instead of drafting from zero. This falls out of the
prefill for free.

## Files

- `src/lib/ai/itinerary-planner.ts` — prefill function; `serverId` on `PlanEntry`
- `src/app/trips/[slug]/plan-itinerary.tsx` — props, seeded state, button label
- `src/app/trips/[slug]/itinerary-tab.tsx` — pass `locations` and `days`
- `src/lib/ai/itinerary-actions.ts` — edit branch in `applyPlanEntries`

## Success criteria

### Verified by Claude

1. `pnpm build` and `pnpm lint` pass.
2. The prefill function is pure and importable from a `"use client"` file — it
   pulls no `next/headers`, no server query layer.
3. Given a location "Lisbon" and a day `2026-01-12` under it with events
   `[{text:"Casa do Bairro", category:"Accommodation"}, {text:"Ferry", category:"Transportation"}]`,
   the function returns `placeNames === ["Lisbon"]`, one row under
   `accommodation:0` with `subject "Casa do Bairro"` and `whenStart "2026-01-12"`,
   and one row under `transportation:trip`.
4. Given zero locations and zero days, it returns the blank state the walk uses today.
5. An event carrying `rating` and `url` round-trips through prefill → `apply`
   unchanged in the events written by the server action.
6. The edit branch of `applyPlanEntries` calls neither `planItinerarySkeleton` nor
   `entriesToSkeleton`.
7. `draftAndApplyItinerary` is unchanged.

### Verified by the user in-app

1. On a trip with an itinerary, the closed button reads "Edit your itinerary".
2. Opening it shows your real places on step 1, and your real stays/food/activities
   on the following steps, on their real dates.
3. Changing a row's text and pressing apply updates that event in the itinerary —
   no duplicate appears.
4. Deleting a prefilled row and pressing apply removes that event.
5. Changing a prefilled row's date moves that event to the new day.
6. An event you had rated still shows its rating after an apply.
7. Adding a new row on a free date creates it under the right location.
8. On a trip with no itinerary, the walk is blank and behaves exactly as before.
9. Reads correctly on a phone viewport.
