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
 * spent total. With no plan on any category, lines are plain spend: all "ok",
 * each bar sized against the biggest spender.
 */
export function byCategoryLines(
  expenses: ExpenseSpend[],
  items: PlannedSpend[],
  catOrder: string[],
  tripStarted: boolean,
): { lines: CategoryLine[]; preTripFootCents: number } {
  const rollup = perCategoryRollup(expenses, items, catOrder)
  const footed = (r: CategoryRollup) => tripStarted && r.category === PRE_TRIP
  const preTripFootCents = rollup.find(footed)?.actualCents ?? 0
  const shown = rollup.filter((r) => !footed(r))
  const noPlan = rollup.every((r) => r.plannedCents === 0)
  const maxActual = Math.max(0, ...shown.map((r) => r.actualCents))
  const lines: CategoryLine[] = shown.map((r) =>
    noPlan
      ? { ...r, status: "ok", pct: relativePct(r.actualCents, maxActual) }
      : { ...r, status: lineStatus(r, tripStarted), pct: linePct(r) },
  )
  return { lines, preTripFootCents }
}

function relativePct(cents: number, maxCents: number): number {
  return maxCents > 0 ? Math.round((cents / maxCents) * 100) : 0
}
