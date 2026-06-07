"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { type Expense } from "@/lib/trips/expense-types"
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

export function Ledger({
  expenses,
  moves,
  members,
  tripSlug,
  locations,
  itineraryDays,
}: {
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
}) {
  const [expanded, setExpanded] = React.useState(false)
  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))
  const hasLocations = locations.length > 0
  const items = [
    ...expenses.map((e) => ({ kind: "expense" as const, at: e.createdAt, expense: e })),
    ...moves.map((m) => ({ kind: "move" as const, at: m.createdAt, move: m })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return (
    <div className="border-t border-border bg-background">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between border-0 bg-transparent px-5 pt-4 pb-1.5 text-left"
      >
        <Label>Ledger · {expenses.length}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {expanded ? "most recent" : "show"}
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
                locationChip={
                  hasLocations
                    ? effectiveLocation(item.expense, dayMap, locationsById)
                    : undefined
                }
              />
            ) : (
              <BudgetMoveRow
                key={`m-${item.move.id}`}
                move={item.move}
                locationsById={locationsById}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}
