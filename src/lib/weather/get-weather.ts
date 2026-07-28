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

interface CurrentResponse {
  current?: {
    time: string
    temperature_2m: number
    relative_humidity_2m: number
    weather_code: number
    wind_speed_10m: number
  }
  daily?: {
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: Array<number | null>
  }
  hourly?: {
    time: string[]
    temperature_2m: number[]
    weather_code: number[]
  }
}

/**
 * The next four 3-hourly slots strictly after `after`. Every time here is
 * destination-local (`timezone=auto`) and fixed-width ISO, so a string compare
 * orders them correctly.
 */
function nextHours(
  hourly: NonNullable<CurrentResponse["hourly"]>,
  after: string,
): WeatherHour[] {
  const start = hourly.time.findIndex((t) => t > after)
  if (start === -1) return []
  const slots: WeatherHour[] = []
  for (let i = start; i < hourly.time.length && slots.length < 4; i += 3) {
    slots.push({
      time: hourly.time[i].slice(11, 16),
      tempC: hourly.temperature_2m[i],
      code: hourly.weather_code[i],
    })
  }
  return slots
}

/**
 * Real current conditions from Open-Meteo (free, no key), cached for an hour.
 * `current` carries temperature, wind and humidity; today's `daily` row carries
 * the high, low and rain chance; `hourly` fills the next-hours strip. Two
 * forecast days so an evening reading still has hours ahead of it. Returns null
 * if the call fails -- the caller hides the card rather than showing a guess.
 */
export async function getCurrentWeather(
  lat: number,
  lng: number,
): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&hourly=temperature_2m,weather_code` +
    `&forecast_days=2&timezone=auto`
  const res = await fetch(url, { next: { revalidate: 3600 } })
  if (!res.ok) return null
  const data = (await res.json()) as CurrentResponse
  const { current, daily, hourly } = data
  if (!current || !daily) return null
  return {
    tempC: current.temperature_2m,
    code: current.weather_code,
    highC: daily.temperature_2m_max[0],
    lowC: daily.temperature_2m_min[0],
    windKph: current.wind_speed_10m,
    humidityPct: current.relative_humidity_2m,
    rainPct: daily.precipitation_probability_max[0] ?? 0,
    hourly: hourly ? nextHours(hourly, current.time) : [],
  }
}

/**
 * A climate estimate for a date, not a forecast: a deterministic function of
 * latitude and the month of `isoDate`. Hemisphere-aware -- warmest in the local
 * summer, colder toward the poles, seasonal swing growing with latitude. Its
 * only consumer is the packing nudge, which asks about a trip start date that
 * can be months out, past any real forecast. Never render this as the weather.
 */
export async function getSeasonalEstimate(
  lat: number,
  lng: number,
  isoDate: string,
): Promise<Weather> {
  void lng
  const month = Number(isoDate.slice(5, 7))
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
