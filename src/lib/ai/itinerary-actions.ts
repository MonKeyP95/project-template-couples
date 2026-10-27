"use server"

import {
  addItineraryDay,
  createItineraryLocation,
  renameItineraryLocation,
  saveTripProfile,
  updateItineraryDay,
} from "@/lib/trips/actions"
import type { TripProfile } from "@/lib/trips/trip-profile-types"
import { createClient } from "@/lib/supabase/server"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import {
  ITINERARY_TONES,
  dayIndexOf,
  firstDayAtOrAfter,
  planFloor,
  positionLabel,
} from "@/lib/trips/itinerary-types"
import { localToday } from "@/lib/time/local-today"
import type { ItineraryDay, ItineraryEvent } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug, type TripHeader } from "@/lib/trips/queries"
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

const MAX_DAYS = 365

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

/** The trip's length in days. An older dream that never set one takes the
 * walk's "How many days?" answer, written back to the trip. */
async function ensureDayCount(
  trip: TripHeader,
  asked: number | undefined,
): Promise<{ dayCount: number } | { error: string }> {
  if (trip.dayCount !== null) return { dayCount: trip.dayCount }
  if (asked === undefined) return { error: "How many days is this trip?" }
  if (!Number.isInteger(asked) || asked < 1 || asked > MAX_DAYS) {
    return { error: `How many days: 1 to ${MAX_DAYS}.` }
  }
  const supabase = await createClient()
  const { error } = await supabase.from("trips").update({ day_count: asked }).eq("id", trip.id)
  if (error) return { error: error.message }
  return { dayCount: asked }
}

/** The earliest day the walk may write: today's number while a dated trip is
 * running, else none. Derived on the server, never taken from the caller: a
 * wrong floor silently empties days that already happened. */
async function writeFloor(trip: TripHeader): Promise<number | null> {
  if (!trip.startDate) return null
  const floor = planFloor(await localToday(), trip.startDate, trip.endDate ?? trip.startDate)
  return floor === null ? null : dayIndexOf(floor, trip.startDate)
}

/** The location day `dayIndex` belongs to: the span that covers it, else the
 * one the walk step named, else none — a travel day. */
function locationForIndex(
  locations: ItineraryLocation[],
  dayIndex: number,
  place: string,
): string | null {
  const covering = locations.find(
    (l) =>
      l.startIndex !== null &&
      l.endIndex !== null &&
      l.startIndex <= dayIndex &&
      dayIndex <= l.endIndex,
  )
  if (covering) return covering.id
  const key = place.trim().toLowerCase()
  const named = key
    ? locations.find((l) => l.name.trim().toLowerCase() === key)
    : undefined
  return named?.id ?? null
}

