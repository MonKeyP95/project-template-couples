import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { resolveCoords, type TripPlace } from "@/lib/weather/get-trip-weather"
import { detectActivities } from "./activity"
import { addDays, getConditions, type DayConditions } from "./get-conditions"

/** Everything written on a day: title, summary line and each event. */
function planText(day: ItineraryDay): string {
  return [day.title, day.sub, ...day.events.map((e) => e.text)].join(" ")
}

/**
 * Conditions cards for today and tomorrow: one per activity each day's plan
 * names, so a surf-and-dive day gets two. Today always gets a card -- a picker
 * when nothing is planned, so a changed morning can still check the sea.
 * Each day is located by its own itinerary location, so a move tomorrow
 * forecasts the new place.
 */
export async function getUpcomingConditions(
  trip: Omit<TripPlace, "locationName">,
  days: ItineraryDay[],
  locations: ItineraryLocation[],
  today: string,
): Promise<DayConditions[]> {
  const targets = [
    { dayDate: today, dayLabel: "Today", always: true },
    { dayDate: addDays(today, 1), dayLabel: "Tomorrow", always: false },
  ]
  const perDay = await Promise.all(
    targets.map(async ({ dayDate, dayLabel, always }) => {
      const day = days.find((d) => d.dayDate === dayDate)
      const planned = day ? detectActivities(planText(day)) : []
      if (planned.length === 0 && !always) return []
      const locationName =
        locations.find((l) => l.id === day?.locationId)?.name ?? null
      const place = await resolveCoords({ ...trip, locationName })
      if (!place) return []
      const base = { dayDate, dayLabel, place, planned }
      if (planned.length === 0) return [{ ...base, conditions: null }]
      const cards = await Promise.all(
        planned.map(async (activity) => {
          const conditions = await getConditions(activity, place, dayDate)
          return conditions ? { ...base, conditions } : null
        }),
      )
      return cards.filter((c) => c !== null)
    }),
  )
  return perDay.flat()
}
