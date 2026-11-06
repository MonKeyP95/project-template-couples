import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { resolveCoords, type TripPlace } from "@/lib/weather/get-trip-weather"
import { detectActivity } from "./activity"
import { addDays, getConditions, type DayConditions } from "./get-conditions"

/** Everything written on a day: title, summary line and each event. */
function planText(day: ItineraryDay): string {
  return [day.title, day.sub, ...day.events.map((e) => e.text)].join(" ")
}

/**
 * Conditions cards for today and tomorrow, one per day whose plan names surfing
 * or diving. Each day is located by its own itinerary location, so a move
 * tomorrow forecasts the new place.
 */
export async function getUpcomingConditions(
  trip: Omit<TripPlace, "locationName">,
  days: ItineraryDay[],
  locations: ItineraryLocation[],
  today: string,
): Promise<DayConditions[]> {
  const targets = [
    { dayDate: today, dayLabel: "Today" },
    { dayDate: addDays(today, 1), dayLabel: "Tomorrow" },
  ]
  const cards = await Promise.all(
    targets.map(async ({ dayDate, dayLabel }) => {
      const day = days.find((d) => d.dayDate === dayDate)
      const activity = day ? detectActivity(planText(day)) : null
      if (!day || !activity) return null
      const locationName =
        locations.find((l) => l.id === day.locationId)?.name ?? null
      const coords = await resolveCoords({ ...trip, locationName })
      if (!coords) return null
      const conditions = await getConditions(activity, coords.lat, coords.lng, dayDate)
      return conditions ? { conditions, dayLabel } : null
    }),
  )
  return cards.filter((c) => c !== null)
}
