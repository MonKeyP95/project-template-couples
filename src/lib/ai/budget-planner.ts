/**
 * Mock for the guided budget assistant. Pure, deterministic, no network. The
 * seam where real Claude lands later: keep the input/output types stable, then
 * make planBudgetSteps async and generate the interview from the LLM client.
 * The `context` field is reserved for that (trip notes), unused here.
 *
 * Every step is a category (Accommodation, Transport, ...). Each holds an
 * add-list of detailed items (subject + when + cost). The assistant pre-seeds a
 * suggested item where it can estimate; the user edits, adds, or removes rows.
 */

export interface BudgetPlanInput {
  /** Whole-trip nights; drives the seeded suggestions. */
  totalDays: number
  memberCount: number
  context?: string
}

export interface SeedItem {
  subject: string
  when: string
  /** Seed cost; null = leave blank (user fills, or the assistant estimates). */
  suggestedCents: number | null
}

export interface BudgetStep {
  key: string
  title: string
  question: string
  hint: string | null
  /** Noun for the add button, e.g. "accommodation" -> "+ add accommodation". */
  addNoun: string
  seed: SeedItem[]
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

  const lodging = totalDays * LODGING_PER_NIGHT_CENTS
  const transport = TRANSPORT_PER_PERSON_CENTS * memberCount
  const food = FOOD_PER_PERSON_DAY_CENTS * memberCount * totalDays
  const nights = `${totalDays} ${totalDays === 1 ? "night" : "nights"}`
  const days = `${totalDays} ${totalDays === 1 ? "day" : "days"}`

  return [
    {
      key: "accommodation",
      title: "Accommodation",
      question: "Where are you staying?",
      hint: `Roughly EUR ${euros(LODGING_PER_NIGHT_CENTS)}/night. Add each place with its dates and cost.`,
      addNoun: "accommodation",
      seed: [{ subject: "", when: nights, suggestedCents: lodging }],
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
      question: "Anything you'd like to do?",
      hint: "Surfing, diving, a tour... add each with its date and cost. Skip if none.",
      addNoun: "activity",
      seed: [],
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
