/**
 * Mock for the guided budget assistant. Pure, deterministic, no network. The
 * seam where real Claude lands later: keep the input/output types stable, then
 * make planBudgetSteps async and generate the interview from the LLM client.
 * The `context` field is reserved for that (trip notes), unused here.
 *
 * Steps are categories. Accommodation and Activities are *grouped by location*
 * (one sub-group per itinerary place, holding several hotels / activities);
 * Transport, Food and Other are flat trip-wide add-lists.
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

export interface BudgetGroup {
  /** Location id, or "trip" for the no-location fallback. */
  key: string
  title: string
  /** Date label / nights, shown in the group header. */
  when: string
  seed: SeedItem[]
}

export interface BudgetStep {
  key: string
  title: string
  question: string
  hint: string | null
  addNoun: string
  /** A flat step has `seed`; a grouped (by-location) step has `groups`. */
  seed?: SeedItem[]
  groups?: BudgetGroup[]
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

  // Places to group by: the itinerary locations, or one synthetic group named
  // after the trip when there are none.
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

  function whenLabel(p: { nights: number; dateLabel: string | null }): string {
    return p.dateLabel ?? `${p.nights} ${p.nights === 1 ? "night" : "nights"}`
  }

  const accommodationGroups: BudgetGroup[] = places.map((p) => ({
    key: p.id,
    title: p.name,
    when: whenLabel(p),
    seed: [
      {
        subject: "",
        when: p.dateLabel ?? "",
        suggestedCents: p.nights * LODGING_PER_NIGHT_CENTS,
      },
    ],
  }))

  const activityGroups: BudgetGroup[] = places.map((p) => ({
    key: p.id,
    title: p.name,
    when: whenLabel(p),
    seed: [],
  }))

  const transport = TRANSPORT_PER_PERSON_CENTS * memberCount
  const food = FOOD_PER_PERSON_DAY_CENTS * memberCount * totalDays
  const days = `${totalDays} ${totalDays === 1 ? "day" : "days"}`

  return [
    {
      key: "accommodation",
      title: "Accommodation",
      question: "Where are you staying in each place?",
      hint: `Roughly EUR ${euros(LODGING_PER_NIGHT_CENTS)}/night. Add each hotel with its cost.`,
      addNoun: "hotel",
      groups: accommodationGroups,
    },
    {
      key: "transport",
      title: "Transport",
      question: "Flights and getting around?",
      hint: `Roughly EUR ${euros(TRANSPORT_PER_PERSON_CENTS)} each for ${memberCount}.`,
      addNoun: "transport",
      seed: [{ subject: "", when: "", suggestedCents: transport }],
    },
    {
      key: "food",
      title: "Food & drink",
      question: "Eating out and groceries?",
      hint: `About EUR ${euros(FOOD_PER_PERSON_DAY_CENTS)} each a day over ${days}.`,
      addNoun: "food",
      seed: [{ subject: "", when: days, suggestedCents: food }],
    },
    {
      key: "activities",
      title: "Activities",
      question: "Anything you'd like to do in each place?",
      hint: "Surfing, diving, a tour... add each with its cost. Skip if none.",
      addNoun: "activity",
      groups: activityGroups,
    },
    {
      key: "other",
      title: "Anything else",
      question: "Anything else to budget for?",
      hint: "Insurance, gifts, a buffer... add each with a label and cost. Skip if none.",
      addNoun: "item",
      seed: [],
    },
  ]
}
