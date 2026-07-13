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
  /** Chance of rain, 0-100. */
  rainPct: number
  /** Next few hours, soonest first. */
  hourly: WeatherHour[]
}

export interface DayForecast {
  /** "YYYY-MM-DD". */
  date: string
  /** WMO weather code (Open-Meteo's scheme). */
  code: number
  highC: number
  lowC: number
  /** Peak wind speed for the day, km/h. */
  windKph: number
  /** Chance of rain for the day, 0-100. */
  rainPct: number
}

/**
 * Real 7-day daily forecast from Open-Meteo (free, no key), starting today at
 * the given coordinate. Cached for an hour. Returns null if the call fails --
 * the caller just hides the bar.
 */
export async function getWeekForecast(
  lat: number,
  lng: number,
): Promise<DayForecast[] | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,` +
    `wind_speed_10m_max,precipitation_probability_max` +
    `&forecast_days=7&timezone=auto`
  const res = await fetch(url, { next: { revalidate: 3600 } })
  if (!res.ok) return null
  const data = await res.json()
  const daily = data.daily
  if (!daily) return null
  return daily.time.map((date: string, i: number) => ({
    date,
    code: daily.weather_code[i],
    highC: daily.temperature_2m_max[i],
    lowC: daily.temperature_2m_min[i],
    windKph: daily.wind_speed_10m_max[i],
    rainPct: daily.precipitation_probability_max[i] ?? 0,
  }))
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
    rainPct: 10,
    hourly: [
      { time: "12:00", tempC, code: 0 },
      { time: "15:00", tempC: tempC + 2, code: 1 },
      { time: "18:00", tempC: tempC - 1, code: 2 },
      { time: "21:00", tempC: tempC - 3, code: 3 },
    ],
  }
}
