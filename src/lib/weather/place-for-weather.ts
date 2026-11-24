import type { ItineraryLocation } from "@/lib/trips/location-types"
import type { PlaceMatch } from "./geocode"

/**
 * The location a 7-day forecast should describe: the earliest-by-sort-order
 * location whose declared span covers `today`, else the first leg by sort
 * order, else null. A forecast only reaches 7 days out, so "where are we now"
 * is the only span that matters; before the trip starts the first leg is the
 * right guess.
 */
export function pickWeatherLocation(
  locations: ItineraryLocation[],
  today: string,
): ItineraryLocation | null {
  const byOrder = [...locations].sort((a, b) => a.sortOrder - b.sortOrder)
  const current = byOrder.find(
    (l) => l.startDate && l.endDate && l.startDate <= today && today <= l.endDate,
  )
  if (current) return current
  return byOrder[0] ?? null
}

/** A place for text consumers (news, place search): the couple's name plus
 * what it is pinned to, e.g. "Caleta de Famara (Famara, Canary Islands, ES)". */
export function placeText(name: string, pin: PlaceMatch | null): string {
  return pin ? `${name} (${pin.fullName})` : name
}
