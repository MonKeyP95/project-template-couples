/** Presentation helpers for WMO weather codes (Open-Meteo's scheme). */

/** Short human label for a WMO weather code. */
export function labelFor(code: number): string {
  if (code === 0) return "Clear"
  if (code === 1) return "Mainly clear"
  if (code === 2) return "Partly cloudy"
  if (code === 3) return "Overcast"
  if (code === 45 || code === 48) return "Fog"
  if (code >= 51 && code <= 67) return "Rain"
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow"
  if (code >= 80 && code <= 82) return "Showers"
  if (code >= 95) return "Storm"
  return "Cloudy"
}

/** Maps a WMO weather code to one of DayChip's three glyphs. */
export function glyphFor(code: number): "sun" | "haze" | "rain" {
  if (code >= 51) return "rain"
  if (code === 0 || code === 1) return "sun"
  return "haze"
}
