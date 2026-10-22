"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { readDocumentFile, readReceiptFile } from "@/lib/ai/claude"
import {
  normalizeDocumentReading,
  type DocumentEntry,
  type DocumentReading,
} from "@/lib/trips/document-types"
import { normalizeReading, type ReceiptMime, type ReceiptReading } from "@/lib/trips/receipt-types"

export interface ReceiptActionResult {
  error?: string
}

export interface ReadReceiptResult extends ReceiptActionResult {
  reading?: ReceiptReading
}

type Supabase = Awaited<ReturnType<typeof createClient>>

function revalidateReceipts(tripSlug: string) {
  revalidatePath(`/trips/${tripSlug}`)
  revalidatePath("/on-the-road")
}

/**
 * Download the file, have Claude read it, store the result or mark it failed.
 * A document's entries are written only while unset, so a hand edit sticks.
 */
async function runRead(supabase: Supabase, receiptId: string): Promise<ReadReceiptResult> {
  try {
    const { data: row, error } = await supabase
      .from("receipts")
      .select("storage_path, mime_type, kind, entries")
      .eq("id", receiptId)
      .single()
    if (error) throw error

    const { data: blob, error: downloadError } = await supabase.storage
      .from("receipts")
      .download(row.storage_path)
    if (downloadError) throw downloadError
    const file = {
      base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
      mimeType: row.mime_type as ReceiptMime,
    }

    if (row.kind === "document") {
      const reading = normalizeDocumentReading(await readDocumentFile(file))
      await supabase
        .from("receipts")
        .update({
          reading,
          read_status: "done",
          ...(row.entries === null ? { entries: reading.entries } : {}),
        })
        .eq("id", receiptId)
      return {}
    }

    const reading = normalizeReading(await readReceiptFile(file))
    await supabase
      .from("receipts")
      .update({ reading, read_status: "done" })
      .eq("id", receiptId)
    return { reading }
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
  kind: "receipt" | "document"
  /** The file's name at upload; a document's title when its read has none. */
  originalName: string | null
}

/**
 * Record a receipt whose file the browser already uploaded. The file never
 * passes through here (server actions cap bodies at 1 MB). The caller then
 * calls `readReceipt`, so the card shows "reading…" while Claude reads.
 */
export async function addReceipt(input: AddReceiptInput): Promise<ReceiptActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("receipts").insert({
    id: input.receiptId,
    trip_id: input.tripId,
    expense_id: input.expenseId,
    storage_path: input.storagePath,
    mime_type: input.mimeType,
    kind: input.kind,
    original_name: input.originalName,
  })
  if (error) return { error: error.message }

  revalidateReceipts(input.tripSlug)
  return {}
}

/** Read a receipt with Claude: right after upload, and as "read again". */
export async function readReceipt(
  receiptId: string,
  tripSlug: string,
): Promise<ReadReceiptResult> {
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

const EMPTY_DOCUMENT_READING: DocumentReading = {
  title: null,
  summary: null,
  reference: null,
  link: null,
  entries: [],
}

/** Save a hand edit of a document's title and dated entries. */
export async function updateDocument(
  documentId: string,
  patch: { title: string | null; entries: DocumentEntry[] },
  tripSlug: string,
): Promise<ReceiptActionResult> {
  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("receipts")
    .select("reading")
    .eq("id", documentId)
    .single()
  if (error) return { error: error.message }

  const reading: DocumentReading = { ...(row.reading ?? EMPTY_DOCUMENT_READING), title: patch.title }
  const entries = normalizeDocumentReading({ ...EMPTY_DOCUMENT_READING, entries: patch.entries }).entries
  const { error: updateError } = await supabase
    .from("receipts")
    .update({ reading, entries })
    .eq("id", documentId)
  if (updateError) return { error: updateError.message }

  revalidateReceipts(tripSlug)
  return {}
}
