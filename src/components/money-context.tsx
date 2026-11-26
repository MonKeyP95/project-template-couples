"use client"

import * as React from "react"

import { bindMoney, DEFAULT_LOCALE, type MoneyFns } from "@/lib/money"

const MoneyContext = React.createContext<MoneyFns>(bindMoney(DEFAULT_LOCALE))

/** Supplies the couple's number locale (from home country) to `useMoney`. */
export function MoneyProvider({
  locale,
  children,
}: {
  locale: string
  children: React.ReactNode
}) {
  const value = React.useMemo(() => bindMoney(locale), [locale])
  return <MoneyContext value={value}>{children}</MoneyContext>
}

/** Money formatters bound to the couple's locale. */
export function useMoney(): MoneyFns {
  return React.useContext(MoneyContext)
}
