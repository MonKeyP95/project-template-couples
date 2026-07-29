export interface WeatherDay {
  d: string
  t: number
  /** WMO weather code. */
  code: number
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
    { d: "THU", t: 28, code: 0 },
    { d: "FRI", t: 29, code: 0 },
    { d: "SAT", t: 29, code: 1 },
    { d: "SUN", t: 27, code: 3 },
    { d: "MON", t: 26, code: 61 },
    { d: "TUE", t: 28, code: 2 },
    { d: "WED", t: 29, code: 0 },
  ],
}

const DETAIL_BY_SLUG: Record<string, TripDetail> = {
  lombok: LOMBOK_DETAIL,
}

export function getTripDetailBySlug(slug: string): TripDetail | null {
  return DETAIL_BY_SLUG[slug] ?? null
}
