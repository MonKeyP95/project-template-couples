"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import {
  byCategoryLines,
  PRE_TRIP,
  type CategoryLine,
} from "@/lib/trips/budget-by-category-types"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import {
  homeCents,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import type { MemberToneEntry } from "./packing-tab"

const SPENT_SHOWN = 5

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
})

function displayName(category: string): string {
  return category === PRE_TRIP ? "Before you go" : category
}

interface Props {
  expenses: Expense[]
  budgetItems: BudgetItem[]
  categories: ExpenseCategoryRow[]
  locations: ItineraryLocation[]
  members: Record<string, MemberToneEntry>
  tripStarted: boolean
}

/** Read-only spent-vs-plan per category, under the Spent figure. Tap a line
 * to see the planned items and expenses behind it. */
export function BudgetByCategory(props: Props) {
  const { currency } = useCurrency()
  const [open, setOpen] = React.useState<string | null>(null)
  if (props.budgetItems.length === 0) return null

  const fmt = (cents: number) => money(cents, currency)
  const { lines, preTripFootCents } = byCategoryLines(
    props.expenses.map((e) => ({
      category: e.category,
      isSettlement: e.isSettlement,
      amountCents: homeCents(e),
    })),
    props.budgetItems,
    props.categories.map((c) => c.name),
    props.tripStarted,
  )

  return (
    <div className="mt-4 border-t border-rule pt-3">
      <Label>By category</Label>
      <div className="mt-1">
        {lines.map((line) => (
          <CategoryRow
            key={line.category}
            line={line}
            isOpen={open === line.category}
            onToggle={() =>
              setOpen(open === line.category ? null : line.category)
            }
            fmt={fmt}
          >
            <CategoryDetail category={line.category} fmt={fmt} {...props} />
          </CategoryRow>
        ))}
      </div>
      {preTripFootCents > 0 ? (
        <div className="mt-2 flex justify-between border-t border-dashed border-border pt-2 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          <span>+ paid before the trip</span>
          <span className="t-num">{fmt(preTripFootCents)}</span>
        </div>
      ) : null}
    </div>
  )
}

const NOTE_CLASS = "font-mono text-[9px] uppercase tracking-[0.14em]"

function StatusNote({
  line,
  fmt,
}: {
  line: CategoryLine
  fmt: (cents: number) => string
}) {
  if (line.status === "over") {
    return (
      <span className={`${NOTE_CLASS} text-clay`}>
        {fmt(line.actualCents - line.plannedCents)} over
      </span>
    )
  }
  if (line.status === "unplanned") {
    return <span className={`${NOTE_CLASS} text-clay`}>unplanned</span>
  }
  if (line.status === "paidAhead") {
    return <span className={`${NOTE_CLASS} text-moss`}>paid in advance</span>
  }
  return null
}

function CategoryRow({
  line,
  isOpen,
  onToggle,
  fmt,
  children,
}: {
  line: CategoryLine
  isOpen: boolean
  onToggle: () => void
  fmt: (cents: number) => string
  children: React.ReactNode
}) {
  const warn = line.status === "over" || line.status === "unplanned"
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="grid w-full grid-cols-[10px_minmax(0,7rem)_1fr_auto] items-center gap-x-2.5 py-1.5 text-left"
      >
        <span
          className={`text-[8px] text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
        >
          {"▶"}
        </span>
        <span className="truncate text-[13px] text-foreground">
          {displayName(line.category)}
        </span>
        <Bar pct={line.pct} tone={warn ? "clay" : "sea"} />
        <span className="t-num whitespace-nowrap text-right font-mono text-[11px] text-foreground">
          {fmt(line.actualCents)}
          {line.status === "unplanned" ? null : (
            <span className="text-muted-foreground"> / {fmt(line.plannedCents)}</span>
          )}
        </span>
        <span className="col-start-3 col-end-5">
          <StatusNote line={line} fmt={fmt} />
        </span>
      </button>
      {isOpen ? children : null}
    </div>
  )
}

function CategoryDetail({
  category,
  fmt,
  expenses,
  budgetItems,
  locations,
  members,
}: Props & { category: string; fmt: (cents: number) => string }) {
  const placeName = new Map(locations.map((l) => [l.id, l.name]))
  const planned = budgetItems.filter((it) => it.category === category)
  const spent = expenses
    .filter((e) => !e.isSettlement && e.category === category)
    .sort((a, b) =>
      (b.dayDate ?? b.createdAt).localeCompare(a.dayDate ?? a.createdAt),
    )

  return (
    <div className="mb-2 ml-5 flex flex-col gap-3 rounded-lg bg-sea-tint px-3 py-2.5">
      {planned.length > 0 ? (
        <DetailList title="Planned">
          {planned.map((it) => (
            <DetailLine key={it.id} amount={fmt(it.amountCents)}>
              {it.subject || displayName(category)}
              <span className="text-muted-foreground">
                {" · "}
                {it.locationId ? placeName.get(it.locationId) : "Trip-wide"}
              </span>
              <span
                className={`ml-1.5 ${NOTE_CLASS} ${it.paidExpenseId ? "text-moss" : "text-muted-foreground"}`}
              >
                {it.paidExpenseId ? "paid" : "not yet"}
              </span>
            </DetailLine>
          ))}
        </DetailList>
      ) : null}
      {spent.length > 0 ? (
        <DetailList title="Spent">
          {spent.slice(0, SPENT_SHOWN).map((e) => (
            <DetailLine key={e.id} amount={fmt(homeCents(e))}>
              {e.title}
              <span className="text-muted-foreground">
                {" · "}
                {SHORT_DATE.format(new Date(e.dayDate ?? e.createdAt))}
                {" · "}
                {members[e.paidBy]?.displayName ?? "Someone"}
              </span>
            </DetailLine>
          ))}
          {spent.length > SPENT_SHOWN ? (
            <div className="border-t border-border pt-1.5 text-[12px] text-muted-foreground">
              + {spent.length - SPENT_SHOWN} more
            </div>
          ) : null}
        </DetailList>
      ) : null}
    </div>
  )
}

function DetailList({
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

function DetailLine({
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
