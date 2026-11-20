"use client"

import * as React from "react"

import { Label, SegBtn } from "@/components/together"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import type { Expense, ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { DayLocation } from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { BudgetByCategory } from "./budget-by-category"
import { BudgetByPlace } from "./budget-by-place"
import type { MemberToneEntry } from "./packing-tab"

type View = "category" | "place"

interface Props {
  tripId: string
  tripSlug: string
  currentPersonId: string
  expenses: Expense[]
  budgetItems: BudgetItem[]
  categories: ExpenseCategoryRow[]
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  members: Record<string, MemberToneEntry>
  tripStarted: boolean
}

/** Its own box under the headline: by category, plus a by-place switch once the
 * trip has 2+ places. Hidden until the trip has a plan. */
export function BudgetBreakdown(props: Props) {
  const [picked, setPicked] = React.useState<View>("category")
  if (props.budgetItems.length === 0) return null

  const hasPlaces = props.locations.length >= 2
  const view = hasPlaces ? picked : "category"

  return (
    <div className="mx-5 my-4 rounded-xl border border-border bg-card px-5 pt-4 pb-4">
      {hasPlaces ? (
        <div className="flex gap-2">
          <SegBtn tone="sea" active={view === "category"} onClick={() => setPicked("category")}>
            by category
          </SegBtn>
          <SegBtn tone="sea" active={view === "place"} onClick={() => setPicked("place")}>
            by place
          </SegBtn>
        </div>
      ) : (
        <Label>By category</Label>
      )}
      {view === "category" ? <BudgetByCategory {...props} /> : <BudgetByPlace {...props} />}
    </div>
  )
}
