"use client"

import { useDroppable } from "@dnd-kit/core"

import { EMPTY_PREFIX } from "@/lib/trips/itinerary-slots"

/** One empty day of the trip: a slim row that takes a dragged day. */
export function EmptyDaySlot({ dayIndex, label }: { dayIndex: number; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${EMPTY_PREFIX}${dayIndex}` })
  return (
    <div
      ref={setNodeRef}
      className={`my-1 rounded-lg border border-dashed px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
        isOver ? "border-sea bg-sea/10 text-foreground" : "border-rule text-muted-foreground"
      }`}
    >
      {label} · free
    </div>
  )
}
