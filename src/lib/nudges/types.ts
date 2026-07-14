import type { Weather } from "@/lib/weather/get-weather"

/** An optional token-spending action a nudge offers; only runs when tapped.
 * `seed`, when present, prefills the assistant chat input with a drafted
 * question so the couple can send it (or edit it first). */
export type NudgeHelp = {
  label: string
  seed?: string
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
}

export type RaiseTheBufferContext = {
  /** This trip's planned cents per category (summed budget items). */
  thisTripPlan: Record<string, number>
  /** Other started trips' rollups (excludes this trip). */
  pastRollups: import("@/lib/trips/budget-history-types").TripRollupInput[]
}
