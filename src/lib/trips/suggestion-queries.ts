import { createClient } from "@/lib/supabase/server"

import {
  rowToSuggestion,
  type TripSuggestion,
  type TripSuggestionRow,
} from "./suggestion-types"

/** The trip's waiting suggestions, oldest first. */
export async function getTripSuggestions(tripId: string): Promise<TripSuggestion[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_suggestions")
    .select("id, kind, category, title, location_id, day_index, why, options")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true })
    .returns<TripSuggestionRow[]>()
  return (data ?? []).map(rowToSuggestion)
}
