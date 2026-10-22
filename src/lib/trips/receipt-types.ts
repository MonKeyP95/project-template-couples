import type { Expense } from "./expense-types"

export type ReceiptMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"

/** What Claude read off a receipt. Any field is null when the receipt doesn't show it. */
export interface ReceiptReading {
  merchant: string | null
  /** yyyy-mm-dd */
  date: string | null
  totalCents: number | null
  /** ISO 4217 */
  currency: string | null
  items: { label: string; amountCents: number | null }[]
  summary: string | null
}

export interface Receipt {
  id: string
  tripId: string
  /** Null = in the trip's receipt pile. */
  expenseId: string | null
  storagePath: string
  mimeType: ReceiptMime
  readStatus: "pending" | "done" | "failed"
  reading: ReceiptReading | null
  createdAt: string
  /** Short-lived signed URL, filled by the query. */
  url: string
}

export type ReceiptState = "reading" | "failed" | "done"

export const RECEIPT_MIMES: readonly ReceiptMime[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]

export const RECEIPT_PDF_MAX_BYTES = 10 * 1024 * 1024

/** Error text for a file we can't take as a receipt, or null. Images have no size cap; they are shrunk before upload. */
export function checkReceiptFile(file: File): string | null {
  if (!RECEIPT_MIMES.includes(file.type as ReceiptMime)) {
    return "Use a photo (JPEG, PNG, WebP) or a PDF."
  }
  if (file.type === "application/pdf" && file.size > RECEIPT_PDF_MAX_BYTES) {
    return "PDF is over 10 MB."
  }
  return null
}

/** A read still pending after this long is treated as failed (the reading tab may have closed). */
export const READ_STALE_MS = 2 * 60 * 1000

export function receiptState(
  r: Pick<Receipt, "readStatus" | "createdAt">,
  nowMs: number,
): ReceiptState {
  if (r.readStatus !== "pending") return r.readStatus
  return nowMs - Date.parse(r.createdAt) > READ_STALE_MS ? "failed" : "reading"
}

const DAY_MS = 86_400_000
const MAX_DAY_GAP = 2
const MAX_SUGGESTIONS = 3

/**
 * Up to 3 expenses this receipt probably belongs to: exact amount in the same
 * currency first, then closest date, then closest amount. Skips settlements and
 * expenses that already have a receipt. Plain comparison, no AI.
 */
export function suggestExpenseMatches(
  reading: ReceiptReading | null,
  expenses: Expense[],
  receiptExpenseIds: Set<string>,
): Expense[] {
  if (!reading || (reading.totalCents === null && reading.date === null)) return []

  const scored = expenses
    .filter((e) => !e.isSettlement && !receiptExpenseIds.has(e.id))
    .map((e) => {
      const sameCurrency = e.currency === reading.currency
      const exact = sameCurrency && e.amountCents === reading.totalCents
      const dayGap =
        reading.date && e.dayDate
          ? Math.abs(Date.parse(e.dayDate) - Date.parse(reading.date)) / DAY_MS
          : 99
      const amountGap =
        sameCurrency && reading.totalCents !== null
          ? Math.abs(e.amountCents - reading.totalCents)
          : Infinity
      return { e, key: [exact ? 0 : 1, dayGap, amountGap] }
    })
    .filter(({ key }) => key[0] === 0 || key[1] <= MAX_DAY_GAP)

  scored.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
  return scored.slice(0, MAX_SUGGESTIONS).map(({ e }) => e)
}
