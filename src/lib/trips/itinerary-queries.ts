import { createClient } from "@/lib/supabase/server"

import {
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
} from "@/lib/trips/itinerary-types"

export async function getItineraryDays(
  tripId: string,
): Promise<ItineraryDay[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("id, day_date, title, sub, events, tag, tone, group_id, group_name, location_id")
    .eq("trip_id", tripId)
    .order("day_date", { ascending: true })

  return withOrdinals((data ?? []).map(rowToItineraryDay))
}
