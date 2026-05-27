import { createClient } from "@/lib/supabase/server"
import type { Expense } from "./expense-types"

export async function getTripExpenses(tripId: string): Promise<Expense[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expenses")
    .select(
      "id, trip_id, title, amount_cents, currency, paid_by, category, day_date, is_settlement, created_at",
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
    isSettlement: row.is_settlement,
    createdAt: row.created_at,
  }))
}
