interface GeocodeResponse {
  results?: Array<{
    latitude: number
    longitude: number
    name: string
    admin1?: string
    country?: string
    country_code?: string
  }>
}

export interface PlaceMatch {
  lat: number
  lng: number
  /** "Ericeira, Lisbon District, PT" -- enough to spot a wrong match. */
  fullName: string
}

/**
 * Up to `count` matches for a place name from Open-Meteo's free geocoding API
 * (no key), with the ones whose country or region equals `prefer` first. The
 * index knows towns, not beaches. Cached for a day -- places don't move.
 */
export async function searchPlaces(
  query: string,
  count: number,
  prefer?: string | null,
): Promise<PlaceMatch[]> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?count=${count}&language=en&format=json&name=` +
    encodeURIComponent(query)
  const res = await fetch(url, { next: { revalidate: 86400 } })
  if (!res.ok) return []
  const data = (await res.json()) as GeocodeResponse
  const want = prefer?.trim().toLowerCase()
  const isPreferred = (r: { country?: string; admin1?: string }) =>
    !!want && (r.country?.toLowerCase() === want || r.admin1?.toLowerCase() === want)
  const results = data.results ?? []
  return [...results.filter(isPreferred), ...results.filter((r) => !isPreferred(r))].map(
    (r) => ({
      lat: r.latitude,
      lng: r.longitude,
      fullName: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
    }),
  )
}

/** The best match for a place name or country, or null when nothing matches.
 * `prefer` (the trip's country or region) wins over a same-named place abroad. */
export async function geocodePlace(
  query: string,
  prefer?: string | null,
): Promise<PlaceMatch | null> {
  const matches = await searchPlaces(query, prefer ? 10 : 1, prefer)
  return matches[0] ?? null
}
