# Drag events inside a day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder a day's events by dragging a `⠿` grip in the day editor, matching the feel of dragging days.

**Architecture:** Two steps in one file. First extract the ~100-line inline event-row JSX out of `DayForm` into an `EventRow` component with a callback interface (pure refactor, no behavior change). Then add a `SortableEventRow` wrapper that owns `useSortable` and renders the grip, plus a `DndContext`/`SortableContext` around the list in `DayForm` whose `onDragEnd` is `arrayMove` over the draft array. Persistence is free: both save paths already write `events` in array order into jsonb.

**Tech Stack:** Next.js 16 App Router, React 19, `@dnd-kit/core` + `@dnd-kit/sortable` (already dependencies, already imported in the target file), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-30-drag-events-in-day-design.md`

## Global Constraints

- Only one source file changes: `src/app/trips/[slug]/itinerary-tab.tsx`. No migration, no server-action change, no new dependency.
- **`attributes` and `listeners` from `useSortable` go on the grip button only, never on the row wrapper.** The row contains three text inputs and a textarea; whole-row listeners with `distance: 8` would hijack text selection.
- Sensor config must match the day list verbatim (`itinerary-tab.tsx:489-492`): `MouseSensor` with `{ distance: 8 }`, `TouchSensor` with `{ delay: 200, tolerance: 8 }`.
- Every `DndContext` gets a stable `id` — here `React.useId()` (`DECISIONS.md`, 2026-06-03: dnd-kit's module-scoped `useUniqueId` counter otherwise diverges server vs client in a long-lived dev server).
- The grip button is `type="button"` — the events list lives inside a `<form>`, and a bare `<button>` would submit it.
- No behavior change to the draft-to-event save maps (`:1541`, `:1642`); `rating`, `note`, `category`, `url`, `details` must keep round-tripping.
- No test infrastructure exists in this repo. Verification is `pnpm lint` + `pnpm exec tsc --noEmit` + reading the diff. Do **not** invent a test command. Do **not** run `pnpm build` while a dev server is running (it clobbers the shared `.next` dir).
- No emojis in code. The `⠿` grip is a braille glyph already used at `dream-itinerary-tab.tsx:259` and `packing-tab.tsx:682`, not an emoji.

---

### Task 1: Extract `EventRow` from `DayForm`

Pure refactor. Same DOM, same behavior; the six repeated `events.map((x) => x.key === ev.key ? ... : x)` closures collapse into four named callbacks.

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` — add `EventRow` before `function DayForm` (~line 1710); replace the events list body at `:1881-1987`.

**Interfaces:**
- Consumes: `EventDraft` (`:108`), `normalizeTime` (`:130`), `sortEvents` (`:140`).
- Produces: `function EventRow(props: { ev: EventDraft; isPending: boolean; handle?: React.ReactNode; onPatch: (patch: Partial<EventDraft>) => void; onNormalizeTime: () => void; onNormalizeEndTime: () => void; onRemove: () => void })`. Task 2 wraps this component and supplies `handle`.

- [ ] **Step 1: Add the `EventRow` component**

Insert immediately before `function DayForm({` (~line 1710). The JSX is the current row markup verbatim — every `className` string is copied unchanged — with each inline `setEvents(...)` swapped for a callback:

```tsx
function EventRow({
  ev,
  isPending,
  handle,
  onPatch,
  onNormalizeTime,
  onNormalizeEndTime,
  onRemove,
}: {
  ev: EventDraft
  isPending: boolean
  /** Drag grip, supplied by SortableEventRow. */
  handle?: React.ReactNode
  onPatch: (patch: Partial<EventDraft>) => void
  onNormalizeTime: () => void
  onNormalizeEndTime: () => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {handle}
        <input
          type="text"
          value={ev.time}
          onChange={(e) => onPatch({ time: e.target.value })}
          onBlur={onNormalizeTime}
          placeholder="09:00"
          disabled={isPending}
          className="t-num w-16 shrink-0 border-0 border-b border-rule bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <input
          type="text"
          value={ev.endTime}
          onChange={(e) => onPatch({ endTime: e.target.value })}
          onBlur={onNormalizeEndTime}
          placeholder="end"
          disabled={isPending}
          className="t-num w-16 shrink-0 border-0 border-b border-rule bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <input
          type="text"
          value={ev.text}
          onChange={(e) => onPatch({ text: e.target.value })}
          placeholder="What happens"
          disabled={isPending}
          className="min-w-0 flex-1 border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={isPending}
          aria-label="Remove event"
          className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay disabled:opacity-50"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        value={ev.url}
        onChange={(e) => onPatch({ url: e.target.value })}
        placeholder="link (optional)"
        disabled={isPending}
        className="w-full border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      />
      <textarea
        value={ev.details}
        onChange={(e) => onPatch({ details: e.target.value })}
        placeholder="details (optional) — address, booking name, what to bring"
        rows={2}
        disabled={isPending}
        className="w-full resize-y border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      />
    </div>
  )
}
```

