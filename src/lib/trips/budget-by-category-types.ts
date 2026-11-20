import {
  perCategoryRollup,
  type CategoryRollup,
  type ExpenseSpend,
  type PlannedSpend,
} from "./budget-rollup-types"

export const PRE_TRIP = "Pre-trip"

export type CategoryStatus = "ok" | "over" | "unplanned" | "paidAhead"

export interface CategoryLine extends CategoryRollup {
  status: CategoryStatus
  /** Bar fill, 0-100: spent against this category's plan. */
  pct: number
}

export function lineStatus(r: CategoryRollup, tripStarted: boolean): CategoryStatus {
  if (r.plannedCents === 0 && r.actualCents > 0) return "unplanned"
  if (r.actualCents > r.plannedCents) return "over"
  if (!tripStarted && r.plannedCents > 0 && r.actualCents >= r.plannedCents) {
    return "paidAhead"
  }
  return "ok"
}

export function linePct(r: CategoryRollup): number {
  if (r.plannedCents === 0) return r.actualCents > 0 ? 100 : 0
  return Math.min(100, Math.round((r.actualCents / r.plannedCents) * 100))
}

/**
 * The Budget tab's by-category lines: spent against plan per category. Once
 * the trip has started, the Pre-trip category leaves the list and its spend is
 * returned as `preTripFootCents`, so lines plus footnote still sum to the
 * spent total.
 */
export function byCategoryLines(
  expenses: ExpenseSpend[],
  items: PlannedSpend[],
  catOrder: string[],
  tripStarted: boolean,
): { lines: CategoryLine[]; preTripFootCents: number } {
  const rollup = perCategoryRollup(expenses, items, catOrder)
  let preTripFootCents = 0
  const lines: CategoryLine[] = []
  for (const r of rollup) {
    if (tripStarted && r.category === PRE_TRIP) {
      preTripFootCents = r.actualCents
      continue
    }
    lines.push({ ...r, status: lineStatus(r, tripStarted), pct: linePct(r) })
  }
  return { lines, preTripFootCents }
}
