"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { rateEvent } from "@/lib/trips/actions"

/** Post-experience 1-5 + note editor for one itinerary event. Store-only.
 * Addresses the event by its index in the day's time-sorted events. */
export function EventRating({
  tripSlug,
  dayId,
  eventIndex,
  rating,
  note,
}: {
  tripSlug: string
  dayId: string
  eventIndex: number
  rating?: number
  note?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [stars, setStars] = React.useState(rating ?? 0)
  const [text, setText] = React.useState(note ?? "")
  const [saving, setSaving] = React.useState(false)

  function save() {
    setSaving(true)
    rateEvent({
      tripSlug,
      dayId,
      eventIndex,
      rating: stars >= 1 ? stars : null,
      note: text.trim(),
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setStars(rating ?? 0)
          setText(note ?? "")
          setOpen(true)
        }}
        className="shrink-0 self-start font-mono text-[11px] tracking-[0.1em] text-muted-foreground hover:text-foreground"
      >
        {rating ? "★".repeat(rating) + "☆".repeat(5 - rating) : "☆ rate"}
      </button>
    )
  }

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className="px-0.5 text-[15px] leading-none text-clay"
          >
            {n <= stars ? "★" : "☆"}
          </button>
        ))}
        {stars > 0 ? (
          <button
            type="button"
            onClick={() => setStars(0)}
            className="ml-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-clay"
          >
            clear
          </button>
        ) : null}
      </div>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="note (optional)"
        disabled={saving}
        className="w-full border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full border-0 bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {saving ? "…" : "save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          cancel
        </button>
      </div>
    </div>
  )
}
