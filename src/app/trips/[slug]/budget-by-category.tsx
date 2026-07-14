"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { perCategoryRollup } from "@/lib/trips/budget-rollup-types"
import type { Expense, ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import {
  dayLocationMap,
  effectiveLocation,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

import { LedgerRow } from "./ledger-row"
import type { MemberToneEntry } from "./packing-tab"

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

/** Read-first per-category planned-vs-actual, collapsible off the total bar.
 * Level 1 = category rows (spent/planned + variance); Level 2 = that
 * category's expenses via the shared LedgerRow. Read-only summary of data
 * already on the page — no server calls of its own. */
export function BudgetByCategory({
  expenses,
  budgetItems,
  categories,
  members,
  tripSlug,
  locations,
  itineraryDays,
}: {
  expenses: Expense[]
  budgetItems: BudgetItem[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
}) {
  const [open, setOpen] = React.useState(false)
  const [openCat, setOpenCat] = React.useState<string | null>(null)

  const catOrder = categories.map((c) => c.name)
  const rollup = perCategoryRollup(expenses, budgetItems, catOrder)

  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))
  const hasLocations = locations.length > 0

  return (
    <div className="border-t border-rule">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between border-0 bg-transparent px-5 pt-4 pb-1.5 text-left"
      >
        <Label>By category · {rollup.length}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {open ? "hide" : "show"}
        </span>
      </button>
      {open ? (
        <div className="pb-2">
          {rollup.map((r) => {
            const variance = r.actualCents - r.plannedCents
            const over = variance > 0
            const pct =
              r.plannedCents > 0
                ? Math.min(100, Math.round((r.actualCents / r.plannedCents) * 100))
                : 0
            const catExpenses = expenses.filter(
              (e) => !e.isSettlement && e.category === r.category,
            )
            const isOpen = openCat === r.category
            return (
              <div key={r.category} className="border-t border-rule">
                <button
                  type="button"
                  onClick={() =>
                    setOpenCat((c) => (c === r.category ? null : r.category))
                  }
                  aria-expanded={isOpen}
                  className="w-full border-0 bg-transparent px-5 py-2.5 text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-serif text-[14px] italic text-foreground">
                      {r.category}
                    </span>
                    <span className="font-mono text-[11px]">
                      <span className="text-muted-foreground">
                        spent €{fmt(r.actualCents)} /{" "}
                      </span>
                      <span className="text-foreground">€{fmt(r.plannedCents)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Bar pct={pct} tone={over ? "clay" : "sea"} />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[10px] tracking-[0.06em]">
                    <span className="text-muted-foreground">
                      {r.plannedCents > 0 ? `${pct}% of planned` : "no plan"}
                    </span>
                    <span className={over ? "text-clay" : "text-muted-foreground"}>
                      {variance === 0
                        ? "on plan"
                        : over
                          ? `+€${fmt(variance)} over`
                          : `€${fmt(-variance)} under`}
                    </span>
                  </div>
                </button>
                {isOpen ? (
                  catExpenses.length > 0 ? (
                    <div>
                      {catExpenses.map((e) => (
                        <LedgerRow
                          key={e.id}
                          expense={e}
                          members={members}
                          tripSlug={tripSlug}
                          locations={locations}
                          categories={categories}
                          locationChip={
                            hasLocations
                              ? effectiveLocation(e, dayMap, locationsById)
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      No expenses yet
                    </div>
                  )
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
