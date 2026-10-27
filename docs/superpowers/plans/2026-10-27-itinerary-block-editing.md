# Itinerary Block Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit a multi-day itinerary block once and have it land on every day, without overwriting what was typed on single days. Desktop can also select existing days by sweeping down the day numbers.

**Architecture:** Shared-ness is derived from content, with nothing new stored. A pure module (`itinerary-blocks.ts`) builds the block template and applies an edit to one day. One server action regroups the days if needed and writes each day. A dialog editor opens from the block header ("edit all") or from a desktop selection tray.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (no migration), dnd-kit, shadcn Dialog on `@base-ui/react`.

**Spec:** `docs/superpowers/specs/2026-10-27-itinerary-block-editing-design.md`

## Global Constraints

- No test runner exists; don't add one. Pure logic is checked by a throwaway Node script in the scratchpad (Node 24 runs `.ts` with type stripping). Everything else is checked with `pnpm lint` and `pnpm build`.
- Don't run `pnpm build` while `pnpm dev` is running (it clobbers `.next`). Ask the user to stop dev first if it's up.
- No schema change and no migration.
- Event identity covers the plan fields only: `time, endTime, text, url, details, category`. `rating` and `note` never affect matching, and they are kept on replace.
- An event is shared if it is on at least 2 days and on at least `ceil(n/2)` days.
- Block edits never rewrite days before the floor (`planFloor(today, start, end)`). The block name applies to all days.
- Dates are shown in `en-GB` order. No emojis. Sparse comments.
- `"use client"` files import types and helpers from `*-types.ts` or pure modules, never from `*-queries.ts`.
- Every `DndContext` needs an `id` (SSR id mismatch).

## Review Focus

1. **Blank or whitespace headline in the block editor:** save is disabled (same as the day form), and the server also returns "Title required."
2. **Selection crossing a location boundary:** dragging into another location's list does not extend the selection. It stays within the location where the sweep started.
3. **Mouse-down on the day number must not start a dnd-kit drag.** Dragging on the card body still reorders.
4. **A block with a past day on a live trip:** the past day is unchanged after save, and the future days are changed.
5. **Saving an untouched editor** writes no changes: every day comes out equal, so no update is sent.

---

### Task 1: Pure block logic

**Files:**
- Create: `src/lib/trips/itinerary-blocks.ts`
- Check script (not committed): `<scratchpad>/check-blocks.ts`

**Interfaces:**
- Produces:
  - `samePlan(a: ItineraryEvent, b: ItineraryEvent): boolean`: equal on `time, endTime, text, url, details, category`, treating a missing field and `""` as equal.
  - `blockTemplate(days: { title: string; events: ItineraryEvent[] }[]): { title: string; events: ItineraryEvent[] }`
  - `interface BlockEventEdit { old: ItineraryEvent | null; next: ItineraryEvent | null }`: edited when both are set, added when `old` is null, removed when `next` is null.
  - `interface BlockEdit { oldTitle: string; newTitle: string; events: BlockEventEdit[] }`
  - `applyBlockEdit(day: { title: string; events: ItineraryEvent[] }, edit: BlockEdit): { title: string; events: ItineraryEvent[] }`
  - `leftoverRuns(sortedDays: { id: string; groupId: string | null }[], groupId: string, removed: Set<string>): string[][]`: walks the trip's days in date order and collects ids that have `groupId` and are not in `removed`. A run breaks whenever any other day sits in between.
- The module imports only `import type { ItineraryEvent } from "./itinerary-types"`, so Node can run it directly.

