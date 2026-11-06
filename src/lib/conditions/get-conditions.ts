import type { Activity } from "./activity"

/** The hours each card reports; wind often turns between morning and afternoon. */
export const SLOT_HOURS = [8, 12, 16]

export interface ConditionsSlot {
  /** "HH:00" local time. */
  time: string
  waveM: number | null
  swellM: number | null
  swellPeriodS: number | null
  /** Degrees the swell comes from. */
  swellDirDeg: number | null
  windKph: number | null
  /** Degrees the wind comes from. */
  windDirDeg: number | null
  /** Model current, km/h -- approximate near the coast. */
  currentKph: number | null
}

export interface TideTurn {
  /** "HH:00" local time; hourly data, so approximate. */
  time: string
  kind: "high" | "low"
}

export interface Conditions {
  activity: Activity
  dayDate: string
  slots: ConditionsSlot[]
  tides: TideTurn[]
  /** Midday sea surface temperature. */
  waterC: number | null
  /** Rain over the three days before `dayDate`, mm. */
  rainMm3d: number | null
}

/** One surf or dive day's conditions, labelled for the deck. */
export interface DayConditions {
  conditions: Conditions
  /** "Today" or "Tomorrow". */
  dayLabel: string
}

const MARINE_VARS = [
  "wave_height",
  "swell_wave_height",
  "swell_wave_period",
  "swell_wave_direction",
  "ocean_current_velocity",
  "sea_level_height_msl",
  "sea_surface_temperature",
].join(",")

interface Marine {
  hourly: {
    wave_height: (number | null)[]
    swell_wave_height: (number | null)[]
    swell_wave_period: (number | null)[]
    swell_wave_direction: (number | null)[]
    ocean_current_velocity: (number | null)[]
    sea_level_height_msl: (number | null)[]
    sea_surface_temperature: (number | null)[]
  }
}

interface Forecast {
  hourly: {
    time: string[]
    wind_speed_10m: (number | null)[]
    wind_direction_10m: (number | null)[]
  }
  daily: { precipitation_sum: (number | null)[] }
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`

/** High and low turns in one day of hourly sea level. Turns at the day's edges
 * are skipped: they need the neighbouring day to confirm. */
export function tideTurns(levels: (number | null)[]): TideTurn[] {
  const turns: TideTurn[] = []
  for (let i = 1; i < levels.length - 1; i++) {
    const [prev, here, next] = [levels[i - 1], levels[i], levels[i + 1]]
    if (prev == null || here == null || next == null) continue
    if (here > prev && here >= next) turns.push({ time: hourLabel(i), kind: "high" })
    if (here < prev && here <= next) turns.push({ time: hourLabel(i), kind: "low" })
  }
  return turns
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { next: { revalidate: 3600 } })
  return res.ok ? res.json() : null
}

/**
 * Surf or dive conditions for one day at a coordinate, from Open-Meteo's free
 * marine and weather APIs. Null if either call fails; the caller drops the card.
 */
export async function getConditions(
  activity: Activity,
  lat: number,
  lng: number,
  dayDate: string,
): Promise<Conditions | null> {
  const at = `latitude=${lat}&longitude=${lng}&timezone=auto`
  const [marine, forecast] = await Promise.all([
    getJson<Marine>(
      `https://marine-api.open-meteo.com/v1/marine?${at}&hourly=${MARINE_VARS}` +
        `&start_date=${dayDate}&end_date=${dayDate}`,
    ),
    getJson<Forecast>(
      `https://api.open-meteo.com/v1/forecast?${at}` +
        `&hourly=wind_speed_10m,wind_direction_10m&daily=precipitation_sum` +
        `&start_date=${addDays(dayDate, -3)}&end_date=${dayDate}`,
    ),
  ])
  if (!marine || !forecast) return null

  const m = marine.hourly
  const windOffset = forecast.hourly.time.indexOf(`${dayDate}T00:00`)
  const slots = SLOT_HOURS.map((h) => ({
    time: hourLabel(h),
    waveM: m.wave_height[h],
    swellM: m.swell_wave_height[h],
    swellPeriodS: m.swell_wave_period[h],
    swellDirDeg: m.swell_wave_direction[h],
    windKph: forecast.hourly.wind_speed_10m[windOffset + h],
    windDirDeg: forecast.hourly.wind_direction_10m[windOffset + h],
    currentKph: m.ocean_current_velocity[h],
  }))
  const pastRain = forecast.daily.precipitation_sum.slice(0, 3)

  return {
    activity,
    dayDate,
    slots,
    tides: tideTurns(m.sea_level_height_msl),
    waterC: m.sea_surface_temperature[12],
    rainMm3d: pastRain.some((v) => v == null)
      ? null
      : pastRain.reduce<number>((sum, v) => sum + (v ?? 0), 0),
  }
}
