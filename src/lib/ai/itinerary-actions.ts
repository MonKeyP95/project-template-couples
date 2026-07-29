"use server"

import {
  addItineraryDay,
  createItineraryLocation,
  renameItineraryLocation,
  saveTripProfile,
  updateItineraryDay,
} from "@/lib/trips/actions"
import type { TripProfile } from "@/lib/trips/trip-profile-types"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import { ITINERARY_TONES } from "@/lib/trips/itinerary-types"
import type { ItineraryDay, ItineraryEvent } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { draftItinerary } from "@/lib/ai/claude"
import {
  planItinerarySkeleton,
  itemsToSkeleton,
  entriesToSkeleton,
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

/** Persist an avoid answer edited mid-walk. The planner box is the trip
 * profile's field, not a copy, so both terminal actions write it back. */
async function persistAvoid(
  trip: { id: string; tripProfile: TripProfile },
  tripSlug: string,
  avoid: string | undefined,
): Promise<void> {
  if (avoid === undefined) return
  const next = avoid.trim().slice(0, 500)
  if (next === trip.tripProfile.avoid) return
  await saveTripProfile({
    tripId: trip.id,
    tripSlug,
    profile: { ...trip.tripProfile, avoid: next },
  })
}

/** The location a day on `date` belongs to: the span that covers it, else the
 * one the walk step named, else none — a travel day. */
function locationForDate(
  locations: ItineraryLocation[],
  date: string,
  place: string,
): string | null {
  const covering = locations.find(
    (l) => l.startDate && l.endDate && l.startDate <= date && date <= l.endDate,
  )
  if (covering) return covering.id
  const key = place.trim().toLowerCase()
  const named = key
    ? locations.find((l) => l.name.trim().toLowerCase() === key)
    : undefined
  return named?.id ?? null
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
 * The edit path, taken once a trip has an itinerary: the walk owns every event,
 * so applying writes its state back. A row read off an existing event patches it
 * in place — time, url, rating and note are carried over — a row that is gone
 * deletes that event, and a row on a date with no day yet creates one. Days are
 * never deleted, only emptied. No scaffold is built: every row already carries a
 * real date.
 */
async function applyPlanEdits(
  input: { tripId: string; tripSlug: string; places: string[]; entries: PlanEntry[] },
  days: ItineraryDay[],
  locations: ItineraryLocation[],
  tripName: string,
): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const originals = new Map<string, ItineraryEvent>()
  const dayById = new Map(days.map((d) => [d.id, d] as const))
  const firstDateByLocation = new Map<string, string>()
  for (const day of days) {
    day.events.forEach((e, i) => originals.set(`${day.id}#${i}`, e))
    if (day.locationId && !firstDateByLocation.has(day.locationId)) {
      firstDateByLocation.set(day.locationId, day.dayDate)
    }
  }

  /** Where an undated new row lands: its place's first day, else the trip's. */
  function fallbackDate(place: string): string | undefined {
    const key = place.trim().toLowerCase()
    const loc = key
      ? locations.find((l) => l.name.trim().toLowerCase() === key)
      : undefined
    return (loc && firstDateByLocation.get(loc.id)) ?? days[0]?.dayDate
  }

  // Positional rename, only while the walk still holds as many places as the
  // trip has locations — an added or removed row makes positions meaningless.
  if (input.places.length === locations.length) {
    for (const [i, loc] of locations.entries()) {
      const name = input.places[i].trim()
      if (!name || name === loc.name) continue
      const res = await renameItineraryLocation(
        loc.id,
        input.tripId,
        input.tripSlug,
        name,
        loc.startDate,
        loc.endDate,
      )
      if (res.error) return { error: res.error }
    }
  }

  // Every row as a dated event, keeping its original's extras when it has one.
  const byDate = new Map<string, ItineraryEvent[]>()
  const placeByDate = new Map<string, string>()
  for (const entry of input.entries) {
    const original = entry.serverId ? originals.get(entry.serverId) : undefined
    const fromDay = entry.serverId
      ? dayById.get(entry.serverId.split("#")[0])
      : undefined
    const date = entry.date ?? fromDay?.dayDate ?? fallbackDate(entry.place)
    if (!date) continue
    const text = entry.subject.trim() || entry.category
    const event: ItineraryEvent = original
      ? { ...original, text, category: entry.category }
      : { text, time: "", category: entry.category }
    const list = byDate.get(date) ?? []
    list.push(event)
    byDate.set(date, list)
    if (!placeByDate.has(date)) placeByDate.set(date, entry.place)
  }

  // Existing days: rewrite the event list to what the walk holds for that date.
  for (const day of days) {
    const next = byDate.get(day.dayDate) ?? []
    byDate.delete(day.dayDate)
    if (JSON.stringify(next) === JSON.stringify(day.events)) continue
    const res = await updateItineraryDay({
      dayId: day.id,
      tripSlug: input.tripSlug,
      dayDate: day.dayDate,
      title: day.title,
      sub: day.sub,
      events: next,
      tag: day.tag,
      tone: day.tone,
      locationId: day.locationId,
    })
    if (res.error) return { error: res.error }
  }

  // Whatever is left sits on a date the trip has no day for yet.
  let added = 0
  for (const [date, events] of byDate) {
    const locationId = locationForDate(locations, date, placeByDate.get(date) ?? "")
    const name = locations.find((l) => l.id === locationId)?.name ?? tripName
    const res = await addItineraryDay({
      tripId: input.tripId,
      tripSlug: input.tripSlug,
      dayDate: date,
      title: name,
      sub: "",
      events,
      tag: name,
      tone: ITINERARY_TONES[(days.length + added) % ITINERARY_TONES.length],
      locationId,
    })
    if (res.error) return { error: res.error }
    added++
  }

  return { created: { locations: 0, days: added } }
}

/**
 * The guided walk's no-AI terminal action: write exactly what the couple
 * entered, on the dates they picked. On a trip with no itinerary this scaffolds
 * one from the places; on a trip that already has one it patches the days that
 * are there (see applyPlanEdits).
 */
export async function applyPlanEntries(input: {
  tripId: string
  tripSlug: string
  places: string[]
  entries: PlanEntry[]
  /** Edited in the walk's avoid step; written back to the trip profile. */
  avoid?: string
}): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip || !trip.startDate) return { error: "Trip not found." }

  await persistAvoid(trip, input.tripSlug, input.avoid)

  const existingDays = await getItineraryDays(input.tripId)
  if (existingDays.length > 0) {
    const locations = await getItineraryLocations(input.tripId)
    return await applyPlanEdits(input, existingDays, locations, trip.name)
  }

  const skeleton = entriesToSkeleton(
    input.entries,
    input.places.map((n) => n.trim()).filter((n) => n.length > 0),
    trip.name,
    trip.startDate,
    inclusiveDays(trip.startDate, trip.endDate ?? trip.startDate),
  )
  return await applyItinerarySkeleton({
    tripId: input.tripId,
    tripSlug: input.tripSlug,
    skeleton,
  })
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
  /** Free-text intent for the whole trip; goes to the drafter as-is. */
  freeText?: string
  /** Edited in the walk's avoid step; written back to the trip profile. */
  avoid?: string
}): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip || !trip.startDate) return { error: "Trip not found." }

  await persistAvoid(trip, input.tripSlug, input.avoid)

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
      freeText: input.freeText?.trim() ?? "",
      avoid: input.avoid?.trim() ?? trip.tripProfile.avoid,
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
