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

/** Which day of the trip `today` is, clamped to the trip: 0 before it starts,
 * `days` after it ends. Null for a dateless dream. */
export function tripDayProgress(
  startDate: string | null,
  endDate: string | null,
  today: string,
): { day: number; days: number } | null {
  const days = computeTripDays(startDate, endDate)
  if (days === 0 || !startDate) return null
  const day = today < startDate ? 0 : computeTripDays(startDate, today)
  return { day: Math.min(day, days), days }
}
