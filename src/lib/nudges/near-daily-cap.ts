import type { Nudge, NearDailyCapContext } from "./types"

const CAP_FRACTION = 0.9
const EUR = (cents: number) => `EUR ${Math.round(cents / 100)}`

/** Fires when today's spend reaches 90% of the flat daily cap (budget / days).
 * Pure: reads context, returns a nudge or null. */
export function detectNearDailyCap(ctx: NearDailyCapContext): Nudge | null {
  const { plannedBudgetCents, tripDays, spentTodayCents } = ctx
  if (plannedBudgetCents === 0 || tripDays === 0) return null
  const dailyCap = plannedBudgetCents / tripDays
  if (spentTodayCents < CAP_FRACTION * dailyCap) return null
  return {
    id: "near-daily-cap",
    text: `You've spent ${EUR(spentTodayCents)} of today's ~${EUR(dailyCap)} budget.`,
    help: { label: "find a cheaper spot" },
  }
}
