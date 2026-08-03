import { createClient } from "@/lib/supabase/server"
import {
  SUGGESTION_HISTORY_LIMIT,
  type AnsweredSuggestion,
  type RoadSuggestion,
  type SuggestionOutcome,
  type SuggestionTarget,
} from "./road-suggestion-types"

interface SuggestionRow {
  id: string
  trip_id: string
  day_date: string
  title: string
  body: string
  target: string
  category: string | null
  suggested_time: string | null
  source_url: string | null
  outcome: string
}

const SUGGESTION_COLS =
  "id, trip_id, day_date, title, body, target, category, suggested_time, source_url, outcome"

function toSuggestion(row: SuggestionRow): RoadSuggestion {
  return {
    id: row.id,
    tripId: row.trip_id,
    dayDate: row.day_date,
    title: row.title,
    body: row.body,
    target: row.target as SuggestionTarget,
    category: row.category ?? "",
    suggestedTime: row.suggested_time ?? "",
    sourceUrl: row.source_url ?? "",
    outcome: row.outcome as SuggestionOutcome,
  }
}

/** Today's suggestion row, or null when it has not been generated yet. A row
 * with an empty title is a real answer — the agent had nothing — not a miss. */
export async function getSuggestionForDay(
  tripId: string,
  dayDate: string,
): Promise<RoadSuggestion | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_suggestions")
    .select(SUGGESTION_COLS)
    .eq("trip_id", tripId)
    .eq("day_date", dayDate)
    .returns<SuggestionRow[]>()
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return row ? toSuggestion(row) : null
}

/** The trip's recently answered suggestions, newest first — the history the
 * agent reads so it stops repeating itself. Auto-dismissed empty rows are
 * excluded: they record a quiet day, not a judgement. */
export async function getAnsweredSuggestions(
  tripId: string,
): Promise<AnsweredSuggestion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_suggestions")
    .select("title, outcome")
    .eq("trip_id", tripId)
    .neq("outcome", "pending")
    .neq("title", "")
    .order("day_date", { ascending: false })
    .limit(SUGGESTION_HISTORY_LIMIT)
    .returns<AnsweredSuggestion[]>()
  if (error) throw new Error(error.message)
  return data ?? []
}
