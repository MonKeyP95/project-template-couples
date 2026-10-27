import {
  ITINERARY_TONES,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

export const ITINERARY_CATEGORIES = [
  "Accommodation",
  "Transportation",
  "Activities",
  "Food",
  "Other",
] as const

export interface SkeletonEvent {
  text: string
  time: string
  /** One of ITINERARY_CATEGORIES; optional so a blank draft event stays valid. */
  category?: string
}
export interface SkeletonDay {
  /** 1-based day number in the trip. */
  dayIndex: number
  title: string
  tag: string
  tone: ItineraryTone
  events: SkeletonEvent[]
}
export interface SkeletonPlace {
  name: string
  days: SkeletonDay[]
}
export interface ItinerarySkeleton {
  places: SkeletonPlace[]
}

export interface ItineraryPlanInput {
  destination: string
  /** Inclusive day count across the whole trip. */
  dayCount: number
  /** Ordered place names; empty => one place named after the destination. */
  placeNames: string[]
}

/**
 * Deterministic first draft: split the trip's days evenly across the places
 * (earlier places take the remainder), number them from Day 1, cycle tones,
 * and leave events empty for the user (or the AI) to fill.
 */
export function planItinerarySkeleton(input: ItineraryPlanInput): ItinerarySkeleton {
  const dayCount = Math.max(1, input.dayCount)
  const names =
    input.placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const places = names.length > 0 ? names : [input.destination.trim() || "Trip"]

  // Even split, remainder to the earlier places.
  const base = Math.floor(dayCount / places.length)
  const extra = dayCount % places.length

  const out: SkeletonPlace[] = []
  let offset = 0
  places.forEach((name, pi) => {
    const count = base + (pi < extra ? 1 : 0)
    const days: SkeletonDay[] = []
    for (let i = 0; i < count; i++) {
      days.push({
        dayIndex: offset + 1,
        title: name,
        tag: name,
        tone: ITINERARY_TONES[offset % ITINERARY_TONES.length],
        events: [],
      })
      offset++
    }
    out.push({ name, days })
  })
  return { places: out }
}

/** One thing the couple entered in the guided walk: a category + place + a
 * free-text subject and an optional "when" (dates or number of nights). These
 * are the facts the assistant drafts the itinerary from. Client-safe. */
export interface PlanEntry {
  category: string
  /** Place name, or "" for a trip-wide entry (transport, other). */
  place: string
  subject: string
  when: string
  /** Day number the couple picked, 1-based. Drives the no-AI apply. */
  day?: number
  /** Last day of a range they picked. */
  endDay?: number
  /** `${dayId}#${eventIndex}` when this row was read back from an existing
   * event. The handle that makes a save patch that event instead of adding a
   * second copy of it. */
  serverId?: string
}

/** One step of the guided itinerary walk. Mirrors budget's BudgetStep: per-place
 * Accommodation/Food/Activities, then trip-wide Transportation/Other. */
export interface ItineraryPlanStep {
  /** `${categoryKey}:${placeIndex|"trip"}`. */
  key: string
  /** "entries" steps collect add-list rows that become itinerary events.
   * "text" steps collect one free-text answer that never becomes an event. */
  kind: "entries" | "text"
  /** One of ITINERARY_CATEGORIES. */
  category: string
  title: string
  question: string
  hint: string
  addNoun: string
  /** Place name for a per-place step; null for a trip-wide step. */
  place: string | null
}

/**
 * Build the guided walk from the places the couple entered: for each place one
 * step per Accommodation, Food, Activities, then two trip-wide steps
 * (Transportation, Anything else). The itinerary twin of planBudgetSteps.
 */
export function planItinerarySteps(placeNames: string[]): ItineraryPlanStep[] {
  const places = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const list = places.length > 0 ? places : ["Trip"]
  const steps: ItineraryPlanStep[] = []
  list.forEach((name, i) => {
    steps.push({
      key: `accommodation:${i}`,
      kind: "entries",
      category: "Accommodation",
      title: "Accommodation",
      question: "Where are you staying?",
      hint: "Add each place to stay, with dates or number of nights.",
      addNoun: "stay",
      place: name,
    })
    steps.push({
      key: `food:${i}`,
      kind: "entries",
      category: "Food",
      title: "Food",
      question: "Places to eat or drink?",
      hint: "A restaurant, a cafe, a market... add each. Skip if none.",
      addNoun: "food",
      place: name,
    })
    steps.push({
      key: `activities:${i}`,
      kind: "entries",
      category: "Activities",
      title: "Activities",
      question: "Anything you'd like to do here?",
      hint: "A surf lesson, a hike, a show... add each. Skip if none.",
      addNoun: "activity",
      place: name,
    })
  })
  steps.push({
    key: "transportation:trip",
    kind: "entries",
    category: "Transportation",
    title: "Transportation",
    question: "Getting there and around?",
    hint: "Flights, ferries, a rental car... add each. Skip if none.",
    addNoun: "transport",
    place: null,
  })
  steps.push({
    key: "avoid:trip",
    kind: "text",
    category: "Avoid",
    title: "Anything to avoid?",
    question: "Anything to avoid this trip?",
    hint: "Optional - what you'd rather skip. Saved to the trip.",
    addNoun: "",
    place: null,
  })
  steps.push({
    key: "other:trip",
    kind: "entries",
    category: "Other",
    title: "Anything else",
    question: "Anything else to plan?",
    hint: "Add each. Skip if none.",
    addNoun: "item",
    place: null,
  })
  return steps
}

/** A flat, per-item draft: category + optional place/day, the wizard's staging
 * unit. Structurally the same as claude.ts's DraftedItineraryEvent; kept here
 * (client-safe) so the stepper and the converter never import the server seam. */
export interface DraftItem {
  category: string
  place: string
  text: string
  /** 1-based day; 0 = not placed. */
  day: number
  time: string
}

/**
 * Turn the wizard's flat draft items into an ItinerarySkeleton for the existing
 * write path. Builds the deterministic scaffold to learn each place's days and
 * day metadata, then files each item under its place (place-less -> first place)
 * on its day (unplaced or out of the place's range -> that place's first day).
 * Days with no items are dropped so Apply never creates empty itinerary days.
 */
export function itemsToSkeleton(
  items: DraftItem[],
  placeNames: string[],
  destination: string,
  dayCount: number,
): ItinerarySkeleton {
  const names = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const scaffold = planItinerarySkeleton({ destination, dayCount, placeNames: names })

  // Per scaffold place: a map day -> collected events, plus its day set.
  const buckets = scaffold.places.map((place) => ({
    place,
    days: new Set(place.days.map((d) => d.dayIndex)),
    firstDay: place.days[0]?.dayIndex ?? null,
    byDay: new Map<number, SkeletonEvent[]>(),
  }))
  // Place 0 always has at least one day (dayCount >= 1, remainder to earlier places).
  const fallbackPlaceIdx = 0

  for (const item of items) {
    const key = item.place.trim().toLowerCase()
    let idx = key ? scaffold.places.findIndex((p) => p.name.trim().toLowerCase() === key) : -1
    if (idx < 0) idx = fallbackPlaceIdx
    let bucket = buckets[idx]
    if (bucket.firstDay === null) bucket = buckets[fallbackPlaceIdx]
    const day = bucket.days.has(item.day) ? item.day : (bucket.firstDay as number)
    const list = bucket.byDay.get(day) ?? []
    list.push({ text: item.text, time: item.time, category: item.category })
    bucket.byDay.set(day, list)
  }

  return {
    places: buckets.map(({ place, byDay }) => ({
      name: place.name,
      days: place.days
        .filter((d) => byDay.has(d.dayIndex))
        .map((d) => ({ ...d, events: byDay.get(d.dayIndex) as SkeletonEvent[] })),
    })),
  }
}

/** Categories whose day range brackets a span rather than filling it: you
 * check into a hotel and out of it, the nights between are yours. */
const BRACKET_LABELS: Record<string, [string, string]> = {
  Accommodation: ["check in", "check out"],
  Transportation: ["pick up", "drop off"],
}

/** The days one entry lands on, each with its label suffix. A bracketed
 * category yields its two ends; anything else repeats across the range. */
function entryDays(entry: PlanEntry): { day: number; label: string }[] {
  const start = entry.day ?? 0
  if (!start) return []
  const end = entry.endDay ?? 0
  if (!end || end <= start) return [{ day: start, label: "" }]
  const labels = BRACKET_LABELS[entry.category]
  if (labels) {
    return [
      { day: start, label: labels[0] },
      { day: end, label: labels[1] },
    ]
  }
  return Array.from({ length: end - start + 1 }, (_, i) => ({ day: start + i, label: "" }))
}

/**
 * Turn the guided walk's entries straight into a skeleton, with no model in the
 * loop: what the couple typed, on the days they picked. Unlike itemsToSkeleton
 * the day wins over the place name — a Lisbon check-out on the day you reach
 * Porto belongs on that Porto day — and every scaffold day is kept, so the
 * places you listed all appear even where you entered nothing.
 */
export function entriesToSkeleton(
  entries: PlanEntry[],
  placeNames: string[],
  destination: string,
  dayCount: number,
): ItinerarySkeleton {
  const names = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const scaffold = planItinerarySkeleton({ destination, dayCount, placeNames: names })

  const lastDay = scaffold.places.reduce((n, p) => n + p.days.length, 0)
  const idxByName = new Map(
    scaffold.places.map((p, i) => [p.name.trim().toLowerCase(), i] as const),
  )

  const byDay = new Map<number, SkeletonEvent[]>()
  function push(day: number, event: SkeletonEvent) {
    const list = byDay.get(day) ?? []
    list.push(event)
    byDay.set(day, list)
  }

  const inTrip = (day: number) => day >= 1 && day <= lastDay
  /** A day outside the trip clamps to its nearest end, so nothing is dropped. */
  const clamp = (day: number) => Math.min(Math.max(day, 1), lastDay)

  for (const entry of entries) {
    const text = entry.subject.trim() || entry.category
    const spots = entryDays(entry)
    if (spots.length === 0) {
      // Unplaced: fall back to the named place's first day.
      const idx = idxByName.get(entry.place.trim().toLowerCase()) ?? 0
      const day = scaffold.places[idx]?.days[0]?.dayIndex ?? 1
      push(day, { text, time: "", category: entry.category })
      continue
    }
    // A bracket keeps both ends (a check-out often falls past the last day);
    // a repeated range keeps only the days the trip actually has.
    const kept = spots.filter((s) => inTrip(s.day))
    const landing =
      entry.category in BRACKET_LABELS ? spots : kept.length > 0 ? kept : [spots[0]]
    for (const spot of landing) {
      push(clamp(spot.day), {
        text: spot.label ? `${text} (${spot.label})` : text,
        time: "",
        category: entry.category,
      })
    }
  }

  return {
    places: scaffold.places.map((place) => ({
      name: place.name,
      days: place.days.map((d) => ({ ...d, events: byDay.get(d.dayIndex) ?? [] })),
    })),
  }
}

/** Categories that live on a per-place step; the value is the step key prefix. */
const PER_PLACE_STEP: Record<string, string> = {
  Accommodation: "accommodation",
  Food: "food",
  Activities: "activities",
}

/** Categories that live on a trip-wide step; the value is the whole step key. */
const TRIP_STEP: Record<string, string> = {
  Transportation: "transportation:trip",
  Other: "other:trip",
}

/** One walk row read back off an existing itinerary event. */
export interface SavedPlanRow {
  subject: string
  /** The day this event sits on, 1-based. */
  day: number
  /** `${dayId}#${eventIndex}`. */
  serverId: string
}

/** An existing itinerary in the guided walk's shape. */
export interface SavedPlan {
  /** Existing locations in order — the Places step's rows. */
  places: { id: string; name: string }[]
  /** Step key -> rows. */
  rows: Record<string, SavedPlanRow[]>
}

/**
 * Read an existing itinerary back into the walk: locations become the Places
 * step, and every day event becomes a row on its own day under the step its
 * category belongs to. Each row keeps a serverId so applying the walk patches
 * that event rather than adding a duplicate. The itinerary twin of the budget
 * drafter's savedRows(). An empty itinerary yields an empty SavedPlan, which
 * leaves the walk exactly as it opens today.
 */
export function savedPlanFromItinerary(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): SavedPlan {
  const places = locations.map((l) => ({ id: l.id, name: l.name }))
  const indexById = new Map(places.map((p, i) => [p.id, i] as const))
  const rows: Record<string, SavedPlanRow[]> = {}

  for (const day of days) {
    day.events.forEach((event, i) => {
      const category = event.category ?? "Other"
      const perPlace = PER_PLACE_STEP[category]
      // A day with no location (a travel day) files under the first place, the
      // same fallback the budget drafter uses for orphaned items.
      const placeIdx = (day.locationId ? indexById.get(day.locationId) : undefined) ?? 0
      const key = perPlace ? `${perPlace}:${placeIdx}` : (TRIP_STEP[category] ?? "other:trip")
      ;(rows[key] ??= []).push({
        subject: event.text,
        day: day.dayIndex,
        serverId: `${day.id}#${i}`,
      })
    })
  }

  return { places, rows }
}

/** The places a trip was planned with when it has days but no locations (a
 * dream moved over from the old dream table): its day tags, in day order. */
export function placesFromTags(days: ItineraryDay[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of [...days].sort((a, b) => a.dayIndex - b.dayIndex)) {
    const key = d.tag.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(d.tag.trim())
  }
  return out
}

/** The walk's opening places: the trip's locations, else (on a dream moved
 * over from the old dream table) the places its day tags name, else the trip
 * itself, which is the place. A dated trip's tags ("DAY", "ARRIVAL") are not
 * places, so they never seed. */
export function walkPlaceSeed(
  locationNames: string[],
  days: ItineraryDay[],
  tripName: string,
  startDate: string | null,
): string[] {
  if (locationNames.length > 0) return locationNames
  const tagged = startDate === null ? placesFromTags(days) : []
  return tagged.length > 0 ? tagged : [tripName.trim()]
}