- [ ] **Step 1: Write the check script** `<scratchpad>/check-blocks.ts`. It imports from the absolute `file:///` path of `itinerary-blocks.ts` and uses `node:assert/strict`. Surf fixture: `lesson = { time: "09:00", text: "Surf lesson" }`, `dinner = { time: "20:00", text: "Dinner" }`. Days d2..d6 all have title `"Surf"` and `[lesson]`, except: d3 has `[lesson, dinner]`; d4 has `[{ time: "11:00", text: "Surf lesson" }]`; d5's lesson carries `rating: 4, note: "great"`.

  ```ts
  // template
  const t = blockTemplate(days)
  assert.equal(t.title, "Surf")
  assert.deepEqual(t.events, [lesson])            // d2,d3,d5,d6 = 4 of 5 (d5 rated still matches)
  // 2-day block: one-day dinner is not shared
  assert.deepEqual(blockTemplate([{ title: "A", events: [lesson, dinner] }, { title: "A", events: [lesson] }]).events, [lesson])
  // edit 09:00 -> 10:00
  const ten = { time: "10:00", text: "Surf lesson" }
  const edit = { oldTitle: "Surf", newTitle: "Surf", events: [{ old: lesson, next: ten }] }
  assert.deepEqual(applyBlockEdit(days[0], edit).events, [ten])                 // d2
  assert.deepEqual(applyBlockEdit(days[1], edit).events, [ten, dinner])         // d3 keeps dinner
  assert.deepEqual(applyBlockEdit(days[2], edit).events, days[2].events)        // d4 keeps 11:00
  assert.deepEqual(applyBlockEdit(days[3], edit).events, [{ ...ten, rating: 4, note: "great" }]) // d5 keeps rating
  // added: appended, no duplicate
  const add = { oldTitle: "Surf", newTitle: "Surf", events: [{ old: null, next: dinner }] }
  assert.deepEqual(applyBlockEdit(days[1], add).events, [lesson, dinner])       // d3 already has it
  assert.deepEqual(applyBlockEdit(days[0], add).events, [lesson, dinner])
  // removed
  assert.deepEqual(applyBlockEdit(days[1], { oldTitle: "Surf", newTitle: "Surf", events: [{ old: lesson, next: null }] }).events, [dinner])
  // headline only where it still matches; empty day gets it
  assert.equal(applyBlockEdit({ title: "Rest", events: [] }, { oldTitle: "Surf", newTitle: "Surfing", events: [] }).title, "Rest")
  assert.equal(applyBlockEdit({ title: "", events: [] }, { oldTitle: "", newTitle: "Surf", events: [] }).title, "Surf")
  // untouched edit is identity
  assert.deepEqual(applyBlockEdit(days[1], { oldTitle: "Surf", newTitle: "Surf", events: [{ old: lesson, next: lesson }] }), days[1])
  // leftoverRuns: 6-day group g, middle 2 removed -> two runs; a 1-day leftover is its own run
  const trip = ["a","b","c","d","e","f"].map((id) => ({ id, groupId: "g" }))
  assert.deepEqual(leftoverRuns(trip, "g", new Set(["c","d"])), [["a","b"],["e","f"]])
  assert.deepEqual(leftoverRuns(trip, "g", new Set(["b","c","d","e","f"])), [["a"]])
  console.log("ok")
  ```

- [ ] **Step 2: Run it to see it fail.** Run `node "<scratchpad>/check-blocks.ts"`. Expected: an error that the module is not found.

- [ ] **Step 3: Implement the module.** Approach for each function:
  - `blockTemplate`: count each event by `samePlan` across days, at most once per day. Keep it if `count >= 2 && count >= ceil(n/2)`. Order by first appearance, walking the days in order. The template event is the first matching copy with `rating` and `note` stripped. Title is the most common `title`, with ties going to the earliest.
  - `applyBlockEdit`, for each edit in order:
    - edited: find the index of the first event with `samePlan(e, old)` and replace it with `{ ...next, rating, note }` taken from the replaced event (only when present). If none is found, skip it.
    - added: append `next` unless some event already matches `samePlan`.
    - removed: drop the first event that matches `samePlan`.
    - Title: `day.title === oldTitle ? newTitle : day.title`.

    Return a new object and never mutate the input.

- [ ] **Step 4: Run the check script.** Expected output: `ok`.

