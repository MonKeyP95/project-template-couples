/**
 * Every rate against `base`, from open.er-api.com (free, no key). One call
 * returns ~161 currencies, so a conversion is local arithmetic rather than a
 * request. Cached a day. Returns null if the call fails -- the caller offers
 * home-currency entry only rather than inventing a rate.
 *
 * The response is keyed **foreign per one base unit**: with base=DKK,
 * `rates.THB === 5.122502` means 1 DKK = 5.122502 THB. Invert it with
 * `inverseRate` before storing.
 *
 * Chosen over Frankfurter, which is ECB-only (29 currencies, no VND/EGP/MAD).
 */
export async function getRates(
  base: string,
): Promise<Record<string, number> | null> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    next: { revalidate: 86400 },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.result === "success" ? data.rates : null
}
