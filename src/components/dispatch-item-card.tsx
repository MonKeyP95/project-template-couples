"use client"

import * as React from "react"
import { AddToDayForm, type DispatchDay } from "@/components/add-to-day-form"
import { learnAboutItem } from "@/lib/trips/dispatch-actions"
import {
  DISPATCH_KIND_LABEL,
  type DispatchDetail,
  type DispatchItem,
} from "@/lib/trips/dispatch-types"

/** whats_on is a thing you go and do; a strike or a swell is not. Drives the
 * default category on the event's expense form. */
function eventCategory(item: DispatchItem): string | undefined {
  return item.kind === "whats_on" ? "Activities" : undefined
}

/**
 * One dispatch card. Closed it shows the headline; expanded it adds the body
 * and offers the two things a found event is actually for — putting it on a
 * date, and asking more about it. Expansion is owned by the deck (it stops the rotation), everything else
 * lives here.
 */
export function DispatchItemCard({
  item,
  index,
  dayDate,
  dayLabel,
  checkedAt,
  tripId,
  tripSlug,
  days,
  expanded,
  onToggle,
}: {
  item: DispatchItem
  /** Position in the stored dispatch row — how the server finds it again. */
  index: number
  /** The news day this item belongs to: today, or tomorrow in the evening. */
  dayDate: string
  /** "Today" or "Tomorrow". */
  dayLabel: string
  /** "HH:MM" the day's news was fetched, phone time. */
  checkedAt: string | null
  tripId: string
  tripSlug: string
  days: DispatchDay[]
  expanded: boolean
  onToggle: (expanded: boolean) => void
}) {
  const [adding, setAdding] = React.useState(false)
  const [added, setAdded] = React.useState(false)
  const [answers, setAnswers] = React.useState<
    { question: string; detail: DispatchDetail }[]
  >([])
  const [question, setQuestion] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  /** Answers stack: the first one is what the card is about, and a follow-up is
   * read alongside it, not instead of it. */
  function learn(ask: string) {
    setLoading(true)
    setError(null)
    learnAboutItem(tripSlug, dayDate, index, ask).then((result) => {
      setLoading(false)
      if (result.error) {
        setError(result.error)
        return
      }
      const detail = result.detail
      // Empty means the model finished without proposing; stacking it would
      // push a blank block onto the card.
      if (!detail || (!detail.detail.trim() && detail.links.length === 0)) {
        setError("Nothing came back on that one.")
        return
      }
      setAnswers((prev) => [...prev, { question: ask, detail }])
      setQuestion("")
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {DISPATCH_KIND_LABEL[item.kind]} · {dayLabel}
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
        <span className={`block text-[14px] text-foreground ${expanded ? "" : "line-clamp-2"}`}>
          {item.title}
        </span>
        {/* Closed shows the headline only: the deck is as tall as its tallest
            card, so a closed body would size the whole box. */}
        {expanded ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
            {item.body}
          </span>
        ) : null}
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
        {checkedAt ? <span>checked {checkedAt}</span> : null}
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
            <AddToDayForm
              tripId={tripId}
              tripSlug={tripSlug}
              days={days}
              defaultDate={dayDate}
              text={item.title}
              url={item.sourceUrl}
              category={eventCategory(item)}
              onAdded={() => {
                setAdded(true)
                setAdding(false)
              }}
              onCancel={() => setAdding(false)}
            />
          ) : null}

          {answers.length ? (
            <div className="flex flex-col gap-2">
              {answers.map((answer, i) => (
                <div
                  key={i}
                  className={`flex flex-col gap-1 ${i ? "border-t border-rule pt-2" : ""}`}
                >
                  {answer.question ? (
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground">
                      {answer.question}
                    </div>
                  ) : null}
                  <p className="text-[12px] leading-snug text-muted-foreground">
                    {answer.detail.detail}
                  </p>
                  {answer.detail.links.length ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {answer.detail.links.map((link, j) => (
                        <a
                          key={j}
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
                </div>
              ))}
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
                  className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-clay focus:outline-none disabled:opacity-40"
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
