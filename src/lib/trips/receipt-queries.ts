import { createClient } from "@/lib/supabase/server"
import type { Receipt } from "@/lib/trips/receipt-types"
import { firstEntryDate, type TripDocument } from "@/lib/trips/document-types"

const SIGNED_URL_SECONDS = 3600

type Supabase = Awaited<ReturnType<typeof createClient>>

/** Signed URLs for files in the receipts bucket, keyed by path. */
async function signPaths(supabase: Supabase, paths: string[]): Promise<Map<string, string | null>> {
  if (paths.length === 0) return new Map()
  const { data } = await supabase.storage
    .from("receipts")
    .createSignedUrls(paths, SIGNED_URL_SECONDS)
  return new Map((data ?? []).map((s) => [s.path ?? "", s.signedUrl]))
}

/** All of a trip's receipts, newest first, each with a signed URL to its file. */
export async function getTripReceipts(tripId: string): Promise<Receipt[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("receipts")
    .select("id, trip_id, expense_id, storage_path, mime_type, read_status, reading, created_at")
    .eq("trip_id", tripId)
    .eq("kind", "receipt")
    .order("created_at", { ascending: false })

  const rows = data ?? []
  const urls = await signPaths(supabase, rows.map((r) => r.storage_path))
  return rows.map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    expenseId: row.expense_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    readStatus: row.read_status,
    reading: row.reading,
    createdAt: row.created_at,
    url: urls.get(row.storage_path) ?? "",
  }))
}

/** A trip's documents, earliest entry first (undated last), each with a signed URL. */
export async function getTripDocuments(tripId: string): Promise<TripDocument[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("receipts")
    .select("id, trip_id, storage_path, mime_type, read_status, reading, entries, original_name, created_at")
    .eq("trip_id", tripId)
    .eq("kind", "document")
    .order("created_at", { ascending: true })

  const rows = data ?? []
  const urls = await signPaths(supabase, rows.map((r) => r.storage_path))
  const docs: TripDocument[] = rows.map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    readStatus: row.read_status,
    reading: row.reading,
    entries: row.entries,
    originalName: row.original_name,
    createdAt: row.created_at,
    url: urls.get(row.storage_path) ?? "",
  }))
  return docs.sort((a, b) =>
    (firstEntryDate(a) ?? "9999").localeCompare(firstEntryDate(b) ?? "9999"),
  )
}

/** Request time for the receipt pile's "reading…" vs "couldn't read" cut-off. */
export function receiptClockMs(): number {
  return Date.now()
}
