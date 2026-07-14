"use server"

import {
  addItineraryDay,
  createItineraryLocation,
} from "@/lib/trips/actions"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { draftItinerary, type DraftedItineraryEvent } from "@/lib/ai/claude"
import {
  planItinerarySkeleton,
  type ItinerarySkeleton,
} from "@/lib/ai/itinerary-planner"

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

/** Overlay Claude's events onto the deterministic scaffold: match each event to
 * its place by name and its day by date (both required), then append it to
 * that day's events. Drop events with no match. */
function mergeEvents(
  skeleton: ItinerarySkeleton,
  events: DraftedItineraryEvent[],
): ItinerarySkeleton {
  const places = skeleton.places.map((place) => ({
    ...place,
    days: place.days.map((day) => ({ ...day, events: [...day.events] })),
  }))

  for (const event of events) {
    const place = places.find(
      (p) => p.name.trim().toLowerCase() === event.place.trim().toLowerCase(),
    )
    const day = place?.days.find((d) => d.date === event.date)
    if (!place || !day) continue
    day.events.push({ text: event.text, time: event.time, category: event.category })
  }

  return { places }
}

/** Build the deterministic itinerary scaffold, then overlay a real Claude
 * draft. On any failure (or AI mode off) returns the scaffold unchanged with
 * drafted:false. Never throws: the caller always gets a skeleton back.
 * Suggest-only: reads context, writes nothing. */
export async function draftItineraryForTrip(input: {
  tripSlug: string
  dayCount: number
  placeNames: string[]
  activityTypes: string[]
  freeText: string
}): Promise<{ skeleton: ItinerarySkeleton; drafted: boolean }> {
  const workspace = await getCurrentWorkspace()
  const trip = workspace ? await getTripBySlug(workspace.id, input.tripSlug) : null

  const destination = trip?.country ?? trip?.name ?? input.placeNames[0] ?? "Trip"
  const startDate = trip?.startDate ?? null
  if (!startDate) {
    const scaffold = planItinerarySkeleton({
      destination,
      startDate: new Date().toISOString().slice(0, 10),
      dayCount: input.dayCount,
      placeNames: input.placeNames,
    })
    return { skeleton: scaffold, drafted: false }
  }

  const scaffold = planItinerarySkeleton({
    destination,
    startDate,
    dayCount: input.dayCount,
    placeNames: input.placeNames,
  })

  if (!workspace || !trip) return { skeleton: scaffold, drafted: false }
  if (!(await isAiEnabled())) return { skeleton: scaffold, drafted: false }

  try {
    // Tell the AI about the scaffold's own places + their date ranges (what the
    // user typed), so its proposed place names and dates line up with the
    // scaffold that mergeEvents matches against.
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

    const { profileBlock, tasteDirective } = await buildAssistantContext(
      workspace.id,
      trip.id,
    )

    const events = await draftItinerary({
      destination,
      startDate,
      dayCount: input.dayCount,
      locations,
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.idea,
      activityTypes: input.activityTypes,
      freeText: input.freeText,
      profileBlock,
      tasteDirective,
    })

    if (events.length === 0) return { skeleton: scaffold, drafted: false }
    return { skeleton: mergeEvents(scaffold, events), drafted: true }
  } catch {
    return { skeleton: scaffold, drafted: false }
  }
}
