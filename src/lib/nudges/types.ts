import type { Weather } from "@/lib/weather/get-weather"

/** An optional token-spending action a nudge offers; only runs when tapped. */
export type NudgeHelp = {
  label: string
}

/** A deterministic, zero-token proactive nudge. */
export type Nudge = {
  id: string
  text: string
  help?: NudgeHelp
}

export type WeatherPackingContext = {
  destination: string
  weather: Weather | null
  /** Packing labels, lowercased. */
  packingLabels: string[]
}

export type NearDailyCapContext = {
  plannedBudgetCents: number
  /** Inclusive trip day count. */
  tripDays: number
  spentTodayCents: number
  /** The trip's reporting currency; both figures are home amounts. */
  currency: string
}

export type UnloggedDaysContext = {
  /** Whole days between the last logged expense and today. */
  unloggedDays: number
  /** Short label for the last logged day, e.g. "28 Jul"; null when nothing is logged. */
  lastLoggedLabel: string | null
}
