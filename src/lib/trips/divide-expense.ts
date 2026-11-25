/** `totalCents` in `parts` near-equal shares that sum back to it; the leftover
 * cents go one each on the first shares. */
export function splitCents(totalCents: number, parts: number): number[] {
  const base = Math.floor(totalCents / parts)
  const leftover = totalCents - base * parts
  return Array.from({ length: parts }, (_, i) => base + (i < leftover ? 1 : 0))
}

/** The days a divided expense starts on: the location's days, or the whole
 * trip when no location is set (or it has no days). Accommodation drops the
 * last day -- nights, not days -- unless that would leave none. */
export function defaultDivideDays(
  days: { dayDate: string; locationId: string | null }[],
  locationId: string | null,
  category: string,
): string[] {
  const all = days.map((d) => d.dayDate).sort()
  const here = days
    .filter((d) => d.locationId === locationId)
    .map((d) => d.dayDate)
    .sort()
  const picked = locationId !== null && here.length > 0 ? here : all
  return category === "Accommodation" && picked.length > 1
    ? picked.slice(0, -1)
    : picked
}
