import { createClient } from "@/lib/supabase/server"

import {
  rowToDreamDay,
  withDreamOrdinals,
  type DreamDay,
} from "@/lib/trips/dream-itinerary-types"

export async function getDreamItineraryDays(
  tripId: string,
): Promise<DreamDay[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("dream_itinerary_days")
    .select("id, day_index, title, sub, tag, tone")
    .eq("trip_id", tripId)
    .order("day_index", { ascending: true })

  return withDreamOrdinals((data ?? []).map(rowToDreamDay))
}
