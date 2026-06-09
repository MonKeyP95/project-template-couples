export interface Weather {
  tempC: number
  /** WMO weather code (Open-Meteo's scheme), drives the icon. */
  code: number
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
  return { tempC: 24, code: 0 }
}
