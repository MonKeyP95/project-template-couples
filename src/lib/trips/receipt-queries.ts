import { createClient } from "@/lib/supabase/server"
import type { Receipt } from "@/lib/trips/receipt-types"

const SIGNED_URL_SECONDS = 3600

/** All of a trip's receipts, newest first, each with a signed URL to its file. */
export async function getTripReceipts(tripId: string): Promise<Receipt[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("receipts")
    .select("id, trip_id, expense_id, storage_path, mime_type, read_status, reading, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })

  const rows = data ?? []
  if (rows.length === 0) return []

  const { data: signed } = await supabase.storage
    .from("receipts")
    .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_SECONDS)
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))

  return rows.map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    expenseId: row.expense_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    readStatus: row.read_status,
    reading: row.reading,
    createdAt: row.created_at,
    url: urlByPath.get(row.storage_path) ?? "",
  }))
}
