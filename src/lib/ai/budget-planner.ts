/**
 * Mock for the guided budget assistant. Pure, deterministic, no network. This
 * is the seam where real Claude lands later: keep the input and output types
 * stable, then make planBudgetSteps async and generate the interview from the
 * LLM client. The `context` field is reserved for that (trip notes), unused here.
 *
 * It returns an interview (steps with fields + suggestions), not a number. The
 * UI walks the steps and sums the answers into the trip total.
 */

export interface BudgetPlanInput {
  tripName: string
  /** Whole-trip nights; drives the trip-wide suggestions. */
  totalDays: number
  memberCount: number
  /** Flat cities/places in itinerary order. */
  locations: { id: string; name: string; nights: number }[]
  context?: string
}

export interface BudgetField {
  key: string
  label: string
  /** Seed amount; null means a blank field the user fills in. */
  suggestedCents: number | null
}

/** A tap-to-add named activity with a rough cost, shown on place steps. */
export interface ActivitySuggestion {
  label: string
  cents: number
}

export interface BudgetStep {
  key: string
  title: string
  subtitle: string | null
  question: string
  hint: string | null
  fields: BudgetField[]
  /** When present, the step shows an add-activities list seeded by these. */
  activitySuggestions?: ActivitySuggestion[]
}

const LODGING_PER_NIGHT_CENTS = 11000
const TRANSPORT_PER_PERSON_CENTS = 15000
const FOOD_PER_PERSON_DAY_CENTS = 2500

// Canned palette for the mock. Real Claude later picks ones that fit the
// destination/itinerary; the user can always add their own.
const ACTIVITY_SUGGESTIONS: ActivitySuggestion[] = [
  { label: "Surfing lesson", cents: 6000 },
  { label: "Diving", cents: 12000 },
  { label: "Boat trip", cents: 4500 },
  { label: "Guided hike", cents: 5000 },
  { label: "Entry fees", cents: 2500 },
]

function euros(cents: number): string {
  return (cents / 100).toFixed(0)
}

export function planBudgetSteps(input: BudgetPlanInput): BudgetStep[] {
  const memberCount = Math.max(1, input.memberCount)
  const totalDays = Math.max(1, input.totalDays)

  // With no locations, the whole trip is one place named after the trip, so
  // lodging and activities are still asked (just once, for the trip).
  const places =
    input.locations.length > 0
      ? input.locations
      : [{ id: "", name: input.tripName, nights: totalDays }]

  const locationSteps: BudgetStep[] = places.map((loc) => {
    const nights = Math.max(1, loc.nights)
    const lodging = nights * LODGING_PER_NIGHT_CENTS
    return {
      key: `loc:${loc.id}`,
      title: loc.name,
      subtitle: `${nights} ${nights === 1 ? "night" : "nights"}`,
      question: `How much for ${loc.name}?`,
      hint: `Somewhere to stay runs about EUR ${euros(LODGING_PER_NIGHT_CENTS)}/night, so ~EUR ${euros(lodging)} here. Add anything you'll do too.`,
      fields: [
        { key: "lodging", label: "Accommodation", suggestedCents: lodging },
      ],
      activitySuggestions: ACTIVITY_SUGGESTIONS,
    }
  })

  const transport = TRANSPORT_PER_PERSON_CENTS * memberCount
  const food = FOOD_PER_PERSON_DAY_CENTS * memberCount * totalDays

  const tripWideSteps: BudgetStep[] = [
    {
      key: "transport",
      title: "Getting around",
      subtitle: null,
      question: "Flights and transport for the trip?",
      hint: `Roughly EUR ${euros(TRANSPORT_PER_PERSON_CENTS)} each for ${memberCount} of you.`,
      fields: [
        { key: "transport", label: "Transport", suggestedCents: transport },
      ],
    },
    {
      key: "food",
      title: "Food & drink",
      subtitle: null,
      question: "Eating out and groceries?",
      hint: `About EUR ${euros(FOOD_PER_PERSON_DAY_CENTS)} each a day over ${totalDays} ${totalDays === 1 ? "day" : "days"}.`,
      fields: [{ key: "food", label: "Food & drink", suggestedCents: food }],
    },
    {
      key: "other",
      title: "Anything else",
      subtitle: null,
      question: "Insurance, gifts, a buffer?",
      hint: null,
      fields: [{ key: "other", label: "Other", suggestedCents: null }],
    },
  ]

  return [...locationSteps, ...tripWideSteps]
}
