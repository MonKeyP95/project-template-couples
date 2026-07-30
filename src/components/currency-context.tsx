"use client"

import * as React from "react"

interface CurrencyValue {
  /** The trip's reporting currency. Every displayed total is in this. */
  currency: string
  /**
   * Foreign units per one unit of `currency`, or null when the rates call
   * failed. Null means the entry chip offers the trip currency only.
   */
  rates: Record<string, number> | null
}

const CurrencyContext = React.createContext<CurrencyValue>({
  currency: "EUR",
  rates: null,
})

export function CurrencyProvider({
  currency,
  rates,
  children,
}: {
  currency: string
  rates: Record<string, number> | null
  children: React.ReactNode
}) {
  const value = React.useMemo(() => ({ currency, rates }), [currency, rates])
  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency(): CurrencyValue {
  return React.useContext(CurrencyContext)
}