- [ ] **Step 5: Lint and commit.** Run `pnpm lint` (expect it clean), then:
  ```bash
  git add src/lib/trips/itinerary-blocks.ts
  git commit -m "feat(itinerary): pure block template and apply-edit logic"
  ```

### Task 2: Server action `editItineraryBlock`

**Files:**
- Modify: `src/lib/trips/actions.ts`. Add the action right after `deleteItineraryGroup` (~line 2003).

**Interfaces:**
- Consumes: `applyBlockEdit`, `leftoverRuns`, `BlockEventEdit` from Task 1; the existing `normalizeDayEvents` and `createClient`.
- Produces:
  ```ts
  export interface EditItineraryBlockInput {
    tripId: string
    tripSlug: string
    dayIds: string[]
    /** The existing block being edited; null = make dayIds a new block first. */
    groupId: string | null
    groupName: string
    oldTitle: string
    newTitle: string
    events: BlockEventEdit[]
    /** Days before this date are not rewritten; null = no floor. */
    floor: string | null
  }
  export async function editItineraryBlock(input: EditItineraryBlockInput): Promise<{ error?: string }>
  ```

- [ ] **Step 1: Implement.** Steps inside the action:
  1. If `newTitle.trim()` is empty, return `{ error: "Title required." }`. If `dayIds.length < 2`, return `{ error: "Pick at least two days." }`.
  2. Load the rows: `select("id, day_date, title, events, group_id").in("id", dayIds)`.
  3. Name is `groupName.trim() || null`. If `groupId` is null, set a new `crypto.randomUUID()` with that name on every row in `dayIds`. Then, for each distinct old `group_id` among the loaded rows, load the trip's days (`id, day_date, group_id`, ordered by `day_date`) and run `leftoverRuns(…, oldId, new Set(dayIds))`. The first run keeps `oldId`. Every later run gets a new uuid and keeps the old `group_name` (so select `group_name` too). A run of length 1 gets `group_id` and `group_name` set to null. If `groupId` is given, just set `group_name` on all `dayIds`.
  4. For each row with `!floor || day_date >= floor`: take `next = applyBlockEdit({ title, events: parseEvents(events) }, { oldTitle, newTitle: newTitle.trim(), events })` and normalize its events with `normalizeDayEvents`. Run `update({ title, events })` only when it differs from the row (compare with `JSON.stringify`). Updates run with `Promise.all`. On the first error, return `{ error: message }`.
  5. Call `revalidatePath(`/trips/${tripSlug}`)` and return `{}`.

  The action writes only `title, events, group_id, group_name`.

- [ ] **Step 2: Verify.** Run `pnpm lint`; expect it clean. Then trace by hand: run the surf example through steps 3 and 4 and check the writes match the Task 1 expectations. Day d4 should get no update, because its result equals the row.

- [ ] **Step 3: Commit.**
  ```bash
  git add src/lib/trips/actions.ts
  git commit -m "feat(itinerary): editItineraryBlock server action"
  ```

### Task 3: Move the event-draft pieces out of the itinerary tab

This is a pure move with no behavior change, so the block editor can reuse the event rows.

**Files:**
- Create: `src/app/trips/[slug]/event-draft-rows.tsx` (`"use client"`)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`. Delete the moved code and import it instead.

**Interfaces:**
- Produces (all exported): `EventDraft`, `newEventDraft`, `normalizeTime`, `sortEvents`, `toEventDrafts`, `EventRow`, `SortableEventRow`, plus a new `EventDraftList`. Also new:
  - `draftToEvent(d: EventDraft): ItineraryEvent`. This is exactly the mapping currently inlined in `DayEditor.save` and in `AddDayRow`; both now call it.
  - `EventDraftList({ events, setEvents, isPending }: { events: EventDraft[]; setEvents: (e: EventDraft[]) => void; isPending: boolean })`. This is the `DndContext` + `SortableContext` + `SortableEventRow` block that `DayForm` renders under "Events" (lines ~1994-2047), including `onEventDragEnd`, `eventSensors` and `useId`. `DayForm` now renders `<EventDraftList …/>` in its place.

- [ ] **Step 1: Move the code.** Keep every function body unchanged.
- [ ] **Step 2: Verify.** Run `pnpm lint` and `pnpm build` (with dev stopped). Expect both clean.
- [ ] **Step 3: Commit.**
  ```bash
  git add "src/app/trips/[slug]/event-draft-rows.tsx" "src/app/trips/[slug]/itinerary-tab.tsx"
  git commit -m "refactor(itinerary): move event draft rows to their own file"
  ```

### Task 4: Block editor dialog and "edit all" on the block header

This finishes the phone path.

**Files:**
- Create: `src/app/trips/[slug]/block-editor.tsx` (`"use client"`)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`. The tab owns the `blockEdit` state; `DaySegmentView` gets the header button.

