import { createClient } from "@/lib/supabase/server"
import {
  summarizeSavings,
  type SavingsContribution,
  type SavingsSummary,
} from "./savings-types"

export interface TripSavings extends SavingsSummary {
  contributions: SavingsContribution[]
}

/**
 * All savings contributions for a trip (newest first) plus the derived total
 * and per-member breakdown.
 */
export async function getTripSavings(
  tripId: string,
  memberIds: string[],
): Promise<TripSavings> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_savings_contributions")
    .select("id, trip_id, user_id, amount_cents, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })

  const contributions: SavingsContribution[] = (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
  }))

  return { contributions, ...summarizeSavings(contributions, memberIds) }
}
