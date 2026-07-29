# The "anything to avoid?" question

**Date:** 2026-07-29
**Status:** designed, not implemented

## Why

Every question the app asks about a trip is positive — the vibe, the categories,
the transport, the places. Nothing captures what the couple would rather *not*
do, so the assistant has no way to rule anything out. A single negative question
gives it that, and negatives are cheap to state and expensive to discover by
trial ("no long drives", "skip the big tourist spots").

## What is being built

One new field on the trip profile, `avoid`, surfaced in two places:

1. As the last question of the create/edit trip walkthrough, where it persists.
2. As a step in the guided itinerary planner, prefilled from the profile and
   written back when the walk finishes.

It is one stored value, not two. The planner box *is* the profile field.

## 1. Data

`trips.trip_profile` is jsonb, so there is no migration.

- `TripProfile` (`src/lib/trips/trip-profile-types.ts`) gains `avoid: string`.
- `EMPTY_TRIP_PROFILE.avoid = ""`.
- `parseTripProfile` reads it tolerantly:
  `avoid: typeof r.avoid === "string" ? r.avoid : ""`. Every existing trip
  therefore reads as empty, no backfill needed.
- Sanitized alongside `vibeNote` at the three write sites in
  `src/lib/trips/actions.ts` — `createTrip`, `updateTrip`, `saveTripProfile` —
  as `avoid: p.avoid.trim().slice(0, 500)`.

500 chars matches `vibeNote`; this is a sentence or two, not an essay.

## 2. Create / edit walkthrough

`src/app/trips/profile-walkthrough.tsx`:

- `PROFILE_STEP_COUNT` 4 -> 5.
- `ProfileWalkthroughValue` gains `avoid: string`.
- A fifth `StepShell`, structurally identical to the step-0 "describe this trip"
  textarea: title "Anything to avoid?", hint "Optional", `rows={3}`,
  `maxLength={500}`, bound to `value.avoid` via `onChange({ avoid })`.

Order:

```
1 Describe this trip in a few words
2 What's the vibe?
3 What's this trip made of?
4 How will you get around?
5 Anything to avoid?          <- new
  (create page only: "Ready to create" summary follows as extraStep)
```

Last, so it is the final real question before the closing screen — mirroring
where it sits in the planner.

Both callers wire it exactly as they already wire `vibeNote`:

- `src/app/trips/new/new-trip-form.tsx` — `useState("")`, a patch branch, and
  `avoid` in the `profile` payload.
- `src/app/trips/[slug]/edit/edit-trip-form.tsx` — same, seeded from
  `initialProfile.avoid`.

## 3. Itinerary planner

Every existing walk step is an add-list whose rows become itinerary events
through `collectEntries` -> `PlanEntry[]`. The avoid answer must never enter
that path, so steps become explicitly typed.

`src/lib/ai/itinerary-planner.ts`:

- `ItineraryPlanStep` gains `kind: "entries" | "text"`. All current steps are
  `"entries"`.
- `planItinerarySteps` inserts one step between Transportation and Other:

```ts
{
  key: "avoid:trip",
  kind: "text",
  category: "Avoid",
  title: "Anything to avoid?",
  question: "Anything to avoid this trip?",
  hint: "Optional - what you'd rather skip. Saved to the trip.",
  addNoun: "",
  place: null,
}
```

`src/app/trips/[slug]/plan-itinerary.tsx`:

- New prop `avoid: string` (the trip's saved value) and matching state, seeded
  from the prop; `reset()` restores the prop value.
- `renderStep` branches on `step.kind`. A `"text"` step renders the shared
  header (step counter, title, question, hint) and then a single textarea bound
  to the `avoid` state — no rows, no add button, no date pickers.
- `startWalk` seeds `items` only for `"entries"` steps, so `items["avoid:trip"]`
  never exists and `collectEntries` cannot pick it up.
- `generate()` and `apply()` both pass `avoid` to their server actions.

Threading the prop: `itinerary-tab.tsx` takes `avoid` and forwards it to
`<PlanItinerary>`, following the same path `destination` already takes from the
trip page.

## 4. Write-back and the prompt

**Write-back.** Both terminal actions in `src/lib/ai/itinerary-actions.ts` —
`applyPlanEntries` and `draftAndApplyItinerary` — accept `avoid?: string`. Each
already loads `trip`, so the write is local: when the trimmed value differs from
`trip.tripProfile.avoid`, update `trip_profile` to
`{ ...trip.tripProfile, avoid }` before doing the rest of the work. No extra
round trip and no new server action. Both paths write it back, so a mid-walk
realisation is kept whichever button ends the walk.

**Prompt.** Two touch points, one stored field:

- `buildProfileBlock` (`src/lib/ai/profile-context.ts`) gains one line, next to
  the other trip-profile lines:
  `Avoid, treat as a hard constraint: <avoid>.`
  Every surface that reads the profile block — chat, suggestion cards,
  discovery, the budget drafter — inherits it with no further change.
- The itinerary prompt wraps `profileBlock` in *"Who they are (a lens, not a
  checklist)"*, which softens precisely the wrong thing. So
  `ItineraryDraftContext` also gains `avoid: string`, rendered by
  `itineraryPrompt` as its own line:
  `Must avoid - do not include any of these: <avoid>.`
  `draftAndApplyItinerary` passes the post-write-back value.

## Deliberately not doing

- **No chips.** Avoid-tags were considered and dropped: real dislikes are
  specific ("nothing above 2000m", "no seafood") and a fixed list loses them.
  Free text only.
- **No separate table or column.** It lives in the existing jsonb profile.
- **No avoid step in the budget planner or the pre-trip checklist.** Those
  collect costs and to-dos, not taste. They still see the value through
  `buildProfileBlock`.

## Success criteria

### Verified by Claude

1. `pnpm build` and `pnpm lint` are clean.
2. `parseTripProfile({})` returns `avoid: ""`; `parseTripProfile({ avoid: 7 })`
   returns `avoid: ""`; `parseTripProfile({ avoid: "no long drives" })` returns
   it unchanged.
3. All three write sites in `actions.ts` include a trimmed, 500-capped `avoid`
   in the `trip_profile` object they persist.
4. `planItinerarySteps(["Lisbon"])` returns the avoid step immediately before
   the `other:trip` step, with `kind: "text"`.
5. `collectEntries` produces no `PlanEntry` with `category: "Avoid"` — the key
   is absent from `items` by construction.
6. `buildProfileBlock` omits the avoid line entirely when the field is empty.
7. `draftAndApplyItinerary` and `applyPlanEntries` update `trip_profile` only
   when the incoming trimmed value differs from the stored one.

### Verified by the user in-app

1. Create trip: the walkthrough reads "step 5 of 6" on the avoid question, and
   "step 6 of 6" on Ready to create; back/next move through both.
2. Text typed on that step survives create — reopening Edit trip shows it on
   step 5 of 5.
3. Edit trip: changing the avoid text and saving persists it across a reload.
4. Itinerary planner: the avoid step appears after Transportation and before
   Anything else, shows a plain textarea with no add-row or date controls, and
   is prefilled with whatever the trip profile holds.
5. Editing the text in the planner and pressing Generate, then reopening Edit
   trip, shows the updated text on step 5.
6. Same check with **apply** instead of Generate.
7. A generated itinerary visibly respects a concrete avoid ("no museums",
   "no long drives") — nothing matching it appears in the drafted days.
8. Both screens are usable at a phone viewport.
