import type { Nudge, UnloggedDaysContext } from "./types"

const MIN_UNLOGGED_DAYS = 2

/** Fires when logging has lagged far enough that the budget line is stale.
 * Pure: reads context, returns a nudge or null. */
export function detectUnloggedDays(ctx: UnloggedDaysContext): Nudge | null {
  const { unloggedDays, lastLoggedLabel } = ctx
  if (unloggedDays < MIN_UNLOGGED_DAYS) return null
  const since = lastLoggedLabel
    ? `accurate up to ${lastLoggedLabel}`
    : "empty so far"
  return {
    id: "unlogged-days",
    text: `Nothing logged for ${unloggedDays} days -- your budget line is only ${since}.`,
    help: { label: "catch up" },
  }
}
