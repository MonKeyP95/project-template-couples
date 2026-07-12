interface GeocodeResponse {
  results?: Array<{ latitude: number; longitude: number }>
}

/**
 * Resolves a place name or country to coordinates via Open-Meteo's free
 * geocoding API (no key). Returns the top match, or null when nothing matches
 * or the request fails. Cached for a day -- a place's coordinates don't move.
 * Same vendor as the (eventual) real weather call, so one integration covers
 * both.
 */
export async function geocodePlace(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" +
    encodeURIComponent(query)
  const res = await fetch(url, { next: { revalidate: 86400 } })
  if (!res.ok) return null
  const data = (await res.json()) as GeocodeResponse
  const top = data.results?.[0]
  return top ? { lat: top.latitude, lng: top.longitude } : null
}
