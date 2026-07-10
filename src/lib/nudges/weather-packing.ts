import type { Nudge, WeatherPackingContext } from "./types"

const WARM_KEYWORDS = [
  "jacket",
  "coat",
  "sweater",
  "jumper",
  "fleece",
  "thermal",
  "gloves",
  "hat",
  "scarf",
]
const COLD_LOW_C = 10

/** Fires when the destination is cold for the trip's season and no warm item is
 * on the packing list yet. Pure: reads context, returns a nudge or null. */
export function detectWeatherPacking(ctx: WeatherPackingContext): Nudge | null {
  const { destination, weather, packingLabels } = ctx
  if (!weather) return null
  if (weather.lowC > COLD_LOW_C) return null
  const hasWarm = packingLabels.some((label) =>
    WARM_KEYWORDS.some((word) => label.includes(word)),
  )
  if (hasWarm) return null
  return {
    id: "weather-packing",
    text: `${destination} will be cold (${weather.lowC}°C) — pack warm layers.`,
  }
}
