import { geocodePlace } from "./geocode"
import { getWeather, type Weather } from "./get-weather"

interface TripPlace {
  lat: number | null
  lng: number | null
  country: string | null
  name: string
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
  let lat = place.lat
  let lng = place.lng
  if (lat == null || lng == null) {
    const geo = await geocodePlace(place.country ?? place.name)
    if (!geo) return null
    lat = geo.lat
    lng = geo.lng
  }
  return getWeather(lat, lng, isoDate)
}
