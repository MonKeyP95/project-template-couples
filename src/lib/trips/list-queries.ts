import { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time/local-today"

export type TripState = "now" | "upcoming" | "past" | "dream"

export interface TripListItem {
  id: string
  slug: string
  name: string
  country: string | null
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  lat: number | null
  lng: number | null
  plannedBudgetCents: number
  savedCents: number
  state: TripState
}

export interface TripBuckets {
  /** start_date <= today <= end_date, sorted by start_date asc. */
  now: TripListItem[]
  /** today < start_date, sorted by start_date asc. */
  upcoming: TripListItem[]
  /** today > end_date, sorted by end_date desc (most recent first). */
  past: TripListItem[]
  /** start_date is null, sorted by created_at asc. */
  dreams: TripListItem[]
}

interface TripRow {
  id: string
  slug: string
  name: string
  country: string | null
  start_date: string | null
  end_date: string | null
  fuzzy_when: string | null
  lat: string | number | null
  lng: string | number | null
  planned_budget_cents: number
  created_at: string
}

function asNumber(v: string | number | null): number | null {
  return v == null ? null : Number(v)
}

/**
 * Pure: derive a trip's state from today + its dates.
 * `today` is an ISO yyyy-mm-dd string. Lexicographic string comparison
 * matches date order, so no Date round-trip needed.
 */
export function deriveState(
  today: string,
  startDate: string | null,
  endDate: string | null,
): TripState {
  if (!startDate || !endDate) return "dream"
  if (today < startDate) return "upcoming"
  if (today > endDate) return "past"
  return "now"
}

/**
 * Returns every trip the caller can see in this workspace, bucketed by state.
 * One round-trip; bucketing happens in JS (bucket sizes are tiny in practice).
 */
export async function listTripsForWorkspace(
  workspaceId: string,
): Promise<TripBuckets> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select(
      "id, slug, name, country, start_date, end_date, fuzzy_when, lat, lng, planned_budget_cents, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .returns<TripRow[]>()

  const rows = data ?? []
  const today = await localToday()

  const tripIds = rows.map((r) => r.id)
  const savedByTrip: Record<string, number> = {}
  if (tripIds.length > 0) {
    const { data: contribRows } = await supabase
      .from("trip_savings_contributions")
      .select("trip_id, amount_cents")
      .in("trip_id", tripIds)
    for (const c of contribRows ?? []) {
      savedByTrip[c.trip_id] = (savedByTrip[c.trip_id] ?? 0) + c.amount_cents
    }
  }

  const items: TripListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    country: row.country,
    startDate: row.start_date,
    endDate: row.end_date,
    fuzzyWhen: row.fuzzy_when,
    lat: asNumber(row.lat),
    lng: asNumber(row.lng),
    plannedBudgetCents: row.planned_budget_cents,
    savedCents: savedByTrip[row.id] ?? 0,
    state: deriveState(today, row.start_date, row.end_date),
  }))

  const buckets: TripBuckets = { now: [], upcoming: [], past: [], dreams: [] }
  for (const item of items) {
    if (item.state === "now") buckets.now.push(item)
    else if (item.state === "upcoming") buckets.upcoming.push(item)
    else if (item.state === "past") buckets.past.push(item)
    else buckets.dreams.push(item)
  }

  buckets.now.sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
  buckets.upcoming.sort((a, b) =>
    (a.startDate ?? "").localeCompare(b.startDate ?? ""),
  )
  buckets.past.sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))
  // dreams already in created_at asc from the query

  return buckets
}
