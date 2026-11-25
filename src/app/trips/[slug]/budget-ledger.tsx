"use client"

import * as React from "react"

import { Avatar, Label, categoryToneOf } from "@/components/together"
import {
  homeCents,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import { groupByDay } from "@/lib/trips/ledger-days"
import { type SavingsContribution } from "@/lib/trips/savings-types"
import type { Receipt } from "@/lib/trips/receipt-types"
import { deleteSavingsContribution } from "@/lib/trips/actions"
import {
  dayLocationMap,
  effectiveLocation,
  type BudgetMove,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import { type ItineraryLocation } from "@/lib/trips/location-types"
import { money } from "@/lib/money"
import { useCurrency } from "@/components/currency-context"

import { BudgetMoveRow } from "./budget-move-row"
import { LedgerRow } from "./ledger-row"
import type { MemberToneEntry } from "./packing-tab"

const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function savingDate(iso: string): { mon: string; day: string } {
  const d = new Date(iso)
  return { mon: MONTH_SHORT.format(d).toUpperCase(), day: String(d.getUTCDate()) }
}

/** Savings contribution row, styled like the main-ledger expense row. */
function SavingsLedgerRow({
  saving,
  member,
  tripSlug,
}: {
  saving: SavingsContribution
  member: MemberToneEntry | undefined
  tripSlug: string
}) {
  const { currency } = useCurrency()
  const date = savingDate(saving.createdAt)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function remove() {
    if (isPending) return
    if (!confirm("Delete this contribution?")) return
    startTransition(async () => {
      const result = await deleteSavingsContribution(saving.id, tripSlug)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div
      className={`grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border px-5 py-3 ${
        isPending ? "opacity-50" : ""
      }`}
    >
      <div className="text-center">
        <div className="font-mono text-[18px] leading-none tracking-[-0.02em] text-foreground">
          {date.day}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {date.mon}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {member ? <Avatar name={member.initial} size={16} tone={member.tone} /> : null}
        <div>
          <div className="text-[14px] tracking-[-0.005em] text-foreground">
            {member?.displayName ?? "Someone"}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            saved
          </div>
          {error ? (
            <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="t-num text-[15px] text-moss">
          {"+"}
          {money(saving.amountCents, currency)}
        </span>
        <button
          type="button"
          onClick={remove}
          disabled={isPending}
          aria-label="Delete contribution"
          className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
    </div>
  )
}

const DAY_HEADER = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

/** A framed ledger group with a header line and an optional total. */
function DayBox({
  title,
  total,
  children,
}: {
  title: string
  total?: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border bg-muted/40 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground">
          {title}
        </span>
        {total ? (
          <span className="t-num font-mono text-[11px] text-muted-foreground">{total}</span>
        ) : null}
      </div>
      <div className="[&>*:first-child]:border-t-0">{children}</div>
    </div>
  )
}

export function Ledger({
  expenses,
  moves,
  members,
  tripSlug,
  locations,
  itineraryDays,
  categories,
  today,
  contributions = [],
  receipts = [],
  label = "Ledger",
  defaultExpanded = true,
  bare = false,
}: {
  expenses: Expense[]
  /** The viewer's local today: past days sort before it, future days after. */
  today: string
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  categories: ExpenseCategoryRow[]
  /** When supplied, savings contributions interleave by date as "saved" rows. */
  contributions?: SavingsContribution[]
  /** The trip's receipts; rows show a marker for the ones attached to them. */
  receipts?: Receipt[]
  label?: string
  defaultExpanded?: boolean
  /** Card-friendly styling: soft top divider, transparent background. */
  bare?: boolean
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const { currency } = useCurrency()
  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))
  const hasLocations = locations.length > 0
  const receiptsByExpense = new Map<string, Receipt[]>()
  for (const r of receipts) {
    if (r.expenseId) receiptsByExpense.set(r.expenseId, [...(receiptsByExpense.get(r.expenseId) ?? []), r])
  }
  const categoryNames = categories.map((c) => c.name)
  const days = groupByDay(
    expenses.map((e) => ({ ...e, cents: homeCents(e) })),
    today,
  )
  // Savings and moves have no trip day, so they get their own box.
  const others = [
    ...moves.map((m) => ({ kind: "move" as const, at: m.createdAt, move: m })),
    ...contributions.map((c) => ({ kind: "saving" as const, at: c.createdAt, saving: c })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const count = expenses.length + others.length

  return (
    <div className={bare ? "border-t border-rule" : "border-t border-border bg-background"}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between border-0 bg-transparent px-5 pt-4 pb-1.5 text-left"
      >
        <Label>
          {label} · {count}
        </Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {expanded ? "hide" : "show"}
        </span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-3 px-4 pt-1.5 pb-4">
          {days.map((day) => (
            <DayBox
              key={day.dayDate ?? "undated"}
              title={day.dayDate ? DAY_HEADER.format(new Date(`${day.dayDate}T00:00:00Z`)) : "Undated"}
              total={money(day.totalCents, currency)}
            >
              {day.rows.map((expense) => (
                <LedgerRow
                  key={expense.id}
                  expense={expense}
                  members={members}
                  tripSlug={tripSlug}
                  locations={locations}
                  categories={categories}
                  tone={categoryToneOf(expense.category, categoryNames)}
                  locationChip={
                    hasLocations
                      ? effectiveLocation(expense, dayMap, locationsById)
                      : undefined
                  }
                  receipts={receiptsByExpense.get(expense.id)}
                />
              ))}
            </DayBox>
          ))}
          {others.length > 0 ? (
            <DayBox title="Savings & moves">
              {others.map((item) =>
                item.kind === "move" ? (
                  <BudgetMoveRow
                    key={`m-${item.move.id}`}
                    move={item.move}
                    locationsById={locationsById}
                  />
                ) : (
                  <SavingsLedgerRow
                    key={`s-${item.saving.id}`}
                    saving={item.saving}
                    member={members[item.saving.userId]}
                    tripSlug={tripSlug}
                  />
                ),
              )}
            </DayBox>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
