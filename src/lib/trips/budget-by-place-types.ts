import {
  lineStatus,
  linePct,
  PRE_TRIP,
  type CategoryStatus,
} from "./budget-by-category-types"
import type { ExpenseSpend, PlannedSpend } from "./budget-rollup-types"
import { expenseLocationId } from "./location-budget-types"

export interface PlaceLine {
  /** "pretrip", a location id, or "trip". */
  key: string
  name: string
  plannedCents: number
  actualCents: number
  status: CategoryStatus
  pct: number
}

type PlaceExpense = ExpenseSpend & {
  locationId: string | null
  dayDate: string | null
}
type PlaceItem = PlannedSpend & { locationId: string | null }

function itemKey(it: PlaceItem): string {
  if (it.category === PRE_TRIP) return "pretrip"
  return it.locationId ?? "trip"
}

function expenseKey(e: PlaceExpense, dayMap: Record<string, string>): string {
  if (e.category === PRE_TRIP) return "pretrip"
  return expenseLocationId(e, dayMap) ?? "trip"
}

/**
 * The Budget tab's by-place lines: Before you go, each location, Trip-wide.
 * Pre-trip spend and plan go to Before you go whatever their place; rows with
 * no plan and no spend are dropped.
 */
export function byPlaceLines(
  expenses: PlaceExpense[],
  items: PlaceItem[],
  locations: { id: string; name: string }[],
  dayMap: Record<string, string>,
  tripStarted: boolean,
): PlaceLine[] {
  const rows = [
    { key: "pretrip", name: "Before you go" },
    ...locations.map((l) => ({ key: l.id, name: l.name })),
    { key: "trip", name: "Trip-wide" },
  ]
  const planned: Record<string, number> = {}
  const actual: Record<string, number> = {}
  for (const it of items) {
    const k = itemKey(it)
    planned[k] = (planned[k] ?? 0) + it.amountCents
  }
  for (const e of expenses) {
    if (e.isSettlement) continue
    const k = expenseKey(e, dayMap)
    actual[k] = (actual[k] ?? 0) + e.amountCents
  }
  return rows.flatMap(({ key, name }) => {
    const r = {
      category: key,
      plannedCents: planned[key] ?? 0,
      actualCents: actual[key] ?? 0,
    }
    if (r.plannedCents === 0 && r.actualCents === 0) return []
    return [{ key, name, ...r, status: lineStatus(r, tripStarted), pct: linePct(r) }]
  })
}
