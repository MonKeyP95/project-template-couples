"use client"

import * as React from "react"

import { useCurrency } from "@/components/currency-context"
import { currencyOptions } from "@/lib/fx/currency-list"
import { inverseRate, toHomeCents } from "@/lib/fx/convert"
import { useMoney } from "@/components/money-context"
import { cn } from "@/lib/utils"
import { parseAmount } from "@/lib/money"

export interface CurrencyChipProps {
  /** The currency the amount is being entered in. */
  value: string
  onChange: (code: string) => void
  /** The raw amount field text, for the live preview. */
  amount: string
  /** Currencies any location on this trip uses, for the shortlist. */
  tripCurrencies: string[]
  disabled?: boolean
  /** Lays out the select and its preview; defaults to stacked. */
  className?: string
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
  className = "flex-col gap-0.5",
}: CurrencyChipProps) {
  const { money } = useMoney()
  const { currency, spendCurrency, rates } = useCurrency()
  const [showAll, setShowAll] = React.useState(false)

  // No rates means no honest conversion, so the home currency is the only
  // offer -- and if that is all there is, there is nothing to pick.
  // The shortlist: spend (local) first, then home, then any location's.
  const near = React.useMemo(
    () => (rates ? Array.from(new Set([spendCurrency, currency, ...tripCurrencies])) : [currency]),
    [rates, currency, spendCurrency, tripCurrencies],
  )
  const rest = React.useMemo(
    () =>
      rates
        ? currencyOptions()
            .map((o) => o.code)
            .filter((c) => !near.includes(c) && rates[c] !== undefined)
        : [],
    [rates, near],
  )
  const pills = near.includes(value) ? near : [...near, value]

  if (value === currency && near.length === 1 && rest.length === 0) return null

  const foreignPerHome = rates?.[value]
  const amountNum = parseAmount(amount)
  const previewCents =
    value !== currency &&
    foreignPerHome &&
    Number.isFinite(amountNum) &&
    amountNum > 0
      ? toHomeCents(Math.round(amountNum * 100), inverseRate(foreignPerHome))
      : null

  return (
    <span className={cn("flex shrink-0", className)}>
      {showAll ? (
        <select
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setShowAll(false)
          }}
          disabled={disabled}
          aria-label="Currency"
          autoFocus
          className="w-[4.5rem] shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground disabled:opacity-50"
        >
          {[...near, ...rest].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <span role="radiogroup" aria-label="Currency" className="flex shrink-0 items-center gap-1">
          {pills.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === value}
              onClick={() => onChange(c)}
              disabled={disabled}
              className={`rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] disabled:opacity-50 ${
                c === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
          {rest.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              disabled={disabled}
              aria-label="Other currency"
              className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              other
            </button>
          ) : null}
        </span>
      )}
      {previewCents === null ? null : (
        <span className="font-mono text-[10px] whitespace-nowrap text-muted-foreground">
          ~ {money(previewCents, currency)}
        </span>
      )}
    </span>
  )
}
