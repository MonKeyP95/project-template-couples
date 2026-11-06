interface Point {
  lat: number
  lng: number
}

/** Great-circle distance in km. */
export function distanceKm(a: Point, b: Point): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/** The `n` places closest to `origin`, nearest first, each with its distance. */
export function nearest<T extends Point>(
  places: T[],
  origin: Point,
  n: number,
): (T & { distanceKm: number })[] {
  return places
    .map((p) => ({ ...p, distanceKm: distanceKm(origin, p) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n)
}
