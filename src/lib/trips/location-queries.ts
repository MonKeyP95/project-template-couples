import { createClient } from "@/lib/supabase/server"

import {
  rowToLocation,
  type ItineraryLocation,
} from "@/lib/trips/location-types"

export async function getItineraryLocations(
  tripId: string,
): Promise<ItineraryLocation[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_locations")
    .select("id, name, sort_order")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: true })

  return (data ?? []).map(rowToLocation)
}
