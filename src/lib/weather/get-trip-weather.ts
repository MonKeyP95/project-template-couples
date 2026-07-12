import { geocodePlace } from "./geocode"
import {
  getWeather,
  getWeekForecast,
  type DayForecast,
  type Weather,
} from "./get-weather"

interface TripPlace {
  lat: number | null
  lng: number | null
  country: string | null
  name: string
}

/** Resolves a trip's coordinates: manual lat/lng win, else geocode. */
async function resolveCoords(
  place: TripPlace,
): Promise<{ lat: number; lng: number } | null> {
  if (place.lat != null && place.lng != null) {
    return { lat: place.lat, lng: place.lng }
  }
  const geo = await geocodePlace(place.country ?? place.name)
  return geo ? { lat: geo.lat, lng: geo.lng } : null
}

/**
 * Weather for a trip, resolving its coordinates first: manual lat/lng win when
 * set, otherwise the trip's country (falling back to its name) is geocoded.
 * Returns null when there's no place to locate. `isoDate` selects the season --
 * omit for today (on the road), pass the trip's start date for a planning
 * estimate.
 */
export async function getTripWeather(
  place: TripPlace,
  isoDate?: string,
): Promise<Weather | null> {
  const coords = await resolveCoords(place)
  if (!coords) return null
  return getWeather(coords.lat, coords.lng, isoDate)
}

/**
 * Real next-7-days forecast for a trip's destination, resolving its coordinates
 * the same way as `getTripWeather`. Null when there's no place to locate.
 */
export async function getTripWeekForecast(
  place: TripPlace,
): Promise<DayForecast[] | null> {
  const coords = await resolveCoords(place)
  if (!coords) return null
  return getWeekForecast(coords.lat, coords.lng)
}
