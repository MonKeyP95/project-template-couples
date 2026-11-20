"use client"

import * as React from "react"

import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import {
  byPlaceLines,
  expensePlaceKey,
  itemPlaceKey,
} from "@/lib/trips/budget-by-place-types"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import {
  homeCents,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import {
  dayLocationMap,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { BudgetRow, displayName, RowDetail } from "./budget-by-category"
import type { MemberToneEntry } from "./packing-tab"

interface Props {
  tripId: string
  tripSlug: string
  currentPersonId: string
  expenses: Expense[]
  budgetItems: BudgetItem[]
  locations: ItineraryLocation[]
  categories: ExpenseCategoryRow[]
  itineraryDays: DayLocation[]
  members: Record<string, MemberToneEntry>
  tripStarted: boolean
}

/** A new expense from a place row starts tagged to that place; Trip-wide
 * starts untagged; Before you go has no add (Pre-trip isn't a log category). */
function addDefaults(key: string): { locationId: string | null } | null {
  if (key === "pretrip") return null
  return { locationId: key === "trip" ? null : key }
}

/** Spent-vs-plan per place: Before you go, each place, Trip-wide.
 * Editing lives in the drafter; tap a row for its lines and spending. */
export function BudgetByPlace(props: Props) {
  const { currency } = useCurrency()
  const [open, setOpen] = React.useState<string | null>(null)
  const fmt = (cents: number) => money(cents, currency)
  const dayMap = dayLocationMap(props.itineraryDays)

  const lines = byPlaceLines(
    props.expenses.map((e) => ({
      category: e.category,
      isSettlement: e.isSettlement,
      amountCents: homeCents(e),
      locationId: e.locationId,
      dayDate: e.dayDate,
    })),
    props.budgetItems,
    props.locations,
    dayMap,
    props.tripStarted,
  )

  return (
    <div className="mt-1">
      {lines.map((line) => (
        <BudgetRow
          key={line.key}
          name={line.name}
          line={line}
          isOpen={open === line.key}
          onToggle={() => setOpen(open === line.key ? null : line.key)}
          fmt={fmt}
        >
          <RowDetail
            planned={props.budgetItems.filter((it) => itemPlaceKey(it) === line.key)}
            spent={props.expenses.filter((e) => expensePlaceKey(e, dayMap) === line.key)}
            plannedWhere={(it) => displayName(it.category)}
            addDefaults={addDefaults(line.key)}
            tripId={props.tripId}
            currentPersonId={props.currentPersonId}
            tripSlug={props.tripSlug}
            locations={props.locations}
            categories={props.categories}
            members={props.members}
            fmt={fmt}
          />
        </BudgetRow>
      ))}
    </div>
  )
}
