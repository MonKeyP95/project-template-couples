"use client"

import type { ItineraryDay } from "@/lib/trips/itinerary-types"

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"]

/** Monday-first column of a yyyy-mm-dd date. */
function weekdayColumn(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/**
 * A small calendar of the trip's days: tap to toggle. The event's own day
 * shows selected and locked; days before `minIndex` (already past) are off.
 * A dream (no dates) shows numbered days instead of a weekday grid.
 */
export function DayMultiPicker({
  days,
  ownIndex,
  minIndex,
  selected,
  onChange,
  disabled,
}: {
  days: ItineraryDay[]
  ownIndex: number | null
  minIndex: number
  selected: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
}) {
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  const pickable = sorted
    .map((d) => d.dayIndex)
    .filter((i) => i !== ownIndex && i >= minIndex)
  const allOn = pickable.length > 0 && pickable.every((i) => selected.includes(i))
  const firstDate = sorted[0]?.dayDate ?? null
  const lead = firstDate ? weekdayColumn(firstDate) : 0

  function toggle(i: number) {
    onChange(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i].sort((a, b) => a - b))
  }

  return (
    <div className="mt-2">
      <div className="grid grid-cols-7 gap-1">
        {firstDate
          ? WEEKDAYS.map((w, i) => (
              <div key={i} className="text-center font-mono text-[9px] uppercase text-muted-foreground">
                {w}
              </div>
            ))
          : null}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {sorted.map((d) => {
          const own = d.dayIndex === ownIndex
          const on = own || selected.includes(d.dayIndex)
          const off = disabled || own || d.dayIndex < minIndex
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.dayIndex)}
              disabled={off}
              aria-pressed={on}
              aria-label={d.dayDate ? `${d.dom} ${d.mon}` : `day ${d.dayIndex}`}
              className={`flex h-8 flex-col items-center justify-center rounded-md font-mono text-[11px] leading-none transition-colors ${
                on
                  ? "bg-sea text-background"
                  : "border border-rule text-foreground hover:border-foreground"
              } ${own ? "opacity-70" : ""} ${!own && off ? "opacity-30" : ""}`}
            >
              {d.dayDate ? d.dom : d.dayIndex}
              {d.dayDate && (d.dom === "1" || d === sorted[0]) ? (
                <span className="mt-0.5 text-[7px] uppercase">{d.mon}</span>
              ) : null}
            </button>
          )
        })}
      </div>
      {pickable.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange(allOn ? [] : pickable)}
          disabled={disabled}
          className="mt-1.5 border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          {allOn ? "none" : "all"}
        </button>
      ) : null}
    </div>
  )
}
