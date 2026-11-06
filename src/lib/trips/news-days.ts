import { addDays } from "@/lib/conditions/get-conditions"
import { clockInTimeZone } from "@/lib/time/today"
import type { NewsDay } from "./dispatch-types"
import { getDispatchForDay } from "./dispatch-queries"

/** Local hour from which tomorrow's news is fetched alongside today's. */
const EVENING_HOUR = 17

/**
 * The news days the road box shows: today, and from the evening on tomorrow
 * too, unless tomorrow is past the trip's end. A day whose row is missing comes
 * back with `checkedAt: null`, which is the cue to generate it.
 */
export async function getNewsDays(
  trip: { id: string; endDate: string | null },
  today: string,
  tz: string,
): Promise<NewsDay[]> {
  const tomorrow = addDays(today, 1)
  const evening = Number(clockInTimeZone(tz).slice(0, 2)) >= EVENING_HOUR
  const withTomorrow =
    evening && trip.endDate !== null && tomorrow <= trip.endDate
  const wanted = [{ dayDate: today, dayLabel: "Today" }]
  if (withTomorrow) wanted.push({ dayDate: tomorrow, dayLabel: "Tomorrow" })

  return Promise.all(
    wanted.map(async ({ dayDate, dayLabel }) => {
      const row = await getDispatchForDay(trip.id, dayDate)
      return {
        dayDate,
        dayLabel,
        items: row?.items ?? [],
        checkedAt: row ? clockInTimeZone(tz, new Date(row.generatedAt)) : null,
      }
    }),
  )
}
