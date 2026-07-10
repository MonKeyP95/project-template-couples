/** Inclusive day count of a trip's date span; 0 for a dateless dream. */
export function computeTripDays(
  startDate: string | null,
  endDate: string | null,
): number {
  if (!startDate || !endDate) return 0
  const ms =
    new Date(`${endDate}T00:00:00Z`).getTime() -
    new Date(`${startDate}T00:00:00Z`).getTime()
  return Math.max(0, Math.round(ms / 86_400_000) + 1)
}
