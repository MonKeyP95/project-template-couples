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

/** One thing the couple entered in the guided walk: a category + place + a
 * free-text subject and an optional "when" (dates or number of nights). These
 * are the facts the assistant drafts the itinerary from. Client-safe. */
export interface PlanEntry {
  category: string
  /** Place name, or "" for a trip-wide entry (transport, other). */
  place: string
  subject: string
  when: string
  /** YYYY-MM-DD start, when the couple picked one. Drives the no-AI apply. */
  date?: string
  /** YYYY-MM-DD end, when they picked a range. */
  endDate?: string
}

/** One step of the guided itinerary walk. Mirrors budget's BudgetStep: per-place
 * Accommodation/Food/Activities, then trip-wide Transportation/Other. */
export interface ItineraryPlanStep {
  /** `${categoryKey}:${placeIndex|"trip"}`. */
  key: string
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
      category: "Accommodation",
      title: "Accommodation",
      question: "Where are you staying?",
      hint: "Add each place to stay, with dates or number of nights.",
      addNoun: "stay",
      place: name,
    })
    steps.push({
      key: `food:${i}`,
      category: "Food",
      title: "Food",
      question: "Places to eat or drink?",
      hint: "A restaurant, a cafe, a market... add each. Skip if none.",
      addNoun: "food",
      place: name,
    })
    steps.push({
      key: `activities:${i}`,
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
    category: "Transportation",
    title: "Transportation",
    question: "Getting there and around?",
    hint: "Flights, ferries, a rental car... add each. Skip if none.",
    addNoun: "transport",
    place: null,
  })
  steps.push({
    key: "other:trip",
    category: "Other",
    title: "Anything else",
    question: "Anything else to plan?",
    hint: "Add each. Skip if none.",
    addNoun: "item",
    place: null,
  })
  return steps
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

/** Every date from start to end, inclusive. */
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

/** Categories whose date range brackets a span rather than filling it: you
 * check into a hotel and out of it, the nights between are yours. */
const BRACKET_LABELS: Record<string, [string, string]> = {
  Accommodation: ["check in", "check out"],
  Transportation: ["pick up", "drop off"],
}

/** The dates one entry lands on, each with its label suffix. A bracketed
 * category yields its two ends; anything else repeats across the range. */
function entryDates(entry: PlanEntry): { date: string; label: string }[] {
  const start = entry.date ?? ""
  if (!start) return []
  const end = entry.endDate ?? ""
  if (!end || end <= start) return [{ date: start, label: "" }]
  const labels = BRACKET_LABELS[entry.category]
  if (labels) {
    return [
      { date: start, label: labels[0] },
      { date: end, label: labels[1] },
    ]
  }
  return enumerateDates(start, end).map((date) => ({ date, label: "" }))
}

/**
 * Turn the guided walk's entries straight into a skeleton, with no model in the
 * loop: what the couple typed, on the dates they picked. Unlike itemsToSkeleton
 * the date wins over the place name — a Lisbon check-out on the day you reach
 * Porto belongs on that Porto day — and every scaffold day is kept, so the
 * places you listed all appear even where you entered nothing.
 */
export function entriesToSkeleton(
  entries: PlanEntry[],
  placeNames: string[],
  destination: string,
  startDate: string,
  dayCount: number,
): ItinerarySkeleton {
  const names = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const scaffold = planItinerarySkeleton({ destination, startDate, dayCount, placeNames: names })

  const tripDates = scaffold.places.flatMap((p) => p.days.map((d) => d.date))
  const firstDate = tripDates[0]
  const lastDate = tripDates[tripDates.length - 1]
  const known = new Set(tripDates)
  const idxByName = new Map(
    scaffold.places.map((p, i) => [p.name.trim().toLowerCase(), i] as const),
  )

  const byDate = new Map<string, SkeletonEvent[]>()
  function push(date: string, event: SkeletonEvent) {
    const list = byDate.get(date) ?? []
    list.push(event)
    byDate.set(date, list)
  }

  /** A date outside the trip clamps to its nearest end, so nothing is dropped. */
  function clamp(date: string): string {
    if (known.has(date)) return date
    return date < firstDate ? firstDate : lastDate
  }

  for (const entry of entries) {
    const text = entry.subject.trim() || entry.category
    const spots = entryDates(entry)
    if (spots.length === 0) {
      // Undated: fall back to the named place's first day.
      const idx = idxByName.get(entry.place.trim().toLowerCase()) ?? 0
      const date = scaffold.places[idx]?.days[0]?.date ?? firstDate
      push(date, { text, time: "", category: entry.category })
      continue
    }
    // A bracket keeps both ends (a check-out often falls past the last day);
    // a repeated range keeps only the days the trip actually has.
    const inTrip = spots.filter((s) => known.has(s.date))
    const landing =
      entry.category in BRACKET_LABELS ? spots : inTrip.length > 0 ? inTrip : [spots[0]]
    for (const spot of landing) {
      push(clamp(spot.date), {
        text: spot.label ? `${text} (${spot.label})` : text,
        time: "",
        category: entry.category,
      })
    }
  }

  return {
    places: scaffold.places.map((place) => ({
      name: place.name,
      days: place.days.map((d) => ({ ...d, events: byDate.get(d.date) ?? [] })),
    })),
  }
}
