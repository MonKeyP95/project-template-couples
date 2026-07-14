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
import { draftItinerary } from "@/lib/ai/claude"
import {
  planItinerarySkeleton,
  type ItinerarySkeleton,
  type DraftItem,
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

/** Sparse, grounded AI draft as flat items for the stepper. Builds the scaffold
 * only to hand the AI each place's real date ranges to ground on; returns the
 * AI's events as flat DraftItems, or a single clarifying question, or nothing.
 * AI off / failure -> empty items, drafted:false. Never throws. Suggest-only. */
export async function draftItineraryItems(input: {
  tripSlug: string
  dayCount: number
  placeNames: string[]
  freeText: string
}): Promise<{ items: DraftItem[]; drafted: boolean; question: string }> {
  const workspace = await getCurrentWorkspace()
  const trip = workspace ? await getTripBySlug(workspace.id, input.tripSlug) : null
  if (!workspace || !trip || !trip.startDate) return { items: [], drafted: false, question: "" }
  if (!(await isAiEnabled())) return { items: [], drafted: false, question: "" }

  const destination = trip.country ?? trip.name
  const names = input.placeNames.map((n) => n.trim()).filter((n) => n.length > 0)

  try {
    const scaffold = planItinerarySkeleton({
      destination,
      startDate: trip.startDate,
      dayCount: input.dayCount,
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

    const { events, question } = await draftItinerary({
      destination,
      startDate: trip.startDate,
      dayCount: input.dayCount,
      locations,
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.idea,
      activityTypes: [],
      freeText: input.freeText,
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
    return { items, drafted: items.length > 0, question }
  } catch {
    return { items: [], drafted: false, question: "" }
  }
}
