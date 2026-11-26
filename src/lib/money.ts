export const DEFAULT_LOCALE = "en-GB"

let regionCodes: Map<string, string> | null = null

/** Lowercase English region name -> ISO code, plus each code -> itself. */
function regions(): Map<string, string> {
  if (regionCodes) return regionCodes
  const names = new Intl.DisplayNames("en", { type: "region", fallback: "none" })
  const made = new Map<string, string>()
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      const name = names.of(code)
      if (!name) continue
      made.set(name.toLowerCase(), code)
      made.set(code.toLowerCase(), code)
    }
  }
  regionCodes = made
  return made
}

/**
 * The number locale for a free-text home country: "Denmark" or "DK" ->
 * "da-DK". The language is the country's most likely one per Intl. Blank or
 * unrecognised -> "en-GB".
 */
export function countryLocale(country: string): string {
  const code = regions().get(country.trim().toLowerCase())
  if (!code) return DEFAULT_LOCALE
  return `${new Intl.Locale(`und-${code}`).maximize().language}-${code}`
}

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(
  currency: string,
  decimals: 0 | 2,
  locale: string,
): Intl.NumberFormat {
  const key = `${locale}:${currency}:${decimals}`
  const cached = formatters.get(key)
  if (cached) return cached
  // narrowSymbol so DKK renders "kr" rather than "DKK"; omitting the fraction
  // options lets Intl use each currency's own minor-unit count, which is what
  // makes JPY and VND come out with no decimals at all.
  const made = new Intl.NumberFormat(locale, {
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
 * Cents as a currency-marked amount: (9761, "DKK", "en-GB") -> "kr 97.61",
 * with "da-DK" -> "97,61 kr.". Decimals follow the currency, so JPY has none.
 * `cents` is always hundredths of the currency unit, including for
 * zero-decimal currencies. Formatters are cached because constructing one per
 * render is measurably slow.
 */
export function money(
  cents: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return formatter(currency, 2, locale).format(cents / 100)
}

/** As `money` but whole units: (123456, "DKK", "en-GB") -> "kr 1,235". */
export function moneyRounded(
  cents: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return formatter(currency, 0, locale).format(cents / 100)
}

/** Cents for an editable amount field, in the locale's decimal mark but with
 * no grouping: (123456, "da-DK") -> "1234,56". `parseAmount` reads it back. */
export function moneyInput(cents: number, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 2,
  }).format(Math.round(cents) / 100)
}

/** A typed amount with either decimal mark: "12,50" and "12.50" -> 12.5.
 * Blank -> 0, anything else unparseable -> NaN, as `Number` does. */
export function parseAmount(text: string): number {
  return Number(text.trim().replaceAll(",", "."))
}

/**
 * The number alone, with the currency's own decimal rules but no symbol:
 * (123456, "DKK", "en-GB") -> "1,234.56", (50000, "JPY") -> "500".
 *
 * For the few display figures that style the symbol separately from the number
 * (a small muted symbol beside a large numeral). Pairing `money` with a
 * `currencySymbol` span would print the symbol twice.
 */
export function moneyPlain(
  cents: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const parts = formatter(currency, 2, locale).formatToParts(cents / 100)
  return parts
    .filter((p) => p.type !== "currency" && p.type !== "literal")
    .map((p) => p.value)
    .join("")
}

export interface MoneyFns {
  locale: string
  money(cents: number, currency: string): string
  moneyRounded(cents: number, currency: string): string
  moneyPlain(cents: number, currency: string): string
  moneyInput(cents: number): string
  currencySymbol(currency: string): string
}

/** The formatters with `locale` already applied. */
export function bindMoney(locale: string): MoneyFns {
  return {
    locale,
    money: (c, cur) => money(c, cur, locale),
    moneyRounded: (c, cur) => moneyRounded(c, cur, locale),
    moneyPlain: (c, cur) => moneyPlain(c, cur, locale),
    moneyInput: (c) => moneyInput(c, locale),
    currencySymbol: (cur) => currencySymbol(cur, locale),
  }
}

/** The bare symbol for an input prefix: "DKK" -> "kr", "THB" -> "฿". */
export function currencySymbol(
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const part = formatter(currency, 2, locale)
    .formatToParts(0)
    .find((p) => p.type === "currency")
  return part?.value ?? currency
}
