/**
 * The guided budget walk scaffold. Pure, deterministic, no network: it lays out
 * the empty category steps the drafter fills (from the itinerary and the
 * couple's entries); Generate prices the gaps.
 *
 * Steps are location-first: for each itinerary place, one step per category
 * (Accommodation, Food, Activities), then two trip-wide steps (Transport,
 * Anything else). Every step is a flat add-list bound to one (category, place).
 */

export interface BudgetPlanInput {
  tripName: string
  /** Whole-trip nights; drives the trip-wide suggestions and the no-location fallback. */
  totalDays: number
  memberCount: number
  /** Itinerary places in order; empty for a location-less trip. */
  locations: { id: string; name: string; nights: number; dateLabel: string | null }[]
  context?: string
}

export interface SeedItem {
  subject: string
  when: string
  suggestedCents: number | null
}

export interface BudgetStep {
  /** `${categoryKey}:${placeId}`; placeId is a location id, or "trip" for the
   * synthetic no-location place and the two trip-wide steps. */
  key: string
  /** Category display, e.g. "Accommodation" or "Food & drink". */
  title: string
  question: string
  hint: string | null
  addNoun: string
  seed: SeedItem[]
  /** Location name for a per-place step; null for a trip-wide step. */
  place: string | null
  /** Nights / date label shown beside the place; null when place is null. */
  placeWhen: string | null
}

const STEP_KEY_BY_CATEGORY: Record<string, string> = {
  Accommodation: "accommodation",
  Transportation: "transport",
  Food: "food",
  Activities: "activities",
  Other: "other",
}
const PER_LOCATION_KEYS = new Set(["accommodation", "food", "activities"])

/**
 * The walk bucket an itinerary event seeds, matching planBudgetSteps' keys:
 * per-location categories key on the location id, trip-wide on "trip". Returns
 * null for an unmapped category or a per-location event with no location.
 */
export function budgetBucketFor(
  category: string,
  locationId: string | null,
): string | null {
  const key = STEP_KEY_BY_CATEGORY[category]
  if (!key) return null
  if (PER_LOCATION_KEYS.has(key)) return locationId ? `${key}:${locationId}` : null
  return `${key}:trip`
}

export function planBudgetSteps(input: BudgetPlanInput): BudgetStep[] {
  const totalDays = Math.max(1, input.totalDays)

  // Places to walk: the itinerary locations, or one synthetic place named after
  // the trip when there are none.
  const places =
    input.locations.length > 0
      ? input.locations.map((l) => ({ ...l, nights: Math.max(1, l.nights) }))
      : [
          {
            id: "trip",
            name: input.tripName,
            nights: totalDays,
            dateLabel: null as string | null,
          },
        ]

  function nights(n: number): string {
    return `${n} ${n === 1 ? "night" : "nights"}`
  }
  function whenLabel(p: { nights: number; dateLabel: string | null }): string {
    return p.dateLabel ?? nights(p.nights)
  }

  const steps: BudgetStep[] = []

  // Location-first: all of a place's categories before moving on. Steps start
  // empty; the walk fills them from the itinerary and the couple's entries, and
  // Generate prices the gaps.
  for (const p of places) {
    const isSynthetic = p.id === "trip"
    const place = isSynthetic ? null : p.name
    const placeWhen = isSynthetic ? null : whenLabel(p)

    steps.push({
      key: `accommodation:${p.id}`,
      title: "Accommodation",
      question: "Where are you staying?",
      hint: "Add each place you're staying, with its cost.",
      addNoun: "hotel",
      seed: [],
      place,
      placeWhen,
    })

    steps.push({
      key: `food:${p.id}`,
      title: "Food & drink",
      question: "Eating out and groceries?",
      hint: "Add what you expect to spend on food here.",
      addNoun: "food",
      seed: [],
      place,
      placeWhen,
    })

    steps.push({
      key: `activities:${p.id}`,
      title: "Activities",
      question: "Anything you'd like to do here?",
      hint: "A tour, a dive, a show... add each with its cost. Skip if none.",
      addNoun: "activity",
      seed: [],
      place,
      placeWhen,
    })
  }

  // Trip-wide costs, once, at the end.
  steps.push({
    key: "transport:trip",
    title: "Transport",
    question: "Flights and getting around?",
    hint: "Flights, transfers, car hire, local transport.",
    addNoun: "transport",
    seed: [],
    place: null,
    placeWhen: null,
  })

  steps.push({
    key: "other:trip",
    title: "Anything else",
    question: "Anything else to budget for?",
    hint: "Insurance, gifts, fees... add each with a label and cost. Skip if none.",
    addNoun: "item",
    seed: [],
    place: null,
    placeWhen: null,
  })

  return steps
}
