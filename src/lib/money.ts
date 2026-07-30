const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, decimals: 0 | 2): Intl.NumberFormat {
  const key = `${currency}:${decimals}`
  const cached = formatters.get(key)
  if (cached) return cached
  // narrowSymbol so DKK renders "kr" rather than "DKK"; omitting the fraction
  // options lets Intl use each currency's own minor-unit count, which is what
  // makes JPY and VND come out with no decimals at all.
  const made = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    ...(decimals === 0
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : {}),
  })
  formatters.set(key, made)
  return made
}

/**
 * Cents as a currency-marked amount: (9761, "DKK") -> "kr 97.61". Decimals
 * follow the currency, so (50000, "JPY") -> "¥500". `cents` is always
 * hundredths of the currency unit, including for zero-decimal currencies.
 * Formatters are cached because constructing one per render is measurably slow.
 */
export function money(cents: number, currency: string): string {
  return formatter(currency, 2).format(cents / 100)
}

/** As `money` but whole units: (123456, "DKK") -> "kr 1,235". */
export function moneyRounded(cents: number, currency: string): string {
  return formatter(currency, 0).format(cents / 100)
}

/** Cents for an editable amount field: 123456 -> "1234.56". No separators — a
 * grouped string is invalid in `<input type="number">` (renders blank) and
 * parses back as NaN, so an edit would drop the price. */
export function moneyInput(cents: number): string {
  return String(Math.round(cents) / 100)
}

/** The bare symbol for an input prefix: "DKK" -> "kr", "THB" -> "฿". */
export function currencySymbol(currency: string): string {
  const part = formatter(currency, 2)
    .formatToParts(0)
    .find((p) => p.type === "currency")
  return part?.value ?? currency
}

const grouped2 = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const grouped0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 })

/** Deprecated: euro-only, symbol-less. Callers move to `money`. */
export function euro(cents: number): string {
  return grouped2.format(cents / 100)
}

/** Deprecated: euro-only, symbol-less. Callers move to `moneyRounded`. */
export function euroRounded(cents: number): string {
  return grouped0.format(cents / 100)
}

/** Deprecated alias of `moneyInput`. */
export function euroInput(cents: number): string {
  return moneyInput(cents)
}
