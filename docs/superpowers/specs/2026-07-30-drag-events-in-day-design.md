# Drag to reorder events inside a day

**Date:** 2026-07-30
**Status:** design, approved

## Problem

Days can be dragged in the itinerary; events inside a day cannot. The only way to
change the sequence of a day's events today is to retype their text across rows.
That is worst exactly where it matters most: a handful of **untimed** events —
"breakfast somewhere", "the market", "swim" — where the order *is* the plan and
there is no clock time to express it.

## Why untimed is the whole story

Events are a jsonb array on the day row (`itinerary-types.ts:41`), so order is
array order and reordering costs nothing at the data layer. But almost every
surface that displays events re-sorts them by time:

| Surface | Behavior |
| --- | --- |
| `daySummary` — `itinerary-tab.tsx:162` | sorts by time |
| planning day view — `itinerary-tab.tsx:1388` | sorts by time |
| the day editor itself, on time-blur — `itinerary-tab.tsx:1897` | sorts by time |
| `TodayUpcoming` — `today-upcoming.tsx:47` | sorts by time |
| `today-past.tsx:48` | sorts by time |
| public share — `t/[token]/page.tsx:94` | raw array order |

Untimed events keep array order and fall to the end of every one of those. So a
manual reorder of untimed events is displayed faithfully **with no change to any
read surface** — which is what makes this cheap. Reordering *timed* events against
their clock time would mean pulling the sort out of five surfaces; that is not in
this slice.

## Design

### 1. Scope

`DayForm` (`itinerary-tab.tsx:1710`) only. It backs both the edit-day form
(`DayEditor`, `:1505`) and the add-day creator, so one change covers both. Dreams
have no events — `DreamDayForm` is a separate component and is untouched.

### 2. `SortableEventRow`

A new component wrapping the existing per-event JSX block (`:1882-1986`)
unchanged. `useSortable({ id: ev.key })` — `EventDraft.key` is already a stable
`crypto.randomUUID()` (`:125`), so no new identity is needed.

The handle is a `⠿` button at the head of the row's first flex line, copied from
the pattern already used for dream days (`dream-itinerary-tab.tsx:251-261`) and
packing items (`packing-tab.tsx:682`): `type="button"`, `touch-none`,
`cursor-grab` / `active:cursor-grabbing`, `aria-label="Drag to reorder event"`.

**`attributes` and `listeners` go on the handle only, never on the row.** The day
cards spread listeners across the whole card (`:1261`), but an event row is three
text inputs and a textarea — whole-row listeners with `MouseSensor`'s `distance: 8`
would hijack text selection and drag the row while the user selects a word.

### 3. Wiring in `DayForm`

Wrap the events list in `DndContext` + `SortableContext`, mirroring the day list
(`:1016-1028`):

- sensors: the same config as `dragSensors` (`:489-492`) — `MouseSensor` with
  `activationConstraint: { distance: 8 }`, `TouchSensor` with `{ delay: 200,
  tolerance: 8 }` — so an event drag feels identical to a day drag.
- `collisionDetection={closestCenter}`, `strategy={verticalListSortingStrategy}`.
- `id={React.useId()}`. Not a literal: an open `DayEditor` and the add-day form can
  be on screen at once, and two `DndContext`s sharing an id diverge server vs
  client (see `DECISIONS.md` on the dnd-kit SSR id mismatch).
- `items={events.map((e) => e.key)}`.
- `onDragEnd`: locate the active and over keys in `events`, `arrayMove`, and
  `setEvents`. A drop on itself or outside is a no-op. New import: `arrayMove`
  from `@dnd-kit/sortable`.

Nesting is safe: `SortableDayCard`'s own `useSortable` is `disabled` while
`isEditing` (`:1253`), so the day underneath cannot be dragged by a gesture meant
for an event, and the add-day form sits outside any sortable.

### 4. Write path: nothing downstream changes

Both save paths already map `events` in array order into the jsonb
(`:1541` edit, `:1642` add). Reordering the draft array is therefore the entire
persistence story — no server action, no type, and no migration changes.

`sortEvents` (`:140`) still runs on time-blur, and that is fine: it is
`Array.prototype.sort`, which is stable and returns `0` for two untimed events, so
typing a time into one event will not scramble the order the others were dragged
into.

### 5. Two deliberate behaviors

1. **The reorder saves with the form, not on drop.** Day dragging persists
   optimistically and immediately; this is draft state until *save* is pressed,
   consistent with every other field in the form. Cancel discards it.
2. **Mixed timed/untimed days.** Display surfaces put timed events first in clock
   order and untimed after, so dragging an untimed event above a *timed* one will
   not move it above in the day view. Untimed-vs-untimed order holds everywhere.
   Accepted, per the section above.

## Success criteria

### Verified by Claude

1. `pnpm lint` and `pnpm exec tsc --noEmit` pass; `pnpm build` passes with the dev server stopped.
2. `attributes`/`listeners` from `useSortable` appear only on the handle button, not on the row wrapper — verified by reading the diff.
3. `DndContext` in `DayForm` has an `id` from `React.useId()`.
4. `onDragEnd` reorders by `EventDraft.key` and is a no-op when `over` is null or equal to `active`.
5. The draft-to-event maps at `:1541` and `:1642` are unchanged, so `rating`, `note`, `category`, `url` and `details` still round-trip after a reorder.
6. No migration file, no server-action change, and no source file touched other than `itinerary-tab.tsx` (docs aside).

### Verified by the user in-app

1. Editing a day with 3+ untimed events: each row shows a `⠿` handle; dragging one reorders the rows.
2. Selecting text and placing the cursor inside the time, text, link and details fields still works — no drag starts.
3. Saving persists the new order: reopening the day shows it, and the collapsed day view and expanded day list it in that order.
4. Cancelling discards the reorder.
5. The same drag works in the add-a-day form before the day is saved.
6. Typing a time into one event does not scramble the order of the remaining untimed events.
7. Works by touch at a phone viewport (press-and-hold ~200ms on the handle, then drag), light and dark.
8. Dragging an event does not drag the day card underneath it.
