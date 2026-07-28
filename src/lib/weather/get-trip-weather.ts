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
  /** Most specific place for this trip right now. Wins over the trip's own pin. */
  locationName?: string | null
}

interface Resolved {
  lat: number
  lng: number
  /** The string that produced these coordinates. */
  label: string
}

/**
 * Resolves a trip to coordinates, most specific candidate first: the itinerary
 * location we're on, then the trip's manual pin, then its name, then its
 * country. Country is last because it is the least specific thing we know --
 * forecasting Lisbon for a Madeira trip is the bug this order fixes. Returns
 * the label that produced the hit so callers can show which place they got.
 */
async function resolveCoords(place: TripPlace): Promise<Resolved | null> {
  if (place.locationName) {
    const geo = await geocodePlace(place.locationName)
    if (geo) return { ...geo, label: place.locationName }
  }
  if (place.lat != null && place.lng != null) {
    return { lat: place.lat, lng: place.lng, label: place.name }
  }
  const byName = await geocodePlace(place.name)
  if (byName) return { ...byName, label: place.name }
  if (place.country) {
    const byCountry = await geocodePlace(place.country)
    if (byCountry) return { ...byCountry, label: place.country }
  }
  return null
}

/**
 * Weather for a trip at its resolved coordinates. Null when there's no place to
 * locate. `isoDate` selects the season -- omit for today (on the road), pass the
 * trip's start date for a planning estimate.
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
 * Real next-7-days forecast for a trip, with the label of the place it actually
 * forecasts. Null when there's no place to locate or the forecast call fails.
 */
export async function getTripWeekForecast(
  place: TripPlace,
): Promise<{ label: string; days: DayForecast[] } | null> {
  const coords = await resolveCoords(place)
  if (!coords) return null
  const days = await getWeekForecast(coords.lat, coords.lng)
  return days ? { label: coords.label, days } : null
}
