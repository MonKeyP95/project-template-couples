import type { TripBudgetSummary } from "@/lib/trips/budget-history-types"

function euro(cents: number): string {
  return (cents / 100).toFixed(0)
}

function variance(actualCents: number, plannedCents: number) {
  const v = actualCents - plannedCents
  const over = v > 0
  const label =
    v === 0 ? "on plan" : over ? `+€${euro(v)} over` : `€${euro(-v)} under`
  return { over, label }
}

export function TripBudget({ summary }: { summary: TripBudgetSummary }) {
  const total = variance(summary.totalActualCents, summary.totalPlannedCents)
  return (
    <div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Trip budget
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {summary.categories.map((c) => {
          const v = variance(c.actualCents, c.plannedCents)
          return (
            <div
              key={c.category}
              className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
            >
              <span className="text-foreground">{c.category}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-muted-foreground">
                  spent €{euro(c.actualCents)} / €{euro(c.plannedCents)}
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
              spent €{euro(summary.totalActualCents)} / €
              {euro(summary.totalPlannedCents)}
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
