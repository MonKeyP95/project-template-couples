import type { ItineraryEvent } from "./itinerary-types"

/** Day numbers after `from`, every `step` days, up to and including `until`.
 * Step 7 is "every same weekday". */
export function repeatDayIndexes(from: number, until: number, step: number): number[] {
  const out: number[] = []
  for (let i = from + step; i <= until; i += step) out.push(i)
  return out
}

/** The parts of an event worth copying; rating and note belong to the day it happened. */
export function repeatableCopy(ev: ItineraryEvent): ItineraryEvent {
  return {
    time: ev.time,
    ...(ev.endTime ? { endTime: ev.endTime } : {}),
    text: ev.text,
    ...(ev.url ? { url: ev.url } : {}),
    ...(ev.details ? { details: ev.details } : {}),
    ...(ev.category ? { category: ev.category } : {}),
  }
}

/** True when `events` already holds this event (same time, end and text). */
export function hasSameEvent(events: ItineraryEvent[], ev: ItineraryEvent): boolean {
  const key = (e: ItineraryEvent) =>
    `${e.time.trim()}|${(e.endTime ?? "").trim()}|${e.text.trim().toLowerCase()}`
  return events.some((e) => key(e) === key(ev))
}