- [ ] **Step 2: Replace the inline list in `DayForm` with `EventRow`**

Replace the whole `{events.map((ev) => ( ... ))}` block (`:1882-1986`, from `{events.map((ev) => (` through its closing `))}`) with:

```tsx
          {events.map((ev) => (
            <EventRow
              key={ev.key}
              ev={ev}
              isPending={isPending}
              onPatch={(patch) =>
                setEvents(
                  events.map((x) => (x.key === ev.key ? { ...x, ...patch } : x)),
                )
              }
              onNormalizeTime={() =>
                setEvents(
                  sortEvents(
                    events.map((x) =>
                      x.key === ev.key ? { ...x, time: normalizeTime(x.time) } : x,
                    ),
                  ),
                )
              }
              onNormalizeEndTime={() =>
                setEvents(
                  events.map((x) =>
                    x.key === ev.key
                      ? { ...x, endTime: normalizeTime(x.endTime) }
                      : x,
                  ),
                )
              }
              onRemove={() => setEvents(events.filter((x) => x.key !== ev.key))}
            />
          ))}
```

The surrounding `<div className="mt-3">`, the `Events` label, and `<div className="mt-1.5 space-y-2">` stay exactly as they are.

- [ ] **Step 3: Verify lint and types**

Run: `pnpm lint` — Expected: no errors.
Run: `pnpm exec tsc --noEmit` — Expected: no output (clean).

- [ ] **Step 4: Confirm the refactor is behavior-neutral**

Read the diff and confirm: the four callbacks reproduce the original `setEvents` bodies (note `onNormalizeTime` sorts, `onNormalizeEndTime` does not — that asymmetry is in the original at `:1895-1905` vs `:1920-1928`), no `className` string changed, and no field lost its input.

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "refactor(itinerary): extract EventRow from the day form"
```

---

### Task 2: Make the event rows sortable

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` — `@dnd-kit/sortable` import (`:14-18`); add `SortableEventRow` after `EventRow`; add hooks + handler to `DayForm`; wrap the list.

**Interfaces:**
- Consumes: `EventRow` from Task 1; `EventDraft.key` (`:109`) as the sortable id — already a stable `crypto.randomUUID()` from `newEventDraft` (`:125`).
- Produces: nothing further depends on this.

- [ ] **Step 1: Import `arrayMove`**

Change the `@dnd-kit/sortable` import block (`:14-18`) to:

```tsx
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
```

- [ ] **Step 2: Add `SortableEventRow`**

Insert immediately after `EventRow`, before `function DayForm`. The grip markup is copied from `dream-itinerary-tab.tsx:251-261` with `shrink-0` added, since it sits in a flex row of fixed-width inputs:

```tsx
function SortableEventRow(props: React.ComponentProps<typeof EventRow>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.ev.key })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }
  // Listeners belong to the grip alone: the row is full of text inputs, and an
  // 8px drag threshold on the row would hijack selecting a word.
  const handle = (
    <button
      type="button"
      aria-label="Drag to reorder event"
      className="shrink-0 cursor-grab touch-none border-0 bg-transparent px-0.5 font-mono text-[12px] leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  )
  return (
    <div ref={setNodeRef} style={style}>
      <EventRow {...props} handle={handle} />
    </div>
  )
}
```

- [ ] **Step 3: Add the drag hooks and handler to `DayForm`**

`DayForm` currently has no hooks — it opens straight into `return (`. Insert these directly after the destructured props' closing `}) {` (~line 1765), before `return (`:

```tsx
  const eventDndId = React.useId()
  const eventSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  // Draft-only reorder: it reaches the DB when the form is saved, because both
  // save paths write `events` in array order into the jsonb column.
  function onEventDragEnd(e: DragEndEvent) {
    const over = e.over
    if (!over || e.active.id === over.id) return
    const activeId = String(e.active.id)
    const overId = String(over.id)
    setEvents(
      arrayMove(
        events,
        events.findIndex((x) => x.key === activeId),
        events.findIndex((x) => x.key === overId),
      ),
    )
  }
```

- [ ] **Step 4: Wrap the list in `DndContext` + `SortableContext`**

Inside `<div className="mt-1.5 space-y-2">`, wrap the `events.map(...)` from Task 1 and rename the element to `SortableEventRow` (all other props unchanged):

