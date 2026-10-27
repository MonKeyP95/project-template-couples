import { createClient } from "@/lib/supabase/server"

import {
  dayIndexOf,
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
} from "@/lib/trips/itinerary-types"

const DAY_COLS =
  "id, day_index, title, sub, events, tag, tone, group_id, group_name, location_id"

/** Trip's start_date (yyyy-mm-dd), or null for a dateless dream. */
export async function getTripStartDate(tripId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select("start_date")
    .eq("id", tripId)
    .maybeSingle()
  return data?.start_date ?? null
}

/** A trip's days in order. A dream's days have no date and read as "Day N". */
export async function getItineraryDays(
  tripId: string,
): Promise<ItineraryDay[]> {
  const supabase = await createClient()
  const [start, { data }] = await Promise.all([
    getTripStartDate(tripId),
    supabase
      .from("itinerary_days")
      .select(DAY_COLS)
      .eq("trip_id", tripId)
      .order("day_index", { ascending: true }),
  ])

  return withOrdinals((data ?? []).map((row) => rowToItineraryDay(row, start)))
}

export async function getTodayForTrip(
  tripId: string,
  today: string,
): Promise<ItineraryDay | null> {
  const start = await getTripStartDate(tripId)
  if (!start) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select(DAY_COLS)
    .eq("trip_id", tripId)
    .eq("day_index", dayIndexOf(today, start))
    .maybeSingle()

  return data ? rowToItineraryDay(data, start) : null
}
