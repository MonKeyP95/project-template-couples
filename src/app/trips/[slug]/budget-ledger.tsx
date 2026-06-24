"use client"

import * as React from "react"

import { Avatar, Label } from "@/components/together"
import {
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import { type SavingsContribution } from "@/lib/trips/savings-types"
import {
  dayLocationMap,
  effectiveLocation,
  type BudgetMove,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import { type ItineraryLocation } from "@/lib/trips/location-types"

import { BudgetMoveRow } from "./budget-move-row"
import { LedgerRow } from "./ledger-row"
import type { MemberToneEntry } from "./packing-tab"

const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

function savingDate(iso: string): { mon: string; day: string } {
  const d = new Date(iso)
  return { mon: MONTH_SHORT.format(d).toUpperCase(), day: String(d.getUTCDate()) }
}

/** Read-only savings contribution row, styled like the main-ledger expense row. */
function SavingsLedgerRow({
  saving,
  member,
}: {
  saving: SavingsContribution
  member: MemberToneEntry | undefined
}) {
  const date = savingDate(saving.createdAt)
  return (
    <div className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border px-5 py-3">
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
        </div>
      </div>
      <div className="t-num text-[15px] text-moss">+€{fmt(saving.amountCents)}</div>
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
  contributions = [],
  label = "Ledger",
  defaultExpanded = true,
  bare = false,
}: {
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  categories: ExpenseCategoryRow[]
  /** When supplied, savings contributions interleave by date as "saved" rows. */
  contributions?: SavingsContribution[]
  label?: string
  defaultExpanded?: boolean
  /** Card-friendly styling: soft top divider, transparent background. */
  bare?: boolean
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))
  const hasLocations = locations.length > 0
  const items = [
    ...expenses.map((e) => ({ kind: "expense" as const, at: e.createdAt, expense: e })),
    ...moves.map((m) => ({ kind: "move" as const, at: m.createdAt, move: m })),
    ...contributions.map((c) => ({ kind: "saving" as const, at: c.createdAt, saving: c })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return (
    <div className={bare ? "border-t border-rule" : "border-t border-border bg-background"}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between border-0 bg-transparent px-5 pt-4 pb-1.5 text-left"
      >
        <Label>
          {label} · {items.length}
        </Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {expanded ? "hide" : "show"}
        </span>
      </button>
      {expanded ? (
        <div>
          {items.map((item) =>
            item.kind === "expense" ? (
              <LedgerRow
                key={`e-${item.expense.id}`}
                expense={item.expense}
                members={members}
                tripSlug={tripSlug}
                locations={locations}
                categories={categories}
                locationChip={
                  hasLocations
                    ? effectiveLocation(item.expense, dayMap, locationsById)
                    : undefined
                }
              />
            ) : item.kind === "move" ? (
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
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}
