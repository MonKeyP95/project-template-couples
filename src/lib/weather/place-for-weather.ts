import type { ItineraryLocation } from "@/lib/trips/location-types"

/**
 * The location a 7-day forecast should describe: the one whose declared span
 * covers `today`, else the first leg by sort order, else null. A forecast only
 * reaches 7 days out, so "where are we now" is the only span that matters;
 * before the trip starts the first leg is the right guess.
 */
export function pickWeatherLocation(
  locations: ItineraryLocation[],
  today: string,
): ItineraryLocation | null {
  const current = locations.find(
    (l) => l.startDate && l.endDate && l.startDate <= today && today <= l.endDate,
  )
  if (current) return current
  const byOrder = [...locations].sort((a, b) => a.sortOrder - b.sortOrder)
  return byOrder[0] ?? null
}
