import { createClient } from "@/lib/supabase/server"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripExpenses } from "@/lib/trips/expense-queries"
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import {
  assembleJournal,
  type JournalPreTripItem,
  type JournalRecord,
} from "@/lib/journal/journal-types"

/** Fetch a trip's raw journal: itinerary locations + days, expenses, and the
 * before-you-go (Pre-trip) budget items, assembled into a JournalRecord. */
export async function getTripJournal(
  tripId: string,
  memberIds: string[],
): Promise<JournalRecord> {
  const supabase = await createClient()
  const [locations, expenses, days, preRes] = await Promise.all([
    getItineraryLocations(tripId),
    getTripExpenses(tripId),
    getItineraryDays(tripId),
    supabase
      .from("trip_budget_items")
      .select("subject, amount_cents, sort_order")
      .eq("trip_id", tripId)
      .eq("category", "Pre-trip")
      .order("sort_order", { ascending: true }),
  ])

  const preTripItems: JournalPreTripItem[] = (preRes.data ?? []).map((r) => ({
    title: (r.subject as string) ?? "",
    amountCents: (r.amount_cents as number) ?? 0,
  }))

  return assembleJournal({ locations, days, expenses, preTripItems, memberIds })
}
