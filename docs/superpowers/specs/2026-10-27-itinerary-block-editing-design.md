# Itinerary block editing: select days, edit them together

Date: 2026-10-27. Status: approved in brainstorming; builder check done.

## Why

A 5-day surf school is five itinerary days with the same plan. Today you can
create those days together (add form with start date, end date and block name),
but afterwards the only thing you can do to the whole block is delete it. The
user wants to edit the block once and have it land on every day, and still
edit single days by hand (dinner on day 3, a later lesson on day 4) without a
later block edit undoing that.

## What exists (build on it)

- `itinerary_days.group_id` / `group_name`: days added as one span share a
  group id and name. `toSegments` (`src/app/trips/[slug]/itinerary-tab.tsx`)
  renders consecutive same-group days inside a bordered box with the name and
  a delete-all `x` (`deleteItineraryGroup`).
- Each day is an independent row with its own `title`, `sub`, `events` jsonb.
  `DayEditor` edits one day; `updateItineraryDay` saves it.
- Drag-to-reorder: dnd-kit, `MouseSensor` distance 8, `TouchSensor` delay
  200ms. The whole card is the drag handle, so mouse-drag and long-press on a
  card are taken.

## Goals

1. **Edit together.** One editor for a block: block name, headline (`title`)
   and the shared events. Saving applies to every day of the block.
2. **Hand edits win.** A day's own changes survive a block edit:
   - an event added on one day stays (day 3's dinner);
   - a shared event changed on one day keeps its changed version (day 4's
     11:00) and is no longer touched by block edits;
   - a shared event deleted on one day is not re-added.
3. **Desktop: select existing days.** Press on a day number and drag down
   (sweep) to select a run of days; shift-click does the same from the last
   clicked day. A tray shows "N days selected - Edit together - Esc".
4. **Phone: no selection.** Blocks are made at add time (existing form). The
   block header gets a new **edit all** next to the `x`, opening the same
   editor. Also shown on desktop.

## Non-goals

- Selecting days on touch devices.
- Non-consecutive blocks (Mon/Wed/Fri). Sweep and shift-click are ranges.
- Dream (dateless) itineraries. Dated itinerary only.
- Moving/rescheduling a block as a unit; reorder stays per day.
- Showing "block" vs "this day" anywhere in the normal day view.

## Anti-goals

- A block edit that silently wipes something typed on a single day.
- A new table, or a schema change, if content matching does the job (it does,
  see below).
- Breaking drag-to-reorder or making the list feel different when you are not
  selecting.

## How "shared" is decided (builder: this is the core)

No flags or keys are stored. Shared-ness is derived from content, so the day
editor and all existing write paths stay unchanged.

- **Event identity** = the plan fields only: time, endTime, text, url,
  details, category. `rating` and `note` are on-the-road feedback written per
  day by `rateEvent`; they never affect matching. (My call.)
- **Block template** (pure function, `itinerary-types.ts`): an event is shared
  if an identical event appears on at least 2 days and at least half the
  block's days (rounded up). So a 2-day block needs both days, and a dinner
  on one day of two is never shared. Template order = order on the first day
  that has it. The template headline is the most common `title` across the
  days (ties: first day's). (My call.)
- **Saving** sends the old template (what the editor loaded) and the new one.
  Old and new events are paired by their position in the editor's list
  (an edited row remembers its original; a new row has none; a removed row is
  sent as removed). Then, per day:
  - edited (old -> new): replace the event equal to `old` with `new`, keeping
    that day's own `rating` and `note`; if the day has no event equal to
    `old`, it was hand-edited or deleted there: leave the day alone;
  - added (no old): append `new` to every day that doesn't already have an
    identical event;
  - removed: delete the event equal to `old` where present;
  - headline: set `title = newTitle` only where `title === oldTitle`;
  - block name: set `group_name` on all days.
- This is one pure function `applyBlockEdit(day, edit) -> day` (testable by
  reasoning; no test runner exists), called by one server action.

**On the road** (today within the trip): days before today are never
rewritten by a block edit (they show in the editor's day count but are
skipped on save; same floor idea as `planFloor`). Block name still applies to
all days. (My call.)

Known, accepted edges: a day-only event that happens to be typed identically
on half the days becomes shared; a shared event hand-edited on more than half
the days drops out of the template.

## Selection to block

"Edit together" on a selection:
- If the selected days are exactly one existing block, edit that block.
- Otherwise the editor also asks for a block name, and saving first puts all
  selected days under one new `group_id` with that name, then applies the
  edit. Any older block the selection took days from is re-split: each
  leftover run of consecutive days gets its own new `group_id` and keeps the
  old name; a run of one day becomes ungrouped (`group_id`/`group_name`
  null). Without this, two boxes would share one id and either box's `x`
  would delete both. (My call.)

Selection stays within one location's day list. Empty (materialized, untitled)
days can be selected, so "select 5 empty days, edit together, type Surf" fills
them; their old headline is `""`, so the headline rule writes it.

## Server

One new action in `src/lib/trips/actions.ts`:
`editItineraryBlock({ tripSlug, dayIds, groupId | null, groupName, oldTitle,
newTitle, eventEdits })`. It loads the days, regroups them if `groupId` is
null, runs `applyBlockEdit` per day, writes each changed row (at most 31),
and calls `revalidatePath`. No migration. RLS unchanged (same table and
columns as `updateItineraryDay`).

## UI placement

- `itinerary-tab.tsx` is ~2100 lines: put the block editor and the selection
  tray in new files next to it (e.g. `block-editor.tsx`,
  `day-selection.tsx`). Edit the tab only to wire them in.
- Sweep starts on the day-number column of a day card. It must not activate
  the dnd-kit drag (stop propagation on that column's pointerdown, or exclude
  it from the drag listeners). Selected cards get the sea-tinted look from the
  mockup. Esc or clicking outside clears the selection.
- The block editor reuses the existing event-row editing pieces where it can
  (`EventRow`, drafts helpers) rather than a second event editor.
- Mockups: `.superpowers/brainstorm/*/content/proposal.html`.

## Left to the builder

File split, exact component names, and the visual details of the tray and
selected state (follow `docs/DESIGN.md`).

## Success criteria

Verified by Claude:
- `pnpm build` and `pnpm lint` clean.
- `applyBlockEdit`, traced by hand on the surf example: days 2-6 with
  "09:00 Surf lesson", day 3 plus "20:00 Dinner", day 4 changed to 11:00;
  editing 09:00 -> 10:00 yields 10:00 on days 2, 3, 5, 6, dinner kept on
  day 3, day 4 still 11:00.
- Template function on the same data returns headline "Surf" and the single
  event "09:00 Surf lesson" (4 of 5 days).
- `editItineraryBlock` writes only `title`, `events`, `group_id`, `group_name`.

Verified by the user in-app:
1. Desktop: drag down the day numbers of 5 days; they highlight and the tray
   shows "5 days selected".
2. Shift-click selects a range; Esc clears it.
3. Dragging a day card (not the number) still reorders days.
4. Edit together on 5 ungrouped days with name "Surf school" creates a box
   named Surf school around them.
5. Block edit changes the time on all days; a dinner added on day 3 by hand
   is still there afterwards.
6. A lesson time changed by hand on day 4 is not overwritten by a later
   block edit.
6b. Rating the lesson on one day doesn't stop the next block edit from
   changing that day's lesson, and the rating is still there.
6c. Selecting the middle 2 days of a 6-day block leaves two separate boxes;
   deleting one box doesn't delete the other.
7. Phone: the block header shows "edit all", it opens the editor, saving
   works; long-press drag still works.
8. Editing a single day still works as before.
