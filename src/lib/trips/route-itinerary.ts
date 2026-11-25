import "server-only"

import { createClient } from "@/lib/supabase/server"
import {
  addItineraryDay,
  createItineraryLocation,
  renameItineraryLocation,
} from "@/lib/trips/actions"
import { placeActivities, routeSpans, type RouteStop } from "@/lib/trips/idea-route"
import { ITINERARY_TONES } from "@/lib/trips/itinerary-types"

/** The rough itinerary of a trip made from an accepted home idea, written on
 * the fresh trip: one location per stop with its day span, a "Travel to X"
 * first day where the route has one, and each activity as a suggestion on a
 * free day of its stop (else the box). No AI call; nothing becomes an event. */
export async function buildRouteItinerary(
  tripId: string,
  tripSlug: string,
  stops: RouteStop[],
): Promise<{ error?: string }> {
  const locationIds: string[] = []
  for (const [i, span] of routeSpans(stops).entries()) {
    const created = await createItineraryLocation(tripId, tripSlug, span.name)
    if (created.error || !created.location) return { error: created.error ?? "Could not create a place." }
    const id = created.location.id
    locationIds.push(id)

    const spanned = await renameItineraryLocation(id, tripId, tripSlug, span.name, span.start, span.end, null)
    if (spanned.error) return { error: spanned.error }

    if (span.travelDay) {
      const day = await addItineraryDay({
        tripId,
        tripSlug,
        dayIndex: span.start,
        title: `Travel to ${span.name}`,
        sub: "",
        events: [],
        tag: span.name,
        tone: ITINERARY_TONES[i % ITINERARY_TONES.length],
        locationId: id,
      })
      if (day.error) return { error: day.error }
    }
  }

  const rows = placeActivities(stops).map((a) => ({
    trip_id: tripId,
    kind: a.kind,
    category: a.kind === "big" ? "Activities" : "Food",
    title: a.title,
    why: "",
    day_index: a.dayIndex,
    location_id: locationIds[a.stopIndex],
  }))
  if (rows.length === 0) return {}
  const supabase = await createClient()
  const { error } = await supabase.from("trip_suggestions").insert(rows)
  return error ? { error: error.message } : {}
}
