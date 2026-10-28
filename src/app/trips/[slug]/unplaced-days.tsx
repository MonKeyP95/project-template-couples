"use client"

import { useDraggable } from "@dnd-kit/core"

import { Label } from "@/components/together"
import type { UnplacedDay } from "@/lib/trips/itinerary-types"

/** Days taken out of the trip by a date change; each drags back onto a free day. */
export function UnplacedDays({
  days,
  onDelete,
}: {
  days: UnplacedDay[]
  onDelete: (id: string) => void
}) {
  if (days.length === 0) return null
  return (
    <div className="mt-6 border-t border-rule pt-3">
      <Label>Unplaced</Label>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        Drag onto a free day to put it back.
      </p>
      {days.map((day) => (
        <UnplacedRow key={day.id} day={day} onDelete={() => onDelete(day.id)} />
      ))}
    </div>
  )
}

function UnplacedRow({ day, onDelete }: { day: UnplacedDay; onDelete: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: day.id })
  const events = day.events.length
  return (
    <div
      ref={setNodeRef}
      className={`mt-2 flex items-center gap-3 rounded-lg border border-rule bg-card px-3.5 py-2 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div {...attributes} {...listeners} className="min-w-0 flex-1 cursor-grab touch-none">
        <div className="truncate text-[14px] text-foreground">{day.title || "Untitled day"}</div>
        {events > 0 ? (
          <div className="font-mono text-[10px] text-muted-foreground">
            {events === 1 ? "1 event" : `${events} events`}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="border-0 bg-transparent font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-clay"
      >
        delete
      </button>
    </div>
  )
}
