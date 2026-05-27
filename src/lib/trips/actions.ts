"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/trips/expense-types"

export interface ToggleResult {
  error?: string
}

export interface AddPackingItemResult {
  error?: string
}

/**
 * Flips a packing item's `done` flag. RLS enforces that the caller is a
 * workspace member of the trip; on success, Supabase Realtime broadcasts the
 * change to the partner's open clients.
 */
export async function togglePackingItem(
  itemId: string,
  done: boolean,
): Promise<ToggleResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("packing_items")
    .update({ done })
    .eq("id", itemId)

  if (error) return { error: error.message }
  return {}
}

/**
 * Inserts a new packing item under the given category. RLS requires that
 * `added_by = auth.uid()` and that the caller is a member of the trip's
 * workspace. The Realtime channel on packing-tab will pick up the INSERT
 * and update both clients.
 */
export async function addPackingItem(
  tripId: string,
  category: string,
  label: string,
): Promise<AddPackingItemResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("packing_items").insert({
    trip_id: tripId,
    category,
    label: trimmed,
    added_by: userData.user.id,
  })

  if (error) return { error: error.message }
  return {}
}

export interface LogExpenseInput {
  tripId: string
  tripSlug: string
  title: string
  amount: string
  category: string
  paidBy: string
  dayDate: string | null
}

export interface LogExpenseResult {
  error?: string
}

// int4 ceiling — matches the type of expenses.amount_cents.
const MAX_AMOUNT_CENTS = 2_147_483_647

/**
 * Inserts a non-settlement expense row. Returns `{ error }` rather than
 * throwing so the client form can stay expanded and surface the error inline.
 */
export async function logExpense(
  input: LogExpenseInput,
): Promise<LogExpenseResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }

  const amountNum = Number(input.amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { error: "Amount must be greater than zero." }
  }
  const cents = Math.round(amountNum * 100)
  if (cents <= 0 || cents >= MAX_AMOUNT_CENTS) {
    return { error: "Amount out of range." }
  }

  if (!EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)) {
    return { error: "Invalid category." }
  }

  if (!input.paidBy) return { error: "Payer required." }

  if (input.dayDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dayDate)) {
    return { error: "Invalid day." }
  }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("expenses").insert({
    trip_id: input.tripId,
    title,
    amount_cents: cents,
    currency: "EUR",
    paid_by: input.paidBy,
    category: input.category,
    day_date: input.dayDate,
    is_settlement: false,
  })

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/**
 * Records a settlement row that brings the trip's net balance to zero.
 * Inserts paid_by = current debtor, amount = absolute net balance, so a
 * subsequent budget summary computes 0. Two-member trips only.
 *
 * Throws on error so it can be wired directly to `<form action={...}>`.
 */
export async function settleUp(
  tripId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("workspace_id")
    .eq("id", tripId)
    .maybeSingle()
  if (tripError) throw new Error(tripError.message)
  if (!trip) throw new Error("Trip not found.")

  const { data: memberRows, error: membersError } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", trip.workspace_id)
  if (membersError) throw new Error(membersError.message)
  if (!memberRows || memberRows.length !== 2) {
    throw new Error("Settle-up requires exactly 2 workspace members.")
  }

  const { data: expenseRows, error: expensesError } = await supabase
    .from("expenses")
    .select("amount_cents, paid_by, is_settlement")
    .eq("trip_id", tripId)
  if (expensesError) throw new Error(expensesError.message)

  const [a, b] = memberRows.map((m) => m.user_id)
  let aPaid = 0
  let bPaid = 0
  let aTransfers = 0
  let bTransfers = 0
  for (const e of expenseRows ?? []) {
    if (e.is_settlement) {
      if (e.paid_by === a) aTransfers += e.amount_cents
      else if (e.paid_by === b) bTransfers += e.amount_cents
    } else {
      if (e.paid_by === a) aPaid += e.amount_cents
      else if (e.paid_by === b) bPaid += e.amount_cents
    }
  }

  const net = Math.round((aPaid - bPaid) / 2 + aTransfers - bTransfers)
  if (net === 0) {
    revalidatePath(`/trips/${tripSlug}`)
    return
  }
  const debtor = net > 0 ? b : a

  const { error: insertError } = await supabase.from("expenses").insert({
    trip_id: tripId,
    title: "Settlement",
    amount_cents: Math.abs(net),
    currency: "EUR",
    paid_by: debtor,
    category: "Settlement",
    is_settlement: true,
  })
  if (insertError) throw new Error(insertError.message)

  revalidatePath(`/trips/${tripSlug}`)
}
