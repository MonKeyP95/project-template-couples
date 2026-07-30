"use client"

import { inverseRate, toHomeCents } from "@/lib/fx/convert"
import { money } from "@/lib/money"

import { useCurrency } from "./currency-context"

/**
 * The local-currency equivalent of a home-currency total, e.g. "~ ₪2,500"
 * beneath "kr 1,240" on a trip you bank in DKK but spend in ILS.
 *
 * Renders nothing when the trip spends and banks in the same money, or when no
 * rate is available -- there is no second unit to show.
 *
 * Always prefixed "~". Totals are summed from each expense's stored home
 * amount, so the home figure is exact and this one is a conversion at today's
 * rate; on a trip mixing several spend currencies they will not reconcile to
 * the penny, and pretending otherwise would be the dishonest choice.
 */
export function LocalEquivalent({
  homeCents,
  className = "",
}: {
  homeCents: number
  className?: string
}) {
  const { currency, spendCurrency, rates } = useCurrency()
  if (spendCurrency === currency) return null
  const foreignPerHome = rates?.[spendCurrency]
  if (!foreignPerHome) return null
  // rates are foreign-per-home, which is the direction we want here: this is
  // the one place converting home -> local rather than local -> home.
  const localCents = toHomeCents(homeCents, 1 / inverseRate(foreignPerHome))
  return (
    <span className={`font-mono text-muted-foreground ${className}`}>
      ~ {money(localCents, spendCurrency)}
    </span>
  )
}
