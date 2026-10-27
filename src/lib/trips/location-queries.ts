import { createClient } from "@/lib/supabase/server"

import { getTripStartDate } from "@/lib/trips/itinerary-queries"
import {
  rowToLocation,
  type ItineraryLocation,
} from "@/lib/trips/location-types"

export async function getItineraryLocations(
  tripId: string,
): Promise<ItineraryLocation[]> {
  const supabase = await createClient()
  const [start, { data }] = await Promise.all([
    getTripStartDate(tripId),
    supabase
      .from("itinerary_locations")
      .select("id, name, sort_order, start_index, end_index, budget_cents, currency")
      .eq("trip_id", tripId)
      .order("sort_order", { ascending: true }),
  ])

  return (data ?? []).map((row) => rowToLocation(row, start))
}
