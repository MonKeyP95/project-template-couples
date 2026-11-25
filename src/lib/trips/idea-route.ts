/** The route an accepted home idea carries into the new-trip walk, and the
 * pure steps that turn it into days. Import-free (types only) so the client
 * walk and the server can both run it. */

import type { PrefKey } from "./trip-note-parse"

export interface RouteActivity {
  title: string
  /** big = worth comparing options for; small = a place to eat or drink. */
  kind: "big" | "small"
}

export interface RouteStop {
  name: string
  nights: number
  /** Arriving here takes most of the stop's first day. Never on the first stop. */
  travelDay: boolean
  activities: RouteActivity[]
}

/** The walk's answers and route, returned with a home trip idea. */
export interface IdeaPlan {
  place: string
  what: string
  /** Rough total length; 0 = unknown. */
  days: number
  prefs: Record<PrefKey, string>
  stops: RouteStop[]
}

export interface RouteSpan {
  name: string
  /** 1-based day numbers, inclusive. */
  start: number
  end: number
  travelDay: boolean
}

export interface PlacedActivity {
  stopIndex: number
  title: string
  kind: "big" | "small"
  /** null = the suggestion box. */
  dayIndex: number | null
}

/** Total nights across the route. */
export function routeNights(stops: RouteStop[]): number {
  return stops.reduce((n, s) => n + s.nights, 0)
}

/** The route resized to `days`: the last stop grows or shrinks, and stops
 * that would drop below one night are removed from the end. `days < 1`
 * (unknown length) leaves it as is. */
export function fitRoute(stops: RouteStop[], days: number): RouteStop[] {
  if (days < 1) return stops
  const out = stops.map((s, i) => ({ ...s, travelDay: i > 0 && s.travelDay }))
  let diff = days - routeNights(out)
  while (diff < 0 && out.length > 0) {
    const last = out[out.length - 1]
    if (last.nights + diff >= 1) {
      out[out.length - 1] = { ...last, nights: last.nights + diff }
      diff = 0
    } else {
      out.pop()
      diff += last.nights
    }
  }
  if (diff > 0 && out.length > 0) {
    const last = out[out.length - 1]
    out[out.length - 1] = { ...last, nights: last.nights + diff }
  }
  return out
}

/** Each stop's consecutive day span, from Day 1. */
export function routeSpans(stops: RouteStop[]): RouteSpan[] {
  let start = 1
  return stops.map((s, i) => {
    const span = { name: s.name, start, end: start + s.nights - 1, travelDay: i > 0 && s.travelDay }
    start += s.nights
    return span
  })
}

/** One activity per free day of its stop, in order; never on a travel day.
 * The rest go to the box. */
export function placeActivities(stops: RouteStop[]): PlacedActivity[] {
  const spans = routeSpans(stops)
  return stops.flatMap((stop, stopIndex) => {
    const span = spans[stopIndex]
    const first = span.travelDay ? span.start + 1 : span.start
    return stop.activities.map((a, i) => ({
      stopIndex,
      title: a.title,
      kind: a.kind,
      dayIndex: first + i <= span.end ? first + i : null,
    }))
  })
}

/** "Malta 5 nights · Gozo 3 nights (travel day)". */
export function routeLine(stops: RouteStop[]): string {
  return stops
    .map((s, i) => {
      const nights = `${s.name} ${s.nights} night${s.nights === 1 ? "" : "s"}`
      return i > 0 && s.travelDay ? `${nights} (travel day)` : nights
    })
    .join(" · ")
}
