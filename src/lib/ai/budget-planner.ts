/**
 * Slice 1 mock for the budget-planning assistant. Pure, deterministic, no
 * network. This is the seam where real Claude lands later: keep the input and
 * output types stable, then make draftBudget async and call the LLM client.
 * The `context` field is reserved for that (trip notes) and is unused here.
 */

export interface BudgetDraftInput {
  /** Whole-trip duration in days; drives the total even when locations are partial or absent. */
  totalDays: number
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
  const dailyShare = DAILY_PER_PERSON_CENTS * memberCount

  // Each location gets its own true share (days x daily). A dateless location
  // still counts as one day. The split can cover only part of the trip; the
  // uncovered nights simply stay unallocated, which Budget-by-location shows.
  const locations = input.locations.map((l) => ({
    ...l,
    days: Math.max(1, l.days),
  }))
  const perLocation: BudgetDraftLine[] = locations.map((l) => ({
    locationId: l.id,
    name: l.name,
    cents: l.days * dailyShare,
  }))

  // Total reflects the whole trip; never less than what the locations claim.
  const locDays = locations.reduce((sum, l) => sum + l.days, 0)
  const totalDays = Math.max(input.totalDays, locDays)
  const totalCents = totalDays * dailyShare

  const perDay = DAILY_PER_PERSON_CENTS / 100
  const nights = totalDays === 1 ? "night" : "nights"
  const rationale = `${totalDays} ${nights} x EUR ${perDay}/person/day x ${memberCount}`

  return { totalCents, perLocation, rationale }
}
