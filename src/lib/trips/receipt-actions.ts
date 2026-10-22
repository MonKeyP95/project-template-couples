"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { readReceiptFile } from "@/lib/ai/claude"
import type { ReceiptMime } from "@/lib/trips/receipt-types"

export interface ReceiptActionResult {
  error?: string
}

type Supabase = Awaited<ReturnType<typeof createClient>>

function revalidateReceipts(tripSlug: string) {
  revalidatePath(`/trips/${tripSlug}`)
  revalidatePath("/on-the-road")
}

/** Download the file, have Claude read it, store the result or mark it failed. */
async function runRead(supabase: Supabase, receiptId: string): Promise<ReceiptActionResult> {
  try {
    const { data: row, error } = await supabase
      .from("receipts")
      .select("storage_path, mime_type")
      .eq("id", receiptId)
      .single()
    if (error) throw error

    const { data: blob, error: downloadError } = await supabase.storage
      .from("receipts")
      .download(row.storage_path)
    if (downloadError) throw downloadError

    const reading = await readReceiptFile({
      base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
      mimeType: row.mime_type as ReceiptMime,
    })
    await supabase
      .from("receipts")
      .update({ reading, read_status: "done" })
      .eq("id", receiptId)
    return {}
  } catch (e) {
    console.error("readReceipt failed", receiptId, e)
    await supabase.from("receipts").update({ read_status: "failed" }).eq("id", receiptId)
    return { error: "Couldn't read this receipt." }
  }
}

export interface AddReceiptInput {
  tripId: string
  tripSlug: string
  receiptId: string
  storagePath: string
  mimeType: ReceiptMime
  expenseId: string | null
}

/**
 * Record a receipt whose file the browser already uploaded, then read it.
 * The file never passes through here (server actions cap bodies at 1 MB).
 */
export async function addReceipt(input: AddReceiptInput): Promise<ReceiptActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("receipts").insert({
    id: input.receiptId,
    trip_id: input.tripId,
    expense_id: input.expenseId,
    storage_path: input.storagePath,
    mime_type: input.mimeType,
  })
  if (error) return { error: error.message }

  const result = await runRead(supabase, input.receiptId)
  revalidateReceipts(input.tripSlug)
  return result
}

/** "Read again" for a receipt whose read failed. */
export async function readReceipt(
  receiptId: string,
  tripSlug: string,
): Promise<ReceiptActionResult> {
  const supabase = await createClient()
  const result = await runRead(supabase, receiptId)
  revalidateReceipts(tripSlug)
  return result
}

/** Link a receipt to an expense, or back to the pile with `expenseId = null`. */
export async function attachReceipt(
  receiptId: string,
  expenseId: string | null,
  tripSlug: string,
): Promise<ReceiptActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("receipts")
    .update({ expense_id: expenseId })
    .eq("id", receiptId)
  if (error) return { error: error.message }

  revalidateReceipts(tripSlug)
  return {}
}

/** Delete a receipt and its file. */
export async function deleteReceipt(
  receiptId: string,
  tripSlug: string,
): Promise<ReceiptActionResult> {
  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("receipts")
    .select("storage_path")
    .eq("id", receiptId)
    .single()
  if (error) return { error: error.message }

  const { error: removeError } = await supabase.storage
    .from("receipts")
    .remove([row.storage_path])
  if (removeError) return { error: removeError.message }

  const { error: deleteError } = await supabase.from("receipts").delete().eq("id", receiptId)
  if (deleteError) return { error: deleteError.message }

  revalidateReceipts(tripSlug)
  return {}
}
