# Itinerary collapsible empty-day ranges — Design

**Date:** 2026-06-09

## Problem

Inside an open location in `/itinerary`, every empty calendar date renders as its
own dashed "empty / +" button. A location with a long gap (or a wide date span and
few planned days) shows a tall stack of identical empty rows, which is noisy and
buries the planned days.

## Goal

Fold a run of **consecutive** empty days into a single collapsible range row that
reads like a date range (e.g. `08 Jun – 11 Jun · 4 empty days`). Collapsed by
default; clicking it expands to the individual per-date empty buttons, which behave
exactly as today (each opens the add-day form for its date).

## Scope

Purely the open-location render block in `src/app/trips/[slug]/itinerary-tab.tsx`
(currently lines ~668–725). No schema change, no server actions, no new helpers in
`itinerary-types.ts`. Just rendering plus one piece of client UI state.

## Behaviour

- **Run length 1** (a lone empty day): unchanged — the existing dashed "empty / +"
  button. Single empties are not given the range treatment.
- **Run length ≥ 2**: a dashed range header row showing
  `{first} – {last} · {n} empty days` via `formatShortDate` (European "08 Jun"
  order, matching the rest of the UI) with a chevron (`›` collapsed, `⌄` expanded).
  **Collapsed by default.** Clicking the row toggles it. When expanded, the
  individual per-date empty buttons render beneath it, slightly indented; each still
  sets `addDayDate`/`addDayFor` to open the add-day form for that date, exactly as
  today.

## Implementation notes

1. **Coalesce.** The block already builds a date-sorted `items` array interleaving
   `seg` and `empty` items. Because every occupied date is a `seg`, two empty items
   adjacent in that sorted array are necessarily calendar-consecutive. So a single
   left-to-right pass merges neighbouring `empty` items into
   `{ kind: "emptyRun"; dates: string[] }` (a lone empty becomes a run of length 1).

2. **State.** Add one `React.useState<Set<string>>` — `expandedRuns` — keyed by
   `${group.key}:${dates[0]}`. Absence from the set = collapsed (default); a toggle
   handler adds/removes the key. Independent of the existing location-level
   `collapsed` set, so folding an empty range never touches location collapse.
   Keying by location + first-date means the expand state naturally resets if days
   shift and the run's start date moves — acceptable.

3. **Styling.** Reuse the existing dashed `border-rule/70` / muted-mono treatment so
   the range row sits visually with the current empty slots, and reuse the location
   header's `›`/`⌄` chevron idiom for the toggle.

## Out of scope / non-goals

- No change to single empty days.
- No change to how filling an empty day works (still opens the add-day form).
- No DB, actions, or helper changes.
- No `docs/DECISIONS.md` row: this is a presentation refinement of an already
  shipped feature, not a new architectural decision.
