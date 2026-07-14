/**
 * Mock for the guided budget assistant. Pure, deterministic, no network. The
 * seam where real Claude lands later: keep the input/output types stable, then
 * make planBudgetSteps async and generate the interview from the LLM client.
 * The `context` field is reserved for that (trip notes), unused here.
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

const LODGING_PER_NIGHT_CENTS = 11000
const TRANSPORT_PER_PERSON_CENTS = 15000
const FOOD_PER_PERSON_DAY_CENTS = 2500
const ITEM_ESTIMATE_CENTS = 5000

function euros(cents: number): string {
  return (cents / 100).toFixed(0)
}

/**
 * The assistant's guess for an item left without a cost. Mock returns a flat
 * figure; real Claude later assesses it from the item's subject. An explicit 0
 * (e.g. staying with friends) is kept as-is and never estimated.
 */
export function estimateItemCents(): number {
  return ITEM_ESTIMATE_CENTS
}

export function planBudgetSteps(input: BudgetPlanInput): BudgetStep[] {
  const memberCount = Math.max(1, input.memberCount)
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

  // Location-first: all of a place's categories before moving on.
  for (const p of places) {
    const isSynthetic = p.id === "trip"
    const place = isSynthetic ? null : p.name
    const placeWhen = isSynthetic ? null : whenLabel(p)
    const days = nights(p.nights)

    steps.push({
      key: `accommodation:${p.id}`,
      title: "Accommodation",
      question: "Where are you staying?",
      hint: `Roughly EUR ${euros(LODGING_PER_NIGHT_CENTS)}/night. Add each place to stay with its cost.`,
      addNoun: "hotel",
      seed: [
        {
          subject: "",
          when: p.dateLabel ?? "",
          suggestedCents: p.nights * LODGING_PER_NIGHT_CENTS,
        },
      ],
      place,
      placeWhen,
    })

    steps.push({
      key: `food:${p.id}`,
      title: "Food & drink",
      question: "Eating out and groceries?",
      hint: `About EUR ${euros(FOOD_PER_PERSON_DAY_CENTS)} each a day over ${days}.`,
      addNoun: "food",
      seed: [
        {
          subject: "",
          when: days,
          suggestedCents: FOOD_PER_PERSON_DAY_CENTS * memberCount * p.nights,
        },
      ],
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
    hint: `Roughly EUR ${euros(TRANSPORT_PER_PERSON_CENTS)} each for ${memberCount}.`,
    addNoun: "transport",
    seed: [{ subject: "", when: "", suggestedCents: TRANSPORT_PER_PERSON_CENTS * memberCount }],
    place: null,
    placeWhen: null,
  })

  steps.push({
    key: "other:trip",
    title: "Anything else",
    question: "Anything else to budget for?",
    hint: "Insurance, gifts, a buffer... add each with a label and cost. Skip if none.",
    addNoun: "item",
    seed: [],
    place: null,
    placeWhen: null,
  })

  return steps
}
