/**
 * Slice 1 mock for the budget-planning assistant. Pure, deterministic, no
 * network. This is the seam where real Claude lands later: keep the input and
 * output types stable, then make draftBudget async and call the LLM client.
 * The `context` field is reserved for that (trip notes) and is unused here.
 */

export interface BudgetDraftInput {
  locations: { id: string; name: string; days: number }[]
  memberCount: number
  context?: string
}

export interface BudgetDraftLine {
  locationId: string
  name: string
  cents: number
}

export interface BudgetDraft {
  totalCents: number
  perLocation: BudgetDraftLine[]
  rationale: string
}

const DAILY_PER_PERSON_CENTS = 11000

export function draftBudget(input: BudgetDraftInput): BudgetDraft {
  const memberCount = Math.max(1, input.memberCount)
  // A dateless location still gets a share: floor its day count at 1.
  const locations = input.locations.map((l) => ({
    ...l,
    days: Math.max(1, l.days),
  }))
  const totalDays = locations.reduce((sum, l) => sum + l.days, 0)
  const totalCents = totalDays * DAILY_PER_PERSON_CENTS * memberCount

  const perLocation: BudgetDraftLine[] = locations.map((l) => ({
    locationId: l.id,
    name: l.name,
    cents: Math.floor((totalCents * l.days) / totalDays),
  }))

  // Rounding remainder lands on the location with the most days, so the split
  // always sums to exactly totalCents.
  const allocated = perLocation.reduce((sum, l) => sum + l.cents, 0)
  const remainder = totalCents - allocated
  if (remainder > 0 && perLocation.length > 0) {
    let maxIdx = 0
    for (let i = 1; i < locations.length; i++) {
      if (locations[i].days > locations[maxIdx].days) maxIdx = i
    }
    perLocation[maxIdx].cents += remainder
  }

  const perDay = DAILY_PER_PERSON_CENTS / 100
  const nights = totalDays === 1 ? "night" : "nights"
  const rationale = `${totalDays} ${nights} x EUR ${perDay}/person/day x ${memberCount}`

  return { totalCents, perLocation, rationale }
}
