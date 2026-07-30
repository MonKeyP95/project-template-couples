import { moneyRounded } from "@/lib/money"
import type { TripBudgetSummary } from "@/lib/trips/budget-history-types"

function variance(
  actualCents: number,
  plannedCents: number,
  currency: string,
) {
  const v = actualCents - plannedCents
  const over = v > 0
  const label =
    v === 0
      ? "on plan"
      : over
        ? `+${moneyRounded(v, currency)} over`
        : `${moneyRounded(-v, currency)} under`
  return { over, label }
}

export function TripBudget({
  summary,
  currency,
}: {
  summary: TripBudgetSummary
  currency: string
}) {
  const total = variance(
    summary.totalActualCents,
    summary.totalPlannedCents,
    currency,
  )
  return (
    <div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Trip budget
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {summary.categories.map((c) => {
          const v = variance(c.actualCents, c.plannedCents, currency)
          return (
            <div
              key={c.category}
              className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
            >
              <span className="text-foreground">{c.category}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-muted-foreground">
                  spent {moneyRounded(c.actualCents, currency)} /{" "}
                  {moneyRounded(c.plannedCents, currency)}
                </span>
                <span className={v.over ? "text-clay" : "text-muted-foreground"}>
                  {v.label}
                </span>
              </span>
            </div>
          )
        })}
        <div className="flex items-baseline justify-between gap-2 border-t border-rule pt-1.5 font-mono text-[11px]">
          <span className="text-foreground">Total</span>
          <span className="flex items-baseline gap-2">
            <span className="text-muted-foreground">
              spent {moneyRounded(summary.totalActualCents, currency)} /{" "}
              {moneyRounded(summary.totalPlannedCents, currency)}
            </span>
            <span className={total.over ? "text-clay" : "text-muted-foreground"}>
              {total.label}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
