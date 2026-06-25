"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"
import { getSharedTrip } from "@/lib/trips/shared-trip-queries"

/** Mints (or reuses) a share token and marks the trip public. Returns the token
 * so the dialog can show the link immediately. `shared_at` is set only on the
 * first share. RLS gates that the caller is a workspace member of the trip. */
export async function shareTrip(
  tripId: string,
  tripSlug: string,
): Promise<{ error?: string; token?: string }> {
  const supabase = await createClient()

  const { data: existing, error: readError } = await supabase
    .from("trips")
    .select("share_token, shared_at")
    .eq("id", tripId)
    .maybeSingle()
  if (readError) return { error: readError.message }
  if (!existing) return { error: "Trip not found." }

  const token = existing.share_token ?? crypto.randomUUID().replace(/-/g, "")
  const sharedAt = existing.shared_at ?? new Date().toISOString()

  const { error } = await supabase
    .from("trips")
    .update({ is_public: true, share_token: token, shared_at: sharedAt })
    .eq("id", tripId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return { token }
}

/** Turns a trip's public link off. The token is kept, so re-sharing reuses the
 * same link. */
export async function unshareTrip(
  tripId: string,
  tripSlug: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trips")
    .update({ is_public: false })
    .eq("id", tripId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return s || "trip"
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Clones a shared trip into the caller's workspace as a new dated trip starting
 * on `startDate`. Reads the safe projection (no dates/budget/members), then
 * inserts trip + members + default categories + locations + days under the
 * caller's own RLS — no privileged write path. Days land on consecutive dates;
 * each location's span is derived from its days. Returns the new slug.
 */
export async function copySharedTrip(
  token: string,
  startDate: string,
): Promise<{ error?: string; slug?: string }> {
  if (!DATE_RE.test(startDate)) return { error: "Pick a start date." }

  const trip = await getSharedTrip(token)
  if (!trip) return { error: "This trip isn't shared." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "No workspace." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const hasDays = trip.days.length > 0
  const endDate = hasDays ? addDays(startDate, trip.days.length - 1) : startDate

  // Insert the trip row, retrying the slug on collision (mirrors createTrip).
  const base = slugify(trip.name)
  let slug = base
  let tripId: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("trips")
      .insert({
        workspace_id: workspace.id,
        slug,
        name: trip.name,
        country: trip.country,
        start_date: startDate,
        end_date: endDate,
        created_by: userId,
      })
      .select("id")
      .single()
    if (!error && data) {
      tripId = data.id
      break
    }
    if (error?.code === "23505") {
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
      continue
    }
    return { error: error?.message ?? "Could not create trip." }
  }
  if (!tripId) return { error: "Could not find a free name; try again." }

  // Members + default expense categories, exactly like createTrip.
  const { error: membersError } = await supabase.from("trip_members").insert(
    workspace.members.map((m) => ({
      trip_id: tripId,
      user_id: m.user_id,
      role: "member" as const,
    })),
  )
  if (membersError) return { error: membersError.message }

  const { error: catError } = await supabase.from("expense_categories").insert(
    EXPENSE_CATEGORIES.map((name, i) => ({
      trip_id: tripId,
      name,
      sort_order: i,
      created_by: userId,
    })),
  )
  if (catError) return { error: catError.message }

  // Locations: derive each span from the ordinals of its days. Names are the
  // only handle the projection carries, so days remap to locations by name.
  const spanByName = new Map<string, { min: number; max: number }>()
  for (const d of trip.days) {
    if (!d.locationName) continue
    const cur = spanByName.get(d.locationName)
    if (!cur) spanByName.set(d.locationName, { min: d.ordinal, max: d.ordinal })
    else {
      cur.min = Math.min(cur.min, d.ordinal)
      cur.max = Math.max(cur.max, d.ordinal)
    }
  }

  const nameToId = new Map<string, string>()
  if (trip.locations.length > 0) {
    const { data: inserted, error: locError } = await supabase
      .from("itinerary_locations")
      .insert(
        trip.locations.map((l) => {
          const span = spanByName.get(l.name)
          return {
            trip_id: tripId,
            name: l.name,
            sort_order: l.sortOrder,
            start_date: span ? addDays(startDate, span.min - 1) : null,
            end_date: span ? addDays(startDate, span.max - 1) : null,
            created_by: userId,
          }
        }),
      )
      .select("id, name")
    if (locError) return { error: locError.message }
    for (const row of inserted ?? []) nameToId.set(row.name, row.id)
  }

  if (hasDays) {
    const { error: daysError } = await supabase.from("itinerary_days").insert(
      trip.days.map((d) => ({
        trip_id: tripId,
        day_date: addDays(startDate, d.ordinal - 1),
        title: d.title,
        events: d.events,
        tag: d.tag,
        tone: d.tone,
        location_id: d.locationName ? nameToId.get(d.locationName) ?? null : null,
        created_by: userId,
      })),
    )
    if (daysError) return { error: daysError.message }
  }

  revalidatePath("/home")
  return { slug }
}
