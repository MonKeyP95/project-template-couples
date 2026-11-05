"use client"

import { Bar } from "@/components/together"
import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { dayLabel } from "@/lib/trips/budget-pace"
import type { BudgetPeriod, PeriodCheck } from "@/lib/trips/budget-period"

const UNDER: Record<BudgetPeriod, string> = {
  day: "left today",
  week: "under this week",
  trip: "under",
}
const OVER: Record<BudgetPeriod, string> = {
  day: "over today",
  week: "over this week",
  trip: "over",
}

function verdict(check: PeriodCheck, currency: string): string {
  if (check.nothingLogged) return "nothing logged yet"
  if (check.deltaCents === 0) return "on budget"
  const amount = money(Math.abs(check.deltaCents), currency)
  return `${amount} ${check.deltaCents > 0 ? OVER[check.period] : UNDER[check.period]}`
}

function pct(check: PeriodCheck): number {
  if (check.nothingLogged) return 0
  if (check.plannedCents <= 0) return check.spentCents > 0 ? 100 : 0
  return Math.min(100, Math.round((check.spentCents / check.plannedCents) * 100))
}

/** The dispatch box's budget card: one over/under line and a bar for the trip's chosen period. */
export function BudgetCard({ check }: { check: PeriodCheck }) {
  const { currency } = useCurrency()
  const over = !check.nothingLogged && check.deltaCents > 0
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className={cn("t-num text-[13px]", over ? "text-clay" : "text-muted-foreground")}>
          {verdict(check, currency)}
        </span>
        {check.asOf ? (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
            as of {dayLabel(check.asOf)}
          </span>
        ) : null}
      </div>
      <Bar className="mt-2" pct={pct(check)} tone={over ? "clay" : "muted"} />
    </div>
  )
}
