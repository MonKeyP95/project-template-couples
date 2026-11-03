import type { DatedItineraryDay, ItineraryDay, ItineraryEvent } from "./itinerary-types"
import type { ItineraryLocation } from "./location-types"

/** Whole days from `a` to `b` (both yyyy-mm-dd), UTC. */
function daysBetween(a: string, b: string): number {
  const ms =
    new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

/** The day's first timed event, else its first untimed one, else null. */
function firstEvent(day: ItineraryDay): ItineraryEvent | null {
  const timed = day.events
    .filter((e) => e.time)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  return timed[0] ?? day.events[0] ?? null
}

function hasPlan(day: ItineraryDay): boolean {
  return day.events.length > 0 || (day.title ?? "").trim() !== ""
}

export interface LookingAhead {
  /** The first later day with a plan: its first event, or its title when it has none. */
  nextPlanned: {
    date: string
    label: string
    daysAway: number
    event: ItineraryEvent | null
    title: string
  } | null
  /** Next location change after today, or null when the trip doesn't move again. */
  nextMove: { locationName: string; date: string; daysAway: number } | null
  /** True when the next planned day IS the next move day (collapse to one line). */
  collapse: boolean
}

/**
 * Next-planned + next-move look-ahead for the On the Road page.
 * `today` is yyyy-mm-dd. `days` is the full ascending day list (blank days
 * included); `locations` supplies move destination names. A "move" is the
 * first future day whose locationId differs from today's.
 */
export function computeLookingAhead(
  today: string,
  currentLocationId: string | null,
  days: DatedItineraryDay[],
  locations: ItineraryLocation[],
): LookingAhead {
  const future = days
    .filter((d) => d.dayDate > today)
    .sort((a, b) => (a.dayDate < b.dayDate ? -1 : 1))

  const plannedDay = future.find(hasPlan)
  const nextPlanned = plannedDay
    ? {
        date: plannedDay.dayDate,
        label: `${plannedDay.dow} ${plannedDay.dom} ${plannedDay.mon}`,
        daysAway: daysBetween(today, plannedDay.dayDate),
        event: firstEvent(plannedDay),
        title: plannedDay.title ?? "",
      }
    : null

  const moveDay = future.find(
    (d) => d.locationId != null && d.locationId !== currentLocationId,
  )
  const nextMove = moveDay
    ? {
        locationName:
          locations.find((l) => l.id === moveDay.locationId)?.name ?? "next stop",
        date: moveDay.dayDate,
        daysAway: daysBetween(today, moveDay.dayDate),
      }
    : null

  return {
    nextPlanned,
    nextMove,
    collapse: !!moveDay && moveDay.dayDate === plannedDay?.dayDate,
  }
}
