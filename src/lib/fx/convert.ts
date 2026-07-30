/**
 * Pure currency arithmetic. No I/O, no formatting -- importable from a client
 * component and from a server action alike.
 *
 * `fxRate` throughout is **home units per one foreign unit**. The rates API
 * gives the opposite direction, so `inverseRate` is the boundary between the
 * two conventions and every other function here assumes the stored one.
 */

/** API direction (foreign per one home unit) -> stored direction. */
export function inverseRate(foreignPerHome: number): number {
  return 1 / foreignPerHome
}

/** Foreign cents at a stored rate -> home cents. Rounded to a whole cent. */
export function toHomeCents(amountCents: number, fxRate: number): number {
  return Math.round(amountCents * fxRate)
}

/**
 * The rate implied by a corrected pair of amounts. Used when the user edits the
 * home amount to the figure their bank actually charged: the rate that applied
 * to *this transaction* is whatever makes the two amounts agree, fees included.
 */
export function rateFromAmounts(
  amountCents: number,
  homeAmountCents: number,
): number {
  return homeAmountCents / amountCents
}
