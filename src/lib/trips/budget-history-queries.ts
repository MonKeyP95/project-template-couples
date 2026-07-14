import { createClient } from "@/lib/supabase/server"
import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"
import type { TripListItem } from "@/lib/trips/list-queries"
import {
  perCategoryRollup,
  type ExpenseSpend,
  type PlannedSpend,
} from "@/lib/trips/budget-rollup-types"
import {
  buildBudgetHistory,
  dayCountInclusive,
  type CategoryHistory,
  type TripRollupInput,
} from "@/lib/trips/budget-history-types"

interface ExpenseRow {
  trip_id: string
  category: string
  amount_cents: number
  is_settlement: boolean
}
interface ItemRow {
  trip_id: string
  category: string
  amount_cents: number
}

/**
 * Cross-trip category history for the given trips (pass the started ones).
 * Live aggregation, no snapshot: reads current expenses + budget items and
 * folds each trip's Slice-1 rollup into a category-first history. RLS-scoped
 * by the caller's session.
 */
export async function getBudgetHistory(
  trips: TripListItem[],
): Promise<CategoryHistory[]> {
  const dated = trips.filter((t) => t.startDate && t.endDate)
  const tripIds = dated.map((t) => t.id)
  if (tripIds.length === 0) return []

  const supabase = await createClient()
  const [{ data: expRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("expenses")
      .select("trip_id, category, amount_cents, is_settlement")
      .in("trip_id", tripIds)
      .returns<ExpenseRow[]>(),
    supabase
      .from("trip_budget_items")
      .select("trip_id, category, amount_cents")
      .in("trip_id", tripIds)
      .returns<ItemRow[]>(),
  ])

  const expByTrip = new Map<string, ExpenseSpend[]>()
  for (const r of expRows ?? []) {
    const arr = expByTrip.get(r.trip_id) ?? []
    arr.push({
      category: r.category,
      amountCents: r.amount_cents,
      isSettlement: r.is_settlement,
    })
    expByTrip.set(r.trip_id, arr)
  }

  const itemsByTrip = new Map<string, PlannedSpend[]>()
  for (const r of itemRows ?? []) {
    const arr = itemsByTrip.get(r.trip_id) ?? []
    arr.push({ category: r.category, amountCents: r.amount_cents })
    itemsByTrip.set(r.trip_id, arr)
  }

  const catOrder = [...EXPENSE_CATEGORIES]
  const inputs: TripRollupInput[] = dated.map((t) => ({
    tripId: t.id,
    tripName: t.name,
    startDate: t.startDate as string,
    dayCount: dayCountInclusive(t.startDate as string, t.endDate as string),
    rollup: perCategoryRollup(
      expByTrip.get(t.id) ?? [],
      itemsByTrip.get(t.id) ?? [],
      catOrder,
    ),
  }))

  return buildBudgetHistory(inputs, catOrder)
}
