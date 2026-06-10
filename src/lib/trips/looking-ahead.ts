import type { ItineraryDay, ItineraryEvent } from "./itinerary-types"
import type { ItineraryLocation } from "./location-types"

/** yyyy-mm-dd for `today` + n days, UTC. */
function addDays(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (both yyyy-mm-dd), UTC. */
function daysBetween(a: string, b: string): number {
  const ms =
    new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

/** Tomorrow's first timed event (sorted by time), or null when none. */
function firstTimedEvent(day: ItineraryDay | undefined): ItineraryEvent | null {
  if (!day) return null
  const timed = day.events
    .filter((e) => e.time)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  return timed[0] ?? null
}

export interface LookingAhead {
  /** Tomorrow's first event, or null. */
  tomorrowEvent: ItineraryEvent | null
  /** Tomorrow's day title when there's no timed event; null when no day. */
  tomorrowTitle: string | null
  /** Next location change after today, or null when the trip doesn't move again. */
  nextMove: { locationName: string; date: string; daysAway: number } | null
  /** True when tomorrow IS the next move day (collapse to one line). */
  collapse: boolean
}

/**
 * Tomorrow + next-move look-ahead for the On the Road page.
 * `today` is yyyy-mm-dd. `days` is the full ascending day list; `locations`
 * supplies move destination names. A "move" is the first future day whose
 * locationId differs from today's.
 */
export function computeLookingAhead(
  today: string,
  currentLocationId: string | null,
  days: ItineraryDay[],
  locations: ItineraryLocation[],
): LookingAhead {
  const tomorrowDate = addDays(today, 1)
  const tomorrowDay = days.find((d) => d.dayDate === tomorrowDate)
  const tomorrowEvent = firstTimedEvent(tomorrowDay)

  const moveDay = days
    .filter(
      (d) =>
        d.dayDate > today &&
        d.locationId != null &&
        d.locationId !== currentLocationId,
    )
    .sort((a, b) => (a.dayDate < b.dayDate ? -1 : 1))[0]

  const nextMove = moveDay
    ? {
        locationName:
          locations.find((l) => l.id === moveDay.locationId)?.name ?? "next stop",
        date: moveDay.dayDate,
        daysAway: daysBetween(today, moveDay.dayDate),
      }
    : null

  return {
    tomorrowEvent,
    tomorrowTitle: tomorrowEvent ? null : tomorrowDay?.title ?? null,
    nextMove,
    collapse: !!moveDay && moveDay.dayDate === tomorrowDate,
  }
}
