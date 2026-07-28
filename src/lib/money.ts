const grouped2 = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const grouped0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 })

/** Cents as euros with thousands separators and cents: 123456 -> "1,234.56". */
export function euro(cents: number): string {
  return grouped2.format(cents / 100)
}

/** Cents as whole euros with thousands separators: 123456 -> "1,235". */
export function euroRounded(cents: number): string {
  return grouped0.format(cents / 100)
}