**Interfaces:**
- Consumes: `blockTemplate`, `BlockEventEdit` (Task 1); `editItineraryBlock` (Task 2); `EventDraft`, `toEventDrafts`, `draftToEvent`, `newEventDraft`, `EventDraftList` (Task 3); `planFloor` from `itinerary-types`.
- Produces:
  ```ts
  export function BlockEditor(props: {
    tripId: string
    tripSlug: string
    days: ItineraryDay[]          // the days being edited, date order
    groupId: string | null        // null = new block from a selection
    floor: string | null
    onClose: () => void
  }): React.ReactElement
  ```
  - In `ItineraryTab`: `const [blockEdit, setBlockEdit] = React.useState<{ dayIds: string[]; groupId: string | null } | null>(null)`. Render `<BlockEditor>` when it is set, with `days` filtered from `days` by id and `floor = planFloor(today, tripStartDate, tripEndDate)`.
  - `DaySegmentView` gets a new prop `onEditBlock: (dayIds: string[], groupId: string) => void`.

- [ ] **Step 1: Build `BlockEditor`.**
  - It renders inside `Dialog open onOpenChange={(o) => !o && onClose()}` with a `DialogTitle` of `Editing {n} days`, plus the block name if there is one.
  - Initial state comes from `blockTemplate(days)`:
    - `title`;
    - `drafts = toEventDrafts(template.events)`;
    - `origin: Map<draftKey, ItineraryEvent>`, built once from the initial drafts;
    - `name`, initialized to `days[0].groupName ?? ""`.
  - Fields: Block name (with placeholder "Optional, e.g. Surf school"), Headline, and Events via `<EventDraftList>` with a "+ add event" button. There are no date, summary, tone or location fields.
  - On save, build `BlockEventEdit[]`:
    - each initial key still present gives `{ old: origin, next: draftToEvent(d) }`;
    - each initial key that is gone gives `{ old: origin, next: null }`;
    - each key with no origin gives `{ old: null, next: draftToEvent(d) }`.

    Then call `editItineraryBlock` with `oldTitle = template.title`. Show any `result.error` in the form; close on success.
  - Save is disabled while the action is pending or `title.trim()` is empty.
  - When `floor` is set and some days fall before it, show one line: `{k} past days stay as they are`.
- [ ] **Step 2: Add the header button.** In `DaySegmentView`'s block header, put an `edit all` button before the `x` (same mono 11px style, `text-sea`). It calls `onEditBlock(seg.days.map((d) => d.id), seg.groupId)`. Wire it in `renderRow` to `setBlockEdit({ dayIds, groupId })`.
- [ ] **Step 3: Verify.** Run `pnpm lint` and `pnpm build`; expect both clean. Then trace: header click → `blockEdit` set → editor opens with the template → save → action → `revalidatePath`. Realtime UPDATEs also refresh the other partner's view.
- [ ] **Step 4: Commit.**
  ```bash
  git add "src/app/trips/[slug]/block-editor.tsx" "src/app/trips/[slug]/itinerary-tab.tsx"
  git commit -m "feat(itinerary): edit a block's days together"
  ```

