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
 * Current weather at a coordinate. Stubbed with mock data until a real
 * provider is wired in; the signature and return type are fixed so the UI
 * never changes when the API lands. One file per integration -- no
 * provider-agnostic abstraction (see docs/TECH.md).
 */
export async function getWeather(lat: number, lng: number): Promise<Weather> {
  void lat
  void lng
  return {
    tempC: 24,
    code: 0,
    highC: 27,
    lowC: 21,
    windKph: 12,
    humidityPct: 55,
    hourly: [
      { time: "12:00", tempC: 25, code: 0 },
      { time: "15:00", tempC: 27, code: 1 },
      { time: "18:00", tempC: 24, code: 2 },
      { time: "21:00", tempC: 22, code: 3 },
    ],
  }
}
