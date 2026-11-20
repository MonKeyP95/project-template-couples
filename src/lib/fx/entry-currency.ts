/**
 * The currency an expense form opens in: what you pay in there while today is
 * within the trip's dates, the home currency before, after, and for a dream.
 * Dates are ISO `yyyy-mm-dd`, so string comparison is date order.
 */
export function entryCurrency(
  trip: {
    startDate: string | null
    endDate: string | null
    currency: string
    homeCurrency: string
  },
  today: string,
): string {
  const { startDate, endDate } = trip
  const onTheRoad =
    startDate !== null && startDate <= today && today <= (endDate ?? startDate)
  return onTheRoad ? trip.currency : trip.homeCurrency
}