### Task 5: Desktop selection (sweep, shift-click, tray)

**Files:**
- Create: `src/app/trips/[slug]/day-selection.tsx` (`"use client"`)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`. Thread the selection props through `DaySegmentView` → `DayCard` → `DayView`.

**Interfaces:**
- Produces:
  ```ts
  export interface DaySelection {
    selected: Set<string>
    /** Mouse-down on a day number. orderedIds = that location's days in date order. */
    begin: (scopeKey: string, orderedIds: string[], dayId: string, shift: boolean) => void
    clear: () => void
  }
  export function useDaySelection(): DaySelection
  export function SelectionTray(props: { count: number; onEdit: () => void; onClear: () => void }): React.ReactElement
  ```
- Approach:
  - `begin`:
    - With `shift` and an existing anchor in the same scope, select the range from the anchor to `dayId`.
    - Otherwise, set the anchor to `dayId`, select just that day, and start sweeping.
    - While sweeping, a `window` `mousemove` takes `document.elementFromPoint(x, y)?.closest("[data-day-id]")`. If that id is in `orderedIds`, the selection becomes the range from the anchor to that id; ids from another scope are ignored.
    - `mouseup` stops the sweep.
  - `keydown` Escape clears.
  - A `mousedown` outside `[data-day-number]` and `[data-selection-tray]` clears.
  - Listeners are attached in a `useEffect` and removed on cleanup.
- Wiring in `itinerary-tab.tsx`:
  - `DayView`'s root div gets `data-day-id={day.id}`.
  - The left date column (the `w-9` div) gets `data-day-number`, `cursor-pointer select-none` and `onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onSelectStart(e.shiftKey) }}`. `stopPropagation` keeps dnd-kit's `MouseSensor` from starting a drag. Touch is untouched, so the phone behaves as before.
  - New `DayView`/`DayCard` props: `selected: boolean` and `onSelectStart: (shift: boolean) => void`.
  - When `selected`, the card div swaps to `border-sea bg-sea/10`.
  - `renderRow` passes `scopeKey = group.key` and `orderedIds = group.days` sorted by date. In the locationless branch, use `"loose"` and `days`.
  - When `selected.size >= 2`, render `<SelectionTray>` fixed at the bottom, centred, with max width matching the column.
  - Edit together calls `setBlockEdit({ dayIds, groupId })`, where `groupId` is the shared group id when every selected day has the same non-null `groupId` and that group has exactly that many days in `days`, and `null` otherwise. Then it clears the selection.
  - Tray copy is `{count} days selected`, plus buttons `Edit together` and `x`.

- [ ] **Step 1: Build `useDaySelection` and `SelectionTray`.**
- [ ] **Step 2: Wire them into the tab** as described above.
- [ ] **Step 3: Verify.** Run `pnpm lint` and `pnpm build`; expect both clean. Then trace:
  - mouse-down on a number → `begin` → move over another card in the same location → range selected;
  - moving into another location does nothing;
  - mouse-down on the card body still reaches dnd-kit.
- [ ] **Step 4: Commit.**
  ```bash
  git add "src/app/trips/[slug]/day-selection.tsx" "src/app/trips/[slug]/itinerary-tab.tsx"
  git commit -m "feat(itinerary): sweep-select days on desktop and edit them together"
  ```

### Task 6: Docs

**Files:**
- Modify: `docs/TODO.md`. Add the item as *implemented; unverified in app*, with the user checklist (spec items 1-8, 6b, 6c).
- Modify: `docs/DECISIONS.md`. Add one row: shared-ness is derived from content (plan fields only, ≥2 days and ≥ half), there is no stored flag or migration, and the reason is that the day editor and all write paths stay unchanged.

- [ ] **Step 1: Edit both files.**
- [ ] **Step 2: Commit.**
  ```bash
  git add docs/TODO.md docs/DECISIONS.md docs/superpowers
  git commit -m "docs: itinerary block editing spec, plan, decision"
  ```