```tsx
        <div className="mt-1.5 space-y-2">
          <DndContext
            id={eventDndId}
            sensors={eventSensors}
            collisionDetection={closestCenter}
            onDragEnd={onEventDragEnd}
          >
            <SortableContext
              items={events.map((x) => x.key)}
              strategy={verticalListSortingStrategy}
            >
              {events.map((ev) => (
                <SortableEventRow
                  key={ev.key}
                  ev={ev}
                  /* ...the same seven props as Task 1, unchanged... */
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
```

`space-y-2` still spaces the rows: `DndContext` and `SortableContext` render no DOM element, so the wrapper divs from `SortableEventRow` remain the direct DOM children of the `space-y-2` div.

- [ ] **Step 5: Verify lint and types**

Run: `pnpm lint` — Expected: no errors.
Run: `pnpm exec tsc --noEmit` — Expected: no output (clean).

- [ ] **Step 6: Check the drag path by reading the diff**

Confirm: `attributes`/`listeners` appear only on the grip button; the grip is `type="button"`; `DndContext` id comes from `React.useId()`; `onEventDragEnd` returns early when `over` is null or equal to `active`; `items` and the rendered rows use the same `ev.key`; the save maps at the old `:1541`/`:1642` are untouched.

- [ ] **Step 7: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): drag to reorder events inside a day"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/TODO.md` — new bolded paragraph at the top of `## Current Phase`, after the phase line, matching the style of the surrounding entries.
- Modify: `docs/DECISIONS.md` — one row appended before the trailing `## Notes` section.

- [ ] **Step 1: Add the `TODO.md` entry**

Marked *implemented, unverified in app*, and carrying the in-app checklist from the spec's success criteria (list 2).

- [ ] **Step 2: Add the `DECISIONS.md` row**

Two non-obvious choices, one row: grip-only listeners (because the row is a form, unlike the day cards which drag whole-card), and the reorder being draft state until save (unlike day dragging, which persists on drop).

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record event drag-to-reorder"
```

---

## Self-Review

**Spec coverage:** §1 scope → Task 1 + 2 both confined to `DayForm`, which backs the edit and add forms. §2 `SortableEventRow` → Task 2 step 2 (grip glyph, classes, handle-only listeners). §3 wiring → Task 2 steps 1, 3, 4 (sensors verbatim from the day list, `closestCenter`, `verticalListSortingStrategy`, `React.useId()`, `items`, `arrayMove`). §4 write path → no task, by design: nothing downstream changes, asserted in Task 2 step 6. §5.1 draft-until-save → falls out of `setEvents`, commented in Task 2 step 3. §5.2 mixed timed/untimed → accepted limitation, no code. The extraction in Task 1 is not in the spec; it is the enabling refactor and changes no behavior.

**Placeholder scan:** The one `/* ...the same seven props as Task 1, unchanged... */` in Task 2 step 4 is a deliberate pointer to code two pages up in the same document, not a gap — the element name and the wrapper are what that step changes. Everything else is literal code.

**Type consistency:** `EventRow`'s prop names (`ev`, `isPending`, `handle`, `onPatch`, `onNormalizeTime`, `onNormalizeEndTime`, `onRemove`) are identical in Task 1 step 1, Task 1 step 2, and Task 2. `SortableEventRow` takes `React.ComponentProps<typeof EventRow>`, so the two stay in sync by construction. The sortable id is `EventDraft.key` (`string`) everywhere; `DragEndEvent` ids are `UniqueIdentifier`, hence the `String()` coercions, matching `onGroupDragEnd` (`:504`).

## Success criteria

### Verified by Claude

1. `pnpm lint` and `pnpm exec tsc --noEmit` pass.
2. `attributes`/`listeners` only on the grip button.
3. `DndContext` id from `React.useId()`.
4. `onEventDragEnd` no-ops on a null or self `over`.
5. Draft-to-event save maps unchanged, so `rating`/`note`/`category`/`url`/`details` still round-trip.
6. No migration, no server-action change, no source file touched but `itinerary-tab.tsx`.

### Verified by the user in-app

1. Editing a day with 3+ untimed events: each row shows a `⠿` grip; dragging one reorders the rows.
2. Selecting text and placing the cursor in the time, text, link and details fields still works — no drag starts.
3. Saving persists the order: reopening the day shows it, and the collapsed and expanded day views list it that way.
4. Cancelling discards the reorder.
5. The same drag works in the add-a-day form before the day is saved.
6. Typing a time into one event does not scramble the order of the remaining untimed events.
7. Works by touch at a phone viewport (press-and-hold ~200ms on the grip, then drag), light and dark.
8. Dragging an event does not drag the day card underneath it.
