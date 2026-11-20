import * as React from "react"

import { Label } from "@/components/together"
import { PRE_TRIP } from "@/lib/trips/budget-by-category-types"

export const NOTE_CLASS = "font-mono text-[9px] uppercase tracking-[0.14em]"

export function displayName(category: string): string {
  return category === PRE_TRIP ? "Before you go" : category
}

export function DetailList({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <Label>{title}</Label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

export function DetailLine({
  amount,
  children,
}: {
  amount: string
  children: React.ReactNode
}) {
  return (
    <div className="flex justify-between gap-3 border-t border-border py-1.5 text-[12px] text-foreground first:border-t-0">
      <span className="min-w-0">{children}</span>
      <span className="t-num whitespace-nowrap font-mono text-[11px]">{amount}</span>
    </div>
  )
}
