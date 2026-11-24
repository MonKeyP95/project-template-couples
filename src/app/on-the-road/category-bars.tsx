import { Bar, Label, categoryTone } from "@/components/together"
import { moneyRounded } from "@/lib/money"
import type { CategoryLine } from "@/lib/trips/budget-by-category-types"

/** The trip's spend against plan per category, read-only, same colours as the Budget tab. */
export function CategoryBars({
  lines,
  currency,
}: {
  lines: CategoryLine[]
  currency: string
}) {
  if (lines.length === 0) return null
  return (
    <div className="px-[18px] pt-1 pb-3">
      <Label>Trip by category</Label>
      <div className="mt-1">
        {lines.map((line, i) => {
          const warn = line.status === "over" || line.status === "unplanned"
          return (
            <div
              key={line.category}
              className="grid grid-cols-[minmax(0,6rem)_1fr_auto] items-center gap-x-2.5 py-1"
            >
              <span className="truncate text-[13px] text-foreground">{line.category}</span>
              <Bar pct={line.pct} tone={warn ? "red" : categoryTone(i)} />
              <span className="t-num whitespace-nowrap font-mono text-[11px] text-foreground">
                {moneyRounded(line.actualCents, currency)}
                {line.status === "unplanned" ? null : (
                  <span className="text-muted-foreground">
                    {" / "}
                    {moneyRounded(line.plannedCents, currency)}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
