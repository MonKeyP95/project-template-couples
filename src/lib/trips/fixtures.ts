import type { WeatherGlyph } from "@/components/together"

export interface WeatherDay {
  d: string
  t: number
  glyph: WeatherGlyph
}

/**
 * Trip detail parts NOT yet in the database. Weather is likely to come from an
 * external API later; planned budget will land on the trips table later.
 */
export interface TripDetail {
  weather: WeatherDay[]
  /** Index into `weather` for the day the user is currently on. */
  weatherActive: number
  /** Trip-level planned budget in cents. Moves to trips table later. */
  plannedBudgetCents: number
}

const LOMBOK_DETAIL: TripDetail = {
  plannedBudgetCents: 280000,
  weatherActive: 2,
  weather: [
    { d: "THU", t: 28, glyph: "sun" },
    { d: "FRI", t: 29, glyph: "sun" },
    { d: "SAT", t: 29, glyph: "sun" },
    { d: "SUN", t: 27, glyph: "haze" },
    { d: "MON", t: 26, glyph: "rain" },
    { d: "TUE", t: 28, glyph: "sun" },
    { d: "WED", t: 29, glyph: "sun" },
  ],
}

const DETAIL_BY_SLUG: Record<string, TripDetail> = {
  lombok: LOMBOK_DETAIL,
}

export function getTripDetailBySlug(slug: string): TripDetail | null {
  return DETAIL_BY_SLUG[slug] ?? null
}
