/**
 * Every ISO currency the runtime knows, with a readable label. Derived from
 * Intl rather than a hand-kept table, so it cannot drift. Sorted by code.
 */
export interface CurrencyOption {
  code: string
  /** "DKK — Danish Krone" */
  label: string
}

let cached: CurrencyOption[] | null = null

export function currencyOptions(): CurrencyOption[] {
  if (cached) return cached
  const names = new Intl.DisplayNames(["en-GB"], { type: "currency" })
  cached = Intl.supportedValuesOf("currency").map((code) => ({
    code,
    label: `${code} — ${names.of(code) ?? code}`,
  }))
  return cached
}