/** The trip's own answers, as one line for the planner. */
function prefsLine(profile: TripProfile): string {
  return [
    ["sleeping", profile.stay],
    ["getting around", profile.move],
    ["doing", profile.acts],
    ["eating", profile.food],
  ]
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v.trim()}`)
    .join("; ")
}

interface ApplyItineraryInput {
  tripId: string
  tripSlug: string
  skeleton: ItinerarySkeleton
}

/**
 * Write an edited skeleton onto the trip's itinerary, additively: reuse a
 * same-named location or create it, then add each day under it. A day number
 * that already has a day is skipped (never overwritten).
 */
async function applyItinerarySkeleton(
  input: ApplyItineraryInput,
): Promise<{ error?: string; created?: { locations: number; days: number } }> {
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
        dayIndex: day.dayIndex,
        title: day.title,
        sub: "",
        events: day.events.map((e) => ({ text: e.text, time: e.time, category: e.category })),
        tag: day.tag,
        tone: day.tone,
        locationId,
      })
      // Additive: skip an already-taken day; surface any other error.
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
 * deletes that event, and a row on a day number with no day yet creates one.
 * Days are never deleted, only emptied. No scaffold is built: every row already
 * carries a real day.
 */
async function applyPlanEdits(
  input: { tripId: string; tripSlug: string; places: string[]; entries: PlanEntry[] },
  days: ItineraryDay[],
  locations: ItineraryLocation[],
  tripName: string,
  /** Earliest writable day; days before it already happened and are never touched. */
  floor: number | null,
): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const originals = new Map<string, ItineraryEvent>()
  const dayById = new Map(days.map((d) => [d.id, d] as const))
  for (const day of days) {
    day.events.forEach((e, i) => originals.set(`${day.id}#${i}`, e))
  }

  /** Where an unplaced new row lands: its place's first day at or after the
   * floor, else the trip's. Never a day the rewrite loop will skip, which
   * would drop the row silently. */
  function fallbackDay(place: string): number | undefined {
    const key = place.trim().toLowerCase()
    const loc = key
      ? locations.find((l) => l.name.trim().toLowerCase() === key)
      : undefined
    return (
      (loc ? firstDayAtOrAfter(days, floor, loc.id) : undefined) ??
      firstDayAtOrAfter(days, floor)
    )
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
        loc.startIndex,
        loc.endIndex,
        // Name-only rename: keep whatever currency the location already had.
        loc.currency,
      )
      if (res.error) return { error: res.error }
    }
  }

  // Every row as an event on its day, keeping its original's extras when it has one.
  const byIndex = new Map<number, ItineraryEvent[]>()
  const placeByIndex = new Map<number, string>()
  for (const entry of input.entries) {
    const original = entry.serverId ? originals.get(entry.serverId) : undefined
    const fromDay = entry.serverId
      ? dayById.get(entry.serverId.split("#")[0])
      : undefined
    const dayIndex = entry.day ?? fromDay?.dayIndex ?? fallbackDay(entry.place)
    if (!dayIndex) continue
    const text = entry.subject.trim() || entry.category
    const event: ItineraryEvent = original
      ? { ...original, text, category: entry.category }
      : { text, time: "", category: entry.category }
    const list = byIndex.get(dayIndex) ?? []
    list.push(event)
    byIndex.set(dayIndex, list)
    if (!placeByIndex.has(dayIndex)) placeByIndex.set(dayIndex, entry.place)
  }

  // Existing days: rewrite the event list to what the walk holds for that day.
  for (const day of days) {
    // A day before the floor is part of the trip that already happened: never
    // written, and dropped from `byIndex` so the leftover loop cannot recreate it.
    if (floor !== null && day.dayIndex < floor) {
      byIndex.delete(day.dayIndex)
      continue
    }
    const next = byIndex.get(day.dayIndex) ?? []
    byIndex.delete(day.dayIndex)
    if (JSON.stringify(next) === JSON.stringify(day.events)) continue
    const res = await updateItineraryDay({
      dayId: day.id,
      tripSlug: input.tripSlug,
      dayIndex: day.dayIndex,
      title: day.title,
      sub: day.sub,
      events: next,
      tag: day.tag,
      tone: day.tone,
      locationId: day.locationId,
    })
    if (res.error) return { error: res.error }
  }

  // Whatever is left sits on a day number the trip has no day for yet.
  let added = 0
  for (const [dayIndex, events] of byIndex) {
    // A row can carry a user-picked past day with no day behind it; creating
    // one would put a brand-new day behind the floor.
    if (floor !== null && dayIndex < floor) continue
    const locationId = locationForIndex(locations, dayIndex, placeByIndex.get(dayIndex) ?? "")
    const name = locations.find((l) => l.id === locationId)?.name ?? tripName
    const res = await addItineraryDay({
      tripId: input.tripId,
      tripSlug: input.tripSlug,
      dayIndex,
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
 * entered, on the days they picked. On a trip with no itinerary this scaffolds
 * one from the places; on a trip that already has one it patches the days that
 * are there (see applyPlanEdits). Works the same with or without dates.
 */
export async function applyPlanEntries(input: {
  tripId: string
  tripSlug: string
  places: string[]
  entries: PlanEntry[]
  /** Edited in the walk's avoid step; written back to the trip profile. */
  avoid?: string
  /** The walk's "How many days?" answer, for a trip with no length yet. */
  dayCount?: number
}): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip) return { error: "Trip not found." }

  await persistAvoid(trip, input.tripSlug, input.avoid)
  const length = await ensureDayCount(trip, input.dayCount)
  if ("error" in length) return length

  const existingDays = await getItineraryDays(input.tripId)
  if (existingDays.length > 0) {
    const locations = await getItineraryLocations(input.tripId)
    return await applyPlanEdits(input, existingDays, locations, trip.name, await writeFloor(trip))
  }

  const skeleton = entriesToSkeleton(
    input.entries,
    input.places.map((n) => n.trim()).filter((n) => n.length > 0),
    trip.name,
    length.dayCount,
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
 * it (reusing applyItinerarySkeleton). The model works in day numbers; a dated
 * trip's start goes along as context. Pressing Generate is the human's
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
  /** The walk's "How many days?" answer, for a trip with no length yet. */
  dayCount?: number
}): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip) return { error: "Trip not found." }

  await persistAvoid(trip, input.tripSlug, input.avoid)
  const length = await ensureDayCount(trip, input.dayCount)
  if ("error" in length) return length
  const dayCount = length.dayCount
  const names = input.places.map((n) => n.trim()).filter((n) => n.length > 0)
  const label = (i: number) => positionLabel(i, trip.startDate)

  try {
    // Scaffold only to learn each place's days for grounding.
    const scaffold = planItinerarySkeleton({
      destination: trip.name,
      dayCount,
      placeNames: names,
    })
    const locations = scaffold.places
      .filter((p) => p.days.length > 0)
      .map((p) => {
        const first = p.days[0].dayIndex
        const last = p.days[p.days.length - 1].dayIndex
        return {
          name: p.name,
          first,
          last,
          label: first === last ? label(first) : `${label(first)} to ${label(last)}`,
        }
      })

    const { profileBlock, tasteDirective } = await buildAssistantContext(workspace.id, trip.id)

    const { events, question } = await draftItinerary({
      destination: trip.country ?? trip.name,
      startDate: trip.startDate,
      dayCount,
      locations,
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.idea,
      prefs: prefsLine(trip.tripProfile),
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
    if (events.length === 0 && question) return { error: question }

    const items: DraftItem[] = events.map((e) => ({
      category: e.category,
      place: e.place,
      text: e.text,
      day: e.day,
      time: e.time,
    }))
    const skeleton = itemsToSkeleton(items, names, trip.name, dayCount)
    return await applyItinerarySkeleton({
      tripId: input.tripId,
      tripSlug: input.tripSlug,
      skeleton,
    })
  } catch {
    return { error: "Couldn't draft right now — try again." }
  }
}
