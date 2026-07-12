import { createClient } from "@/lib/supabase/server"
import type { Expense, ExpenseCategoryRow } from "./expense-types"

export async function getTripExpenseCategories(
  tripId: string,
): Promise<ExpenseCategoryRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expense_categories")
    .select("id, trip_id, name, sort_order, details")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    sortOrder: row.sort_order,
    details: row.details ?? [],
  }))
}

export async function getTripExpenses(tripId: string): Promise<Expense[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expenses")
    .select(
      "id, trip_id, title, amount_cents, currency, paid_by, category, day_date, location_id, is_settlement, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    amountCents: row.amount_cents,
    currency: row.currency,
    paidBy: row.paid_by,
    category: row.category,
    dayDate: row.day_date,
    locationId: row.location_id,
    isSettlement: row.is_settlement,
    createdAt: row.created_at,
  }))
}
