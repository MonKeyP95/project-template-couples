"use client"

import { cn } from "@/lib/utils"
import { BUDGET_PERIODS, type BudgetPeriod } from "@/lib/trips/budget-period"

const LABEL: Record<BudgetPeriod, string> = {
  day: "per day",
  week: "per week",
  trip: "whole trip",
}

/** What the on-the-road budget card compares: today, this trip-week, or the trip so far. */
export function BudgetPeriodPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: BudgetPeriod
  onChange: (p: BudgetPeriod) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Check budget
      </span>
      {BUDGET_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === value}
          disabled={disabled}
          onClick={() => onChange(p)}
          className={cn(
            "rounded-full border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50",
            p === value
              ? "border-foreground text-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {LABEL[p]}
        </button>
      ))}
    </div>
  )
}
