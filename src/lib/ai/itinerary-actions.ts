"use server"

import {
  addItineraryDay,
  createItineraryLocation,
} from "@/lib/trips/actions"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { draftItinerary } from "@/lib/ai/claude"
import {
  planItinerarySkeleton,
  itemsToSkeleton,
  type ItinerarySkeleton,
  type DraftItem,
  type PlanEntry,
} from "@/lib/ai/itinerary-planner"

/** Inclusive day count between two YYYY-MM-DD dates (UTC, no tz drift). */
function inclusiveDays(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime()
  const e = new Date(`${end}T00:00:00Z`).getTime()
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1)
}

export interface ApplyItineraryInput {
  tripId: string
  tripSlug: string
  skeleton: ItinerarySkeleton
}

/**
 * Write an edited skeleton onto the trip's itinerary, additively: reuse a
 * same-named location or create it, then add each day under it. A date that
 * already has a day is skipped (never overwritten).
 */
export async function applyItinerarySkeleton(
  input: ApplyItineraryInput,
): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip) return { error: "Trip not found." }

  const existing = await getItineraryLocations(input.tripId)
  const byName = new Map(existing.map((l) => [l.name.trim().toLowerCase(), l.id]))

  let locations = 0
  let days = 0
  for (const place of input.skeleton.places) {
    if (place.days.length === 0) continue
    const key = place.name.trim().toLowerCase()
    let locationId = byName.get(key) ?? null
    if (!locationId) {
      const res = await createItineraryLocation(input.tripId, input.tripSlug, place.name)
      if (res.error || !res.location) return { error: res.error ?? "Could not create a place." }
      locationId = res.location.id
      byName.set(key, locationId)
      locations++
    }
    for (const day of place.days) {
      const res = await addItineraryDay({
        tripId: input.tripId,
        tripSlug: input.tripSlug,
        dayDate: day.date,
        title: day.title,
        sub: "",
        events: day.events.map((e) => ({ text: e.text, time: e.time, category: e.category })),
        tag: day.tag,
        tone: day.tone,
        locationId,
      })
      // Additive: skip an already-taken date; surface any other error.
      if (res.error) {
        if (res.dateTaken) continue
        return { error: res.error }
      }
      days++
    }
  }
  return { created: { locations, days } }
}

/**
 * The guided walk's terminal action: draft a day-by-day itinerary from the
 * places + the couple's entered plans + their trip/couple profile, then write
 * it (reusing applyItinerarySkeleton). Pressing Generate is the human's
 * explicit approval, so it always calls the model regardless of the global
 * assistant toggle. Never throws.
 */
export async function draftAndApplyItinerary(input: {
  tripId: string
  tripSlug: string
  places: string[]
  entries: PlanEntry[]
}): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip || !trip.startDate) return { error: "Trip not found." }

  const startDate = trip.startDate
  const dayCount = inclusiveDays(startDate, trip.endDate ?? startDate)
  const names = input.places.map((n) => n.trim()).filter((n) => n.length > 0)

  try {
    // Scaffold only to learn each place's real date range for grounding.
    const scaffold = planItinerarySkeleton({
      destination: trip.name,
      startDate,
      dayCount,
      placeNames: names,
    })
    const locations = scaffold.places.map((p) => {
      const dates = p.days.map((d) => d.date)
      const first = dates[0]
      const last = dates[dates.length - 1]
      return {
        name: p.name,
        nights: p.days.length,
        dateLabel: first ? (first === last ? first : `${first} to ${last}`) : null,
      }
    })

    const { profileBlock, tasteDirective } = await buildAssistantContext(workspace.id, trip.id)

    const { events } = await draftItinerary({
      destination: trip.country ?? trip.name,
      startDate,
      dayCount,
      locations,
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.idea,
      activityTypes: [],
      freeText: "",
      knownPlans: input.entries.map((e) => ({
        category: e.category,
        place: e.place,
        subject: e.subject,
        when: e.when,
      })),
      profileBlock,
      tasteDirective,
    })

    const items: DraftItem[] = events.map((e) => ({
      category: e.category,
      place: e.place,
      text: e.text,
      date: e.date,
      time: e.time,
    }))
    const skeleton = itemsToSkeleton(items, names, trip.name, startDate, dayCount)
    return await applyItinerarySkeleton({
      tripId: input.tripId,
      tripSlug: input.tripSlug,
      skeleton,
    })
  } catch {
    return { error: "Couldn't draft right now — try again." }
  }
}
