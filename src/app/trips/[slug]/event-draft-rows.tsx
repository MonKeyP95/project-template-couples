"use client"

import * as React from "react"

import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { ItineraryEvent } from "@/lib/trips/itinerary-types"

export interface EventDraft {
  key: string
  time: string
  endTime: string
  text: string
  url: string
  details: string
  /** Pass-through only — the planning form never edits these, but must not drop
   * them when saving other fields (they carry the post-experience rating). */
  rating?: number
  note?: string
  /** Pass-through only — the discovery door stamps this expense-category tag;
   * the edit form never shows it but must not drop it on save. */
  category?: string
}

export function newEventDraft(time = "", endTime = "", text = "", url = "", details = ""): EventDraft {
  return { key: crypto.randomUUID(), time, endTime, text, url, details }
}

/** Normalize a typed time to "HH:MM": "11" -> "11:00", "9:5" -> "09:05".
 * Leaves blanks and unrecognized input untouched. */
export function normalizeTime(raw: string): string {
  const v = raw.trim()
  if (!v) return ""
  const m = v.match(/^(\d{1,2})(?::?(\d{1,2}))?$/)
  if (!m) return v
  return `${m[1].padStart(2, "0")}:${(m[2] ?? "0").padStart(2, "0")}`
}

/** Sort events ascending by time; untimed events keep their order at the end.
 * Time strings are zero-padded "HH:MM", so a plain string compare is chronological. */
export function sortEvents<T extends { time: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (!a.time && !b.time) return 0
    if (!a.time) return 1
    if (!b.time) return -1
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
  })
}

export function toEventDrafts(events: ItineraryEvent[]): EventDraft[] {
  return events.map((e) => ({
    ...newEventDraft(e.time, e.endTime ?? "", e.text, e.url ?? "", e.details ?? ""),
    rating: e.rating,
    note: e.note,
    category: e.category,
  }))
}

/** Draft -> stored event shape: times normalized, blank optionals dropped,
 * pass-through rating/note/category kept. */
export function draftToEvent(e: EventDraft): ItineraryEvent {
  return {
    time: normalizeTime(e.time),
    ...(e.endTime.trim() ? { endTime: normalizeTime(e.endTime.trim()) } : {}),
    text: e.text,
    ...(e.url.trim() ? { url: e.url.trim() } : {}),
    ...(e.details.trim() ? { details: e.details.trim() } : {}),
    ...(typeof e.rating === "number" ? { rating: e.rating } : {}),
    ...(e.note && e.note.trim() ? { note: e.note.trim() } : {}),
    ...(e.category && e.category.trim() ? { category: e.category.trim() } : {}),
  }
}

export function EventRow({
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

export function SortableEventRow(props: React.ComponentProps<typeof EventRow>) {
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

/** The sortable list of event rows a day or block form edits. */
export function EventDraftList({
  events,
  setEvents,
  isPending,
}: {
  events: EventDraft[]
  setEvents: (e: EventDraft[]) => void
  isPending: boolean
}) {
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

  return (
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
                        x.key === ev.key
                          ? { ...x, time: normalizeTime(x.time) }
                          : x,
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
                onRemove={() =>
                  setEvents(events.filter((x) => x.key !== ev.key))
                }
              />
            ))}
          </SortableContext>
        </DndContext>
  )
}
