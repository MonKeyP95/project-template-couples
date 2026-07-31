"use client"

import * as React from "react"

import { Bar, Chevron } from "@/components/together"
import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { dayLabel, type BudgetPace, type PaceBucket } from "@/lib/trips/budget-pace"

type Verdict = { text: string; tone: "clay" | "muted" }

function verdict(deltaCents: number, currency: string): Verdict {
  if (deltaCents > 0) return { text: `${money(deltaCents, currency)} over`, tone: "clay" }
  if (deltaCents < 0) return { text: `${money(-deltaCents, currency)} spare`, tone: "muted" }
  return { text: "on budget", tone: "muted" }
}

function pctOf(spentCents: number, plannedCents: number): number {
  if (plannedCents <= 0) return spentCents > 0 ? 100 : 0
  return Math.min(100, Math.round((spentCents / plannedCents) * 100))
}

function asOf(pace: BudgetPace): string {
  return pace.lastLogged ? `as of ${dayLabel(pace.lastLogged)}` : "nothing logged yet"
}

function toneClass(tone: "clay" | "muted"): string {
  return tone === "clay" ? "text-clay" : "text-muted-foreground"
}

/** Compact road verdict: one line, one bar, no drill-down. */
export function PaceLine({
  pace,
  className,
}: {
  pace: BudgetPace
  className?: string
}) {
  const { currency } = useCurrency()
  const v = verdict(pace.deltaCents, currency)
  const current = pace.buckets.find((b) => b.status === "current")
  return (
    <section
      className={cn("rounded-[14px] border border-border bg-card px-5 py-4", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className={cn("t-num text-[15px]", toneClass(v.tone))}>{v.text}</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
          {current ? `${current.label} · ` : ""}
          {asOf(pace)}
        </span>
      </div>
      <Bar
        className="mt-2"
        pct={pctOf(pace.spentToDateCents, pace.plannedToDateCents)}
        tone={v.tone}
      />
    </section>
  )
}

function bucketNote(bucket: PaceBucket, currency: string): string {
  if (bucket.status === "future") return "to come"
  if (!bucket.logged) return "not logged"
  const delta = bucket.spentCents - bucket.plannedCents
  if (delta === 0) return "on budget"
  return `${money(Math.abs(delta), currency)} ${delta > 0 ? "over" : "spare"}`
}

function BucketRow({
  bucket,
  open,
  onToggle,
  leaf = false,
}: {
  bucket: PaceBucket
  open?: boolean
  onToggle?: () => void
  /** Child rows never expand -- the strip drills down exactly one level. */
  leaf?: boolean
}) {
  const { currency } = useCurrency()
  const expandable = !leaf && bucket.children.length > 0

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
          {bucket.label}
          {expandable ? (
            <Chevron dir={open ? "down" : "right"} className="ml-1.5 inline-block" />
          ) : null}
        </span>
        <span className="t-num text-[12px] text-foreground">
          {bucketNote(bucket, currency)}
        </span>
      </div>
      {bucket.logged ? (
        <Bar
          className="mt-1.5"
          pct={pctOf(bucket.spentCents, bucket.plannedCents)}
          tone={bucket.spentCents > bucket.plannedCents ? "clay" : "muted"}
        />
      ) : (
        <div className="mt-1.5 h-1 w-full rounded-full border border-dashed border-border" />
      )}
    </>
  )

  if (!expandable) return <div className="py-2">{body}</div>

  return (
    <div className="py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full border-0 bg-transparent p-0 text-left"
      >
        {body}
      </button>
      {open ? (
        <div className="mt-1 border-l border-border pl-3">
          {bucket.children.map((child) => (
            <BucketRow key={child.startDate} bucket={child} leaf />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Full Budget-tab strip: the verdict, the denominator, and one row per bucket. */
export function PaceStrip({ pace }: { pace: BudgetPace }) {
  const { currency } = useCurrency()
  const v = verdict(pace.deltaCents, currency)
  const [openDate, setOpenDate] = React.useState<string | null>(null)

  const denominator =
    pace.source === "flat" && pace.preTripPlannedCents > 0
      ? `${money(pace.onTheRoadBudgetCents, currency)} on the road (budget less ${money(pace.preTripPlannedCents, currency)} before you go)`
      : `${money(pace.onTheRoadBudgetCents, currency)} planned on the road`

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn("t-num text-[16px]", toneClass(v.tone))}>{v.text}</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
          day {pace.dayIndex} of {pace.tripDays} · {asOf(pace)}
        </span>
      </div>
      <div className="mt-1 font-mono text-[9.5px] tracking-[0.06em] text-muted-foreground">
        {denominator}
      </div>
      <div className="mt-2">
        {pace.buckets.map((bucket) => (
          <BucketRow
            key={bucket.startDate}
            bucket={bucket}
            open={openDate === bucket.startDate}
            onToggle={() =>
              setOpenDate(openDate === bucket.startDate ? null : bucket.startDate)
            }
          />
        ))}
      </div>
    </div>
  )
}
