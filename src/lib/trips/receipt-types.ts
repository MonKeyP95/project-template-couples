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

/**
 * Model output as stored: a date that isn't a real yyyy-mm-dd and a currency
 * that isn't a 3-letter code become null, so the UI's date and money
 * formatters can't throw on them.
 */
export function normalizeReading(raw: ReceiptReading): ReceiptReading {
  const date =
    raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) &&
    new Date(`${raw.date}T00:00:00Z`).toISOString().startsWith(raw.date)
      ? raw.date
      : null
  const currency = raw.currency?.trim().toUpperCase() ?? null
  return { ...raw, date, currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null }
}

export interface ExpenseDraft {
  title: string
  /** As typed in the amount field, e.g. "23.4". */
  amount: string
  currency: string
  dayDate: string | null
}

/**
 * Fill an expense form from a receipt. Title and amount fill only while empty,
 * so nothing typed is overwritten; the currency moves with the amount it
 * belongs to. The date always takes the receipt's, since the form's is a
 * default (today) rather than something typed.
 */
export function prefillFromReading(draft: ExpenseDraft, reading: ReceiptReading): ExpenseDraft {
  const fillAmount = draft.amount === "" && reading.totalCents !== null
  return {
    title: draft.title === "" && reading.merchant ? reading.merchant : draft.title,
    amount: fillAmount ? String(reading.totalCents! / 100) : draft.amount,
    currency: fillAmount && reading.currency ? reading.currency : draft.currency,
    dayDate: reading.date ?? draft.dayDate,
  }
}

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
      // An undated expense can't be ruled out by date, so it ranks by amount only.
      const dayGap = !e.dayDate
        ? MAX_DAY_GAP
        : reading.date
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
