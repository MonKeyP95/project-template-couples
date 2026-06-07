import { createClient } from "@/lib/supabase/server"
import type { BudgetMove } from "./location-budget-types"

export async function getTripBudgetMoves(tripId: string): Promise<BudgetMove[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_budget_moves")
    .select(
      "id, trip_id, from_location_id, to_location_id, amount_cents, created_by, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    amountCents: row.amount_cents,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }))
}
