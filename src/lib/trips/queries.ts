import { createClient } from "@/lib/supabase/server"
import { parseTripProfile, type TripProfile } from "./trip-profile-types"

export interface TripHeader {
  id: string
  workspaceId: string
  slug: string
  name: string
  country: string | null
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  lat: number | null
  lng: number | null
  /** Planned budget goal in cents (0 = unset). */
  plannedBudgetCents: number
  /** Per-trip structured profile (slice 1). */
  tripProfile: TripProfile
  /** 1-based position within the workspace's trip list, ordered by start_date. */
  index: number
  /** Total number of trips in the workspace. */
  total: number
}

interface TripRow {
  id: string
  workspace_id: string
  slug: string
  name: string
  country: string | null
  start_date: string | null
  end_date: string | null
  fuzzy_when: string | null
  lat: string | number | null
  lng: string | number | null
  planned_budget_cents: number
  trip_profile: unknown
}

function asNumber(v: string | number | null): number | null {
  return v == null ? null : Number(v)
}

export async function getTripBySlug(
  workspaceId: string,
  slug: string,
): Promise<TripHeader | null> {
  const supabase = await createClient()

  const tripQuery = supabase
    .from("trips")
    .select(
      "id, workspace_id, slug, name, country, start_date, end_date, fuzzy_when, lat, lng, planned_budget_cents, trip_profile",
    )
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .maybeSingle<TripRow>()

  const orderQuery = supabase
    .from("trips")
    .select("slug, start_date")
    .eq("workspace_id", workspaceId)
    .order("start_date", { ascending: true, nullsFirst: false })

  const [{ data: trip }, { data: orderedTrips }] = await Promise.all([
    tripQuery,
    orderQuery,
  ])

  if (!trip) return null

  const total = orderedTrips?.length ?? 0
  const position = orderedTrips?.findIndex((t) => t.slug === trip.slug) ?? -1
  const index = position >= 0 ? position + 1 : 0

  return {
    id: trip.id,
    workspaceId: trip.workspace_id,
    slug: trip.slug,
    name: trip.name,
    country: trip.country,
    startDate: trip.start_date,
    endDate: trip.end_date,
    fuzzyWhen: trip.fuzzy_when,
    lat: asNumber(trip.lat),
    lng: asNumber(trip.lng),
    plannedBudgetCents: trip.planned_budget_cents,
    tripProfile: parseTripProfile(trip.trip_profile),
    index,
    total,
  }
}

/** The trip's profile (headline/vibe/who/brief) by id, RLS-scoped. Returns an
 * empty profile when the trip is missing or unreadable. Used by the discovery
 * route, which knows the trip id but not the slug. */
export async function getTripProfile(tripId: string): Promise<TripProfile> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select("trip_profile")
    .eq("id", tripId)
    .maybeSingle()
  return parseTripProfile(data?.trip_profile)
}
