import { createClient } from "@/lib/supabase/server"
import { parseEvents } from "@/lib/trips/itinerary-types"
import { ACTIVITIES, detectActivities, type Activity } from "./activity"

interface DayRow {
  title: string | null
  sub: string | null
  events: unknown
}

/**
 * Every activity, the couple's most usual first: ranked by how many itinerary
 * days across all their trips name it. Ties (and no history) keep the
 * `ACTIVITIES` order, so surf leads.
 */
export async function getUsualActivities(workspaceId: string): Promise<Activity[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("itinerary_days")
    .select("title, sub, events, trips!inner(workspace_id)")
    .eq("trips.workspace_id", workspaceId)
    .returns<DayRow[]>()
  if (error) throw new Error(error.message)
  return rankActivities(data ?? [])
}

/** Pure ranking half of `getUsualActivities`. */
export function rankActivities(rows: DayRow[]): Activity[] {
  const counts = new Map<Activity, number>(ACTIVITIES.map((a) => [a, 0]))
  for (const row of rows) {
    const text = [row.title, row.sub, ...parseEvents(row.events).map((e) => e.text)].join(" ")
    for (const a of detectActivities(text)) counts.set(a, counts.get(a)! + 1)
  }
  return [...ACTIVITIES].sort((a, b) => counts.get(b)! - counts.get(a)!)
}
