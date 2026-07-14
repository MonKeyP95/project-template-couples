"use client"

import * as React from "react"

import type { CategoryHistory } from "@/lib/trips/budget-history-types"

const MON_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function euro(cents: number): string {
  return (cents / 100).toFixed(0)
}

function monYear(startDate: string): string {
  return MON_YEAR.format(new Date(`${startDate}T00:00:00Z`))
}

function variancePhrase(pct: number | null): string {
  if (pct === null) return ""
  if (Math.abs(pct) <= 2) return "runs on plan"
  return pct > 0 ? `runs +${pct}% over plan` : `runs ${pct}% under plan`
}

export function BudgetHistory({
  categories,
}: {
  categories: CategoryHistory[]
}) {
  if (categories.length === 0) return null
  return (
    <div className="mt-10 border-t border-border pt-8">
      <p className="text-sm text-muted-foreground">
        Budget history (what our trips actually cost)
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {categories.map((c) => (
          <CategoryRow key={c.category} category={c} />
        ))}
      </div>
    </div>
  )
}

function CategoryRow({ category }: { category: CategoryHistory }) {
  const [open, setOpen] = React.useState(false)
  const phrase = variancePhrase(category.avgVariancePct)
  return (
    <div className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-2 border-0 bg-transparent p-0 text-left"
      >
        <span className="font-serif text-[15px] italic text-foreground">
          {category.category}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          €{euro(category.avgPerDayCents)}/day avg
          {phrase ? ` · ${phrase}` : ""}
        </span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          {category.trips.map((t) => {
            const variance = t.actualCents - t.plannedCents
            const over = variance > 0
            return (
              <div key={t.tripId} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-foreground">
                    {t.tripName}
                    <span className="text-muted-foreground">
                      {" "}
                      · {monYear(t.startDate)} · {t.dayCount} days
                    </span>
                  </span>
                  <span className="font-mono text-[12px] text-foreground">
                    €{euro(t.perDayCents)}/day
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
                  <span className="text-muted-foreground">
                    spent €{euro(t.actualCents)} / €{euro(t.plannedCents)}
                  </span>
                  <span className={over ? "text-clay" : "text-muted-foreground"}>
                    {variance === 0
                      ? "on plan"
                      : over
                        ? `+€${euro(variance)} over`
                        : `€${euro(-variance)} under`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
