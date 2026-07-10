export interface WeatherHour {
  /** "HH:MM" label. */
  time: string
  tempC: number
  /** WMO weather code. */
  code: number
}

export interface Weather {
  tempC: number
  /** WMO weather code (Open-Meteo's scheme), drives the icon. */
  code: number
  highC: number
  lowC: number
  windKph: number
  humidityPct: number
  /** Next few hours, soonest first. */
  hourly: WeatherHour[]
}

/**
 * Current weather at a coordinate, as a deterministic function of latitude and
 * the month of `isoDate` (defaults to today). Hemisphere-aware: warmest in the
 * local summer, colder toward the poles, seasonal swing grows with latitude.
 * Still a stub -- no network, no key. When the real Open-Meteo call lands the
 * body swaps out; the signature and return type stay fixed so nothing downstream
 * changes. The planning path passes a future trip's start date so it reads that
 * trip's season, not today's; that path is a seasonal estimate, not a forecast.
 */
export async function getWeather(
  lat: number,
  lng: number,
  isoDate?: string,
): Promise<Weather> {
  void lng
  const month = isoDate ? Number(isoDate.slice(5, 7)) : new Date().getUTCMonth() + 1
  // 1 at northern midsummer (July), -1 at northern midwinter (January).
  const northSeason = Math.cos(((month - 7) / 12) * 2 * Math.PI)
  const season = lat >= 0 ? northSeason : -northSeason
  const absLat = Math.abs(lat)
  const baseC = 30 - (absLat / 90) * 35 // ~30C at the equator, ~-5C at the poles
  const swing = (absLat / 90) * 18 // tropics barely vary; high latitudes swing hard
  const tempC = Math.round(baseC + season * swing)
  return {
    tempC,
    code: 0,
    highC: tempC + 3,
    lowC: tempC - 3,
    windKph: 12,
    humidityPct: 55,
    hourly: [
      { time: "12:00", tempC, code: 0 },
      { time: "15:00", tempC: tempC + 2, code: 1 },
      { time: "18:00", tempC: tempC - 1, code: 2 },
      { time: "21:00", tempC: tempC - 3, code: 3 },
    ],
  }
}
