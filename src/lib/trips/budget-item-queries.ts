import { createClient } from "@/lib/supabase/server"

import {
  rowToBudgetItem,
  type BudgetItem,
  type BudgetItemRow,
} from "./budget-item-types"

/** All budget line items for a trip, ordered by category then sort_order. */
export async function getBudgetItems(tripId: string): Promise<BudgetItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_budget_items")
    .select(
      "id, category, subject, when_label, amount_cents, location_id, when_start, when_end, sort_order",
    )
    .eq("trip_id", tripId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<BudgetItemRow[]>()
  return (data ?? []).map(rowToBudgetItem)
}
