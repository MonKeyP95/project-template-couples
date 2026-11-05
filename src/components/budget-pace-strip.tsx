"use client"

import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { dayLabel, type BudgetPace } from "@/lib/trips/budget-pace"

type Verdict = { text: string; tone: "clay" | "muted" }

function verdict(deltaCents: number, currency: string): Verdict {
  if (deltaCents > 0) return { text: `${money(deltaCents, currency)} over`, tone: "clay" }
  if (deltaCents < 0) return { text: `${money(-deltaCents, currency)} spare`, tone: "muted" }
  return { text: "on budget", tone: "muted" }
}

function asOf(pace: BudgetPace): string {
  return pace.lastLogged ? `as of ${dayLabel(pace.lastLogged)}` : "nothing logged yet"
}

function toneClass(tone: "clay" | "muted"): string {
  return tone === "clay" ? "text-clay" : "text-muted-foreground"
}

/** Budget-tab pace line: the verdict at the last-logged watermark and its denominator. */
export function PaceStrip({ pace }: { pace: BudgetPace }) {
  const { currency } = useCurrency()
  const v = verdict(pace.deltaCents, currency)

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
    </div>
  )
}
