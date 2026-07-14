import type { CategoryRollup } from "@/lib/trips/budget-rollup-types"

export interface TripCategorySpend {
  tripId: string
  tripName: string
  /** yyyy-mm-dd, for the label and date-desc sort. */
  startDate: string
  dayCount: number
  plannedCents: number
  actualCents: number
  /** round(actualCents / dayCount). */
  perDayCents: number
}

export interface CategoryHistory {
  category: string
  /** Sorted startDate desc. */
  trips: TripCategorySpend[]
  /** Mean of perDayCents across trips (equal weight per trip). */
  avgPerDayCents: number
  /** Mean of (actual-planned)/planned*100 over trips with planned>0; null if none. */
  avgVariancePct: number | null
}

export interface TripRollupInput {
  tripId: string
  tripName: string
  startDate: string
  dayCount: number
  rollup: CategoryRollup[]
}

/** Inclusive day span between two yyyy-mm-dd dates; minimum 1. */
export function dayCountInclusive(startDate: string, endDate: string): number {
  const ms =
    Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)
  if (!Number.isFinite(ms)) return 1
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

/**
 * Category-first cross-trip history. Each trip's rollup category with
 * actualCents > 0 becomes a TripCategorySpend under that category. Categories
 * ordered by `catOrder` with extras appended; trips within a category sorted
 * startDate desc. Categories with no real spend anywhere are absent.
 */
export function buildBudgetHistory(
  trips: TripRollupInput[],
  catOrder: string[],
): CategoryHistory[] {
  const byCat = new Map<string, TripCategorySpend[]>()
  for (const t of trips) {
    for (const r of t.rollup) {
      if (r.actualCents <= 0) continue
      const arr = byCat.get(r.category) ?? []
      arr.push({
        tripId: t.tripId,
        tripName: t.tripName,
        startDate: t.startDate,
        dayCount: t.dayCount,
        plannedCents: r.plannedCents,
        actualCents: r.actualCents,
        perDayCents: Math.round(r.actualCents / t.dayCount),
      })
      byCat.set(r.category, arr)
    }
  }

  const ordered: string[] = []
  for (const cat of catOrder) if (byCat.has(cat)) ordered.push(cat)
  for (const cat of byCat.keys()) if (!ordered.includes(cat)) ordered.push(cat)

  return ordered.map((category) => {
    const list = byCat.get(category)!
    list.sort((a, b) =>
      a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0,
    )
    const avgPerDayCents = Math.round(
      list.reduce((s, t) => s + t.perDayCents, 0) / list.length,
    )
    const planned = list.filter((t) => t.plannedCents > 0)
    const avgVariancePct =
      planned.length === 0
        ? null
        : Math.round(
            (planned.reduce(
              (s, t) => s + (t.actualCents - t.plannedCents) / t.plannedCents,
              0,
            ) /
              planned.length) *
              100,
          )
    return { category, trips: list, avgPerDayCents, avgVariancePct }
  })
}
