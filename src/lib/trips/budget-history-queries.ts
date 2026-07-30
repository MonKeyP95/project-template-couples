import { createClient } from "@/lib/supabase/server"
import { getRates } from "@/lib/fx/get-rates"
import { inverseRate, toHomeCents } from "@/lib/fx/convert"
import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"
import type { TripListItem } from "@/lib/trips/list-queries"
import {
  perCategoryRollup,
  type ExpenseSpend,
  type PlannedSpend,
} from "@/lib/trips/budget-rollup-types"
import {
  buildBudgetHistory,
  buildTripBudgetSummary,
  dayCountInclusive,
  type CategoryHistory,
  type TripBudgetSummary,
  type TripRollupInput,
} from "@/lib/trips/budget-history-types"

interface ExpenseRow {
  trip_id: string
  category: string
  amount_cents: number
  home_amount_cents: number | null
  is_settlement: boolean
}
interface ItemRow {
  trip_id: string
  category: string
  amount_cents: number
}

/**
 * Per-trip Slice-1 rollups for the given trips (pass the started ones). One
 * batched read of expenses + budget items; RLS-scoped by the caller's session.
 */
export async function getTripRollups(
  trips: TripListItem[],
): Promise<TripRollupInput[]> {
  const dated = trips.filter((t) => t.startDate && t.endDate)
  const tripIds = dated.map((t) => t.id)
  if (tripIds.length === 0) return []

  const supabase = await createClient()
  const [{ data: expRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("expenses")
      .select("trip_id, category, amount_cents, home_amount_cents, is_settlement")
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
      amountCents: r.home_amount_cents ?? r.amount_cents,
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
  return dated.map((t) => ({
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
}

/**
 * Both /profile budget lenses from a single fetch: the cross-trip category
 * history and the per-trip summaries (trips with real spend only).
 *
 * The history is normalised to `workspaceCurrency` because an average across
 * trips has to be in one unit; the summaries are **not**, because each is
 * rendered against its own trip's HOME currency. Normalisation is display-only at
 * today's rate, one conversion per trip -- no stored value is touched, so
 * opening the Thailand trip still shows its own numbers.
 */
export async function getProfileBudgetData(
  trips: TripListItem[],
  workspaceCurrency: string,
): Promise<{
  history: CategoryHistory[]
  summaries: TripBudgetSummary[]
  /** Trips recorded in another currency and converted for the history view. */
  convertedTripCount: number
}> {
  const rollups = await getTripRollups(trips)
  const catOrder = [...EXPENSE_CATEGORIES]

  // home amounts are denominated in the trip's HOME currency, not what it
  // spends in -- normalising by the spend currency would convert the wrong unit.
  const currencyByTrip = new Map(trips.map((t) => [t.id, t.homeCurrency]))
  const foreign = rollups.filter(
    (r) => (currencyByTrip.get(r.tripId) ?? workspaceCurrency) !== workspaceCurrency,
  )
  const rates = foreign.length > 0 ? await getRates(workspaceCurrency) : null

  function scale(cents: number, tripCurrency: string): number {
    if (tripCurrency === workspaceCurrency) return cents
    const foreignPerHome = rates?.[tripCurrency]
    // No rate: leave the figure as-is rather than invent one. It is one trip in
    // a comparison view, not a stored number.
    if (!foreignPerHome) return cents
    return toHomeCents(cents, inverseRate(foreignPerHome))
  }

  const normalised: TripRollupInput[] = rollups.map((r) => {
    const cur = currencyByTrip.get(r.tripId) ?? workspaceCurrency
    if (cur === workspaceCurrency) return r
    return {
      ...r,
      rollup: r.rollup.map((c) => ({
        category: c.category,
        plannedCents: scale(c.plannedCents, cur),
        actualCents: scale(c.actualCents, cur),
      })),
    }
  })

  return {
    history: buildBudgetHistory(normalised, catOrder),
    summaries: rollups
      .map(buildTripBudgetSummary)
      .filter((s) => s.totalActualCents > 0),
    convertedTripCount: foreign.length,
  }
}
