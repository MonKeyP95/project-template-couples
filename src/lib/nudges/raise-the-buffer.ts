import type { Nudge } from "@/lib/nudges/types"
import type { TripRollupInput } from "@/lib/trips/budget-history-types"
import type { RaiseTheBufferContext } from "@/lib/nudges/types"

/** Minimum average overrun (cents) for a chronic category to be worth flagging. */
const RAISE_MIN_OVERRUN_CENTS = 5000
/** Minimum number of past trips that overran the category. */
const RAISE_MIN_OVERRUNS = 2

const eur = (cents: number) => Math.round(cents / 100)

type Candidate = {
  category: string
  overruns: number // n
  budgetedTrips: number // m
  avgOverrunCents: number
  avgPastActualCents: number
  thisPlanCents: number
}

/**
 * Cross-trip planning flag: a category that chronically ran over plan on past
 * trips and is under-budgeted again this trip. Picks the single worst category
 * (largest average overrun) or returns null when none qualify. Deterministic;
 * reads only, writes nothing.
 */
export function detectRaiseTheBuffer(ctx: RaiseTheBufferContext): Nudge | null {
  const candidates: Candidate[] = []

  for (const [category, thisPlanCents] of Object.entries(ctx.thisTripPlan)) {
    if (thisPlanCents <= 0) continue

    const budgeted = ctx.pastRollups
      .map((t: TripRollupInput) => t.rollup.find((r) => r.category === category))
      .filter((r): r is NonNullable<typeof r> => !!r && r.plannedCents > 0)
    if (budgeted.length === 0) continue

    const overran = budgeted.filter((r) => r.actualCents > r.plannedCents)
    if (overran.length < RAISE_MIN_OVERRUNS) continue

    const avgOverrunCents = Math.round(
      overran.reduce((s, r) => s + (r.actualCents - r.plannedCents), 0) /
        overran.length,
    )
    if (avgOverrunCents < RAISE_MIN_OVERRUN_CENTS) continue

    const avgPastActualCents = Math.round(
      budgeted.reduce((s, r) => s + r.actualCents, 0) / budgeted.length,
    )
    if (thisPlanCents >= avgPastActualCents) continue

    candidates.push({
      category,
      overruns: overran.length,
      budgetedTrips: budgeted.length,
      avgOverrunCents,
      avgPastActualCents,
      thisPlanCents,
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.avgOverrunCents - a.avgOverrunCents)
  const c = candidates[0]

  return {
    id: `raise-the-buffer:${c.category}`,
    text: `${c.category} ran over on ${c.overruns} of your last ${c.budgetedTrips} trips (avg +€${eur(c.avgOverrunCents)}). Consider a bigger ${c.category} buffer.`,
    help: {
      label: "how much?",
      seed: `${c.category} ran over on ${c.overruns} of our last ${c.budgetedTrips} trips (avg +€${eur(c.avgOverrunCents)}) and we've budgeted €${eur(c.thisPlanCents)} this time. How much should we set aside?`,
    },
  }
}
