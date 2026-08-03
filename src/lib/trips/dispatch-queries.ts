import { createClient } from "@/lib/supabase/server"
import type { DispatchItem, TripDispatch } from "./dispatch-types"

interface TripDispatchRow {
  id: string
  trip_id: string
  day_date: string
  items: DispatchItem[]
  generated_at: string
}

const DISPATCH_COLS = "id, trip_id, day_date, items, generated_at"

/** Today's dispatch for a trip, or null when it has not been generated yet.
 * A row with zero items is a real answer, not a miss. */
export async function getDispatchForDay(
  tripId: string,
  dayDate: string,
): Promise<TripDispatch | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_dispatch")
    .select(DISPATCH_COLS)
    .eq("trip_id", tripId)
    .eq("day_date", dayDate)
    .returns<TripDispatchRow[]>()
  if (error) throw new Error(error.message)
  const row = data?.[0]
  if (!row) return null
  return {
    id: row.id,
    tripId: row.trip_id,
    dayDate: row.day_date,
    items: row.items ?? [],
    generatedAt: row.generated_at,
  }
}
