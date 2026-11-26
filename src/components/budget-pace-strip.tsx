"use client"

import { useCurrency } from "@/components/currency-context"
import { useMoney } from "@/components/money-context"
import { cn } from "@/lib/utils"
import { dayLabel, type BudgetPace } from "@/lib/trips/budget-pace"

function verdict(deltaCents: number, fmt: (cents: number) => string): string {
  if (deltaCents > 0) return `${fmt(deltaCents)} over`
  if (deltaCents < 0) return `${fmt(-deltaCents)} spare`
  return "on budget"
}

/** "kr 262.50 spare as of 5 Nov": the pace verdict at the last-logged watermark. */
export function PaceNote({ pace }: { pace: BudgetPace }) {
  const { currency } = useCurrency()
  const { money } = useMoney()
  if (!pace.lastLogged) return <span>nothing logged yet</span>
  return (
    <span className={cn(pace.deltaCents > 0 && "text-clay")}>
      {verdict(pace.deltaCents, (c) => money(c, currency))} as of {dayLabel(pace.lastLogged)}
    </span>
  )
}

/** Shown only when the pace runs against a different figure than the headline
 * budget: planned lines that do not add up to it, or before-you-go costs carved out. */
export function PaceDenominator({
  pace,
  plannedBudgetCents,
}: {
  pace: BudgetPace
  plannedBudgetCents: number
}) {
  const { money } = useMoney()
  const { currency } = useCurrency()
  if (pace.onTheRoadBudgetCents === plannedBudgetCents) return null
  const against = money(pace.onTheRoadBudgetCents, currency)
  const text =
    pace.source === "flat"
      ? `pace against ${against} on the road (budget less ${money(pace.preTripPlannedCents, currency)} before you go)`
      : `pace against ${against} planned on the road`
  return (
    <div className="mt-1 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
      {text}
    </div>
  )
}
