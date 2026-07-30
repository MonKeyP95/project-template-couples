"use client"

import * as React from "react"

import { useCurrency } from "@/components/currency-context"
import { currencyOptions } from "@/lib/fx/currency-list"
import { inverseRate, toHomeCents } from "@/lib/fx/convert"
import { money } from "@/lib/money"

export interface CurrencyChipProps {
  /** The currency the amount is being entered in. */
  value: string
  onChange: (code: string) => void
  /** The raw amount field text, for the live preview. */
  amount: string
  /** Currencies any location on this trip uses, for the shortlist. */
  tripCurrencies: string[]
  disabled?: boolean
}

/**
 * Currency selector plus a live home-currency preview, for the expense entry
 * forms.
 *
 * Renders **nothing** when the amount is already in the trip's currency and
 * there is nothing else to pick, so a DKK expense on a DKK trip pays no UI cost
 * for a feature it is not using. The preview is arithmetic on a rate table
 * already in memory, not a request -- and it is a preview only: the server
 * action recomputes authoritatively at save, so a stale client cannot write a
 * bad rate.
 */
export function CurrencyChip({
  value,
  onChange,
  amount,
  tripCurrencies,
  disabled,
}: CurrencyChipProps) {
  const { currency, rates } = useCurrency()

  // No rates means no honest conversion, so the trip currency is the only
  // offer -- and if that is all there is, there is nothing to pick.
  const codes = React.useMemo(() => {
    if (!rates) return [currency]
    const near = [currency, ...tripCurrencies.filter((c) => c !== currency)]
    const rest = currencyOptions()
      .map((o) => o.code)
      .filter((c) => !near.includes(c) && rates[c] !== undefined)
    return [...near, ...rest]
  }, [rates, currency, tripCurrencies])

  if (value === currency && codes.length === 1) return null

  const foreignPerHome = rates?.[value]
  const amountNum = Number(amount)
  const previewCents =
    value !== currency &&
    foreignPerHome &&
    Number.isFinite(amountNum) &&
    amountNum > 0
      ? toHomeCents(Math.round(amountNum * 100), inverseRate(foreignPerHome))
      : null

  return (
    <span className="flex shrink-0 flex-col gap-0.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Currency"
        className="w-[4.5rem] shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground disabled:opacity-50"
      >
        {codes.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {previewCents === null ? null : (
        <span className="font-mono text-[10px] whitespace-nowrap text-muted-foreground">
          ~ {money(previewCents, currency)}
        </span>
      )}
    </span>
  )
}
