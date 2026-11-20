"use client"

import * as React from "react"

interface CurrencyValue {
  /**
   * Where the bank account is. Every stored home amount, and therefore every
   * total, is in this. Frozen on the trip at creation.
   */
  currency: string
  /**
   * What you spend on this trip -- the expense-entry default, and the unit the
   * secondary "local" figure beside a total is shown in. Equal to `currency`
   * on a trip you both spend and bank in the same money.
   */
  spendCurrency: string
  /** What an expense form opens in: home before the trip, spend during it. */
  entryCurrency: string
  /**
   * Foreign units per one unit of `currency`, or null when the rates call
   * failed. Null means the entry chip offers the home currency only, and no
   * local equivalent is shown.
   */
  rates: Record<string, number> | null
}

const CurrencyContext = React.createContext<CurrencyValue>({
  currency: "EUR",
  spendCurrency: "EUR",
  entryCurrency: "EUR",
  rates: null,
})

export function CurrencyProvider({
  currency,
  spendCurrency,
  entryCurrency,
  rates,
  children,
}: {
  currency: string
  spendCurrency: string
  entryCurrency: string
  rates: Record<string, number> | null
  children: React.ReactNode
}) {
  const value = React.useMemo(
    () => ({ currency, spendCurrency, entryCurrency, rates }),
    [currency, spendCurrency, entryCurrency, rates],
  )
  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency(): CurrencyValue {
  return React.useContext(CurrencyContext)
}
