import { ITINERARY_TONES, type ItineraryTone } from "@/lib/trips/itinerary-types"

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
  /** YYYY-MM-DD */
  date: string
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
  /** The trip's first day, YYYY-MM-DD. */
  startDate: string
  /** Inclusive day count across the whole trip. */
  dayCount: number
  /** Ordered place names; empty => one place named after the destination. */
  placeNames: string[]
}

/** Advance a YYYY-MM-DD date by n days (UTC, no tz drift). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Deterministic first draft: split the trip's days evenly across the places
 * (earlier places take the remainder), assign consecutive dates from startDate,
 * cycle tones, and leave events empty for the user (or slice 2's AI) to fill.
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
      const date = addDays(input.startDate, offset)
      days.push({
        date,
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

/** A flat, per-item draft: category + optional place/date, the wizard's staging
 * unit. Structurally the same as claude.ts's DraftedItineraryEvent; kept here
 * (client-safe) so the stepper and the converter never import the server seam. */
export interface DraftItem {
  category: string
  place: string
  text: string
  date: string
  time: string
}

/**
 * Turn the wizard's flat draft items into an ItinerarySkeleton for the existing
 * write path. Builds the deterministic scaffold to learn each place's dates and
 * day metadata, then files each item under its place (place-less -> first place)
 * on its date (blank or out-of-range -> that place's first day). Days with no
 * items are dropped so Apply never creates empty itinerary days.
 */
export function itemsToSkeleton(
  items: DraftItem[],
  placeNames: string[],
  destination: string,
  startDate: string,
  dayCount: number,
): ItinerarySkeleton {
  const names = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const scaffold = planItinerarySkeleton({ destination, startDate, dayCount, placeNames: names })

  // Per scaffold place: a map date -> collected events, plus its date set.
  const buckets = scaffold.places.map((place) => ({
    place,
    dates: new Set(place.days.map((d) => d.date)),
    firstDate: place.days[0]?.date ?? null,
    byDate: new Map<string, SkeletonEvent[]>(),
  }))
  // Place 0 always has at least one day (dayCount >= 1, remainder to earlier places).
  const fallbackPlaceIdx = 0

  for (const item of items) {
    const key = item.place.trim().toLowerCase()
    let idx = key ? scaffold.places.findIndex((p) => p.name.trim().toLowerCase() === key) : -1
    if (idx < 0) idx = fallbackPlaceIdx
    let bucket = buckets[idx]
    if (!bucket.firstDate) bucket = buckets[fallbackPlaceIdx]
    const date = bucket.dates.has(item.date) ? item.date : (bucket.firstDate as string)
    const list = bucket.byDate.get(date) ?? []
    list.push({ text: item.text, time: item.time, category: item.category })
    bucket.byDate.set(date, list)
  }

  return {
    places: buckets.map(({ place, byDate }) => ({
      name: place.name,
      days: place.days
        .filter((d) => byDate.has(d.date))
        .map((d) => ({ ...d, events: byDate.get(d.date) as SkeletonEvent[] })),
    })),
  }
}
