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
  rates: null,
})

export function CurrencyProvider({
  currency,
  spendCurrency,
  rates,
  children,
}: {
  currency: string
  spendCurrency: string
  rates: Record<string, number> | null
  children: React.ReactNode
}) {
  const value = React.useMemo(
    () => ({ currency, spendCurrency, rates }),
    [currency, spendCurrency, rates],
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
