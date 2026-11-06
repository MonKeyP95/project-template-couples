"use client"

import { Bar } from "@/components/together"
import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { BudgetPeriod, PeriodCheck } from "@/lib/trips/budget-period"

const PERIOD: Record<BudgetPeriod, string> = {
  day: "Today",
  week: "This week",
  trip: "Trip",
}
const UNDER: Record<BudgetPeriod, string> = {
  day: "left today",
  week: "left this week",
  trip: "left",
}
const OVER: Record<BudgetPeriod, string> = {
  day: "over today",
  week: "over this week",
  trip: "over budget",
}

function verdict(check: PeriodCheck, currency: string): string {
  if (check.deltaCents === 0) return "on budget"
  const amount = money(Math.abs(check.deltaCents), currency)
  return `${amount} ${check.deltaCents > 0 ? OVER[check.period] : UNDER[check.period]}`
}

function pct(check: PeriodCheck): number {
  if (check.plannedCents <= 0) return check.spentCents > 0 ? 100 : 0
  return Math.min(100, Math.round((check.spentCents / check.plannedCents) * 100))
}

/** The dispatch box's budget card: one over/under line and a bar for the trip's chosen period. */
export function BudgetCard({ check }: { check: PeriodCheck }) {
  const { currency } = useCurrency()
  const over = check.deltaCents > 0
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Budget · {PERIOD[check.period]}
      </span>
      <span className={cn("t-num mt-0.5 block text-[14px]", over ? "text-clay" : "text-foreground")}>
        {verdict(check, currency)}
      </span>
      <Bar className="mt-2" pct={pct(check)} tone={over ? "clay" : "muted"} />
    </div>
  )
}
