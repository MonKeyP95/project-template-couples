import { moneyRounded } from "@/lib/money"

import type { Nudge, NearDailyCapContext } from "./types"

const CAP_FRACTION = 0.9

/** Fires when today's spend reaches 90% of the flat daily cap (budget / days).
 * Pure: reads context, returns a nudge or null. */
export function detectNearDailyCap(ctx: NearDailyCapContext): Nudge | null {
  const { plannedBudgetCents, tripDays, spentTodayCents, currency } = ctx
  if (plannedBudgetCents === 0 || tripDays === 0) return null
  const dailyCap = plannedBudgetCents / tripDays
  if (spentTodayCents < CAP_FRACTION * dailyCap) return null
  return {
    id: "near-daily-cap",
    text: `You've spent ${moneyRounded(spentTodayCents, currency)} of today's ~${moneyRounded(dailyCap, currency)} budget.`,
    help: { label: "find a cheaper spot" },
  }
}
