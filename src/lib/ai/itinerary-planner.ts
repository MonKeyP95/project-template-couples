import { ITINERARY_TONES, type ItineraryTone } from "@/lib/trips/itinerary-types"

export interface SkeletonEvent {
  text: string
  time: string
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
    const nights = base + (pi < extra ? 1 : 0)
    const days: SkeletonDay[] = []
    for (let i = 0; i < nights; i++) {
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
