"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addTodayEvent } from "@/lib/trips/actions"
import { learnAboutItem } from "@/lib/trips/dispatch-actions"
import { normalizeTime } from "@/lib/trips/event-time"
import {
  DISPATCH_KIND_LABEL,
  type DispatchDetail,
  type DispatchItem,
} from "@/lib/trips/dispatch-types"

/** One itinerary day the card can drop an event on. */
export interface DispatchDay {
  id: string
  dayDate: string
  label: string
}

/** whats_on is a thing you go and do; a strike or a swell is not. Drives the
 * default category on the event's expense form. */
function eventCategory(item: DispatchItem): string | undefined {
  return item.kind === "whats_on" ? "Activities" : undefined
}

/**
 * One dispatch card. Read-only until pressed; expanded it offers the two things
 * a found event is actually for — putting it on a date, and asking more about
 * it. Expansion is owned by the deck (it stops the rotation), everything else
 * lives here.
 */
export function DispatchItemCard({
  item,
  index,
  tripId,
  tripSlug,
  today,
  days,
  expanded,
  onToggle,
}: {
  item: DispatchItem
  /** Position in the stored dispatch row — how the server finds it again. */
  index: number
  tripId: string
  tripSlug: string
  today: string
  days: DispatchDay[]
  expanded: boolean
  onToggle: (expanded: boolean) => void
}) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [added, setAdded] = React.useState(false)
  const [dayId, setDayId] = React.useState(
    () => days.find((d) => d.dayDate === today)?.id ?? days[0]?.id ?? "",
  )
  const [newDate, setNewDate] = React.useState(today)
  const [time, setTime] = React.useState("")
  const [detail, setDetail] = React.useState<DispatchDetail | null>(null)
  const [question, setQuestion] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // No day selected means the trip has none yet: create one on the typed date.
  function add() {
    const day = days.find((d) => d.id === dayId)
    setError(null)
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate: day ? day.dayDate : newDate,
      dayId: day?.id ?? null,
      time: normalizeTime(time),
      text: item.title,
      url: item.sourceUrl,
      category: eventCategory(item),
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded(true)
      setAdding(false)
      router.refresh()
    })
  }

  function learn(ask: string) {
    setLoading(true)
    setError(null)
    learnAboutItem(tripSlug, today, index, ask).then((result) => {
      setLoading(false)
      if (result.error) {
        setError(result.error)
        return
      }
      setDetail(result.detail ?? null)
      setQuestion("")
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {DISPATCH_KIND_LABEL[item.kind]}
        </div>
        {expanded ? (
          <button
            type="button"
            onClick={() => onToggle(false)}
            aria-label="Close"
            className="-mt-0.5 border-0 bg-transparent px-1 font-mono text-[13px] leading-none text-muted-foreground hover:text-clay"
          >
            ×
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onToggle(!expanded)}
        aria-expanded={expanded}
        className="mt-1 block w-full border-0 bg-transparent p-0 text-left"
      >
        <span className="block text-[13px] text-foreground">{item.title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
          {item.body}
        </span>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>{item.window}</span>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sea hover:underline"
        >
          source
        </a>
      </div>

      {expanded ? (
        <div className="mt-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {added ? (
              <span className="rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background">
                added
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
              >
                add to a date
              </button>
            )}
            <button
              type="button"
              onClick={() => learn("")}
              disabled={loading}
              className="rounded-full border border-rule px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {loading ? "learning…" : "learn more"}
            </button>
          </div>

          {adding ? (
            <div className="flex flex-wrap items-center gap-2">
              {days.length ? (
                <select
                  value={dayId}
                  onChange={(e) => setDayId(e.target.value)}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                >
                  {days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="t-num rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                />
              )}
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onBlur={() => setTime((t) => normalizeTime(t))}
                placeholder="19:30"
                className="t-num w-16 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
              />
              <button
                type="button"
                onClick={add}
                className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
              >
                add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false)
                  setTime("")
                }}
                aria-label="Cancel"
                className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay"
              >
                ×
              </button>
            </div>
          ) : null}

          {detail ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] leading-snug text-muted-foreground">
                {detail.detail}
              </p>
              {detail.links.length ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {detail.links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : null}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const ask = question.trim()
                  if (ask) learn(ask)
                }}
              >
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="ask about this…"
                  disabled={loading}
                  className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-40"
                />
              </form>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}
