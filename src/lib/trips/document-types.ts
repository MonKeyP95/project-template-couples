import type { ReceiptMime } from "./receipt-types"

/** One leg or event of a document: a single day, or a span shown every day. */
export interface DocumentEntry {
  label: string | null
  /** yyyy-mm-dd */
  startDate: string
  /** Last day of a span; null = a single day. */
  endDate: string | null
  /** HH:MM, shown on the first day (check-in, pickup, departure). */
  startTime: string | null
  /** HH:MM, shown on the last day of a span (check-out, return). */
  endTime: string | null
  address: string | null
}

/** What Claude read off a booking, confirmation or ticket. */
export interface DocumentReading {
  title: string | null
  summary: string | null
  reference: string | null
  link: string | null
  entries: DocumentEntry[]
}

export interface TripDocument {
  id: string
  tripId: string
  storagePath: string
  mimeType: ReceiptMime
  readStatus: "pending" | "done" | "failed"
  reading: DocumentReading | null
  /** The dated entries in use: the read's, or the user's edit. Null = none yet. */
  entries: DocumentEntry[] | null
  originalName: string | null
  createdAt: string
  /** Short-lived signed URL, filled by the query. */
  url: string
}

function isIsoDate(value: string | null): value is string {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  )
}

function cleanTime(value: string | null): string | null {
  return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null
}

/**
 * Model output (or a hand edit) as stored: entries without a real start date
 * are dropped, an end before the start becomes a single day, bad times and
 * non-web links become null.
 */
export function normalizeDocumentReading(raw: DocumentReading): DocumentReading {
  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .filter((e) => isIsoDate(e.startDate))
    .map((e) => ({
      label: e.label || null,
      startDate: e.startDate,
      endDate: isIsoDate(e.endDate) && e.endDate > e.startDate ? e.endDate : null,
      startTime: cleanTime(e.startTime),
      endTime: cleanTime(e.endTime),
      address: e.address || null,
    }))
  return {
    ...raw,
    link: raw.link && /^https?:\/\//i.test(raw.link) ? raw.link : null,
    entries,
  }
}

export function entryCovers(entry: DocumentEntry, day: string): boolean {
  return entry.startDate <= day && day <= (entry.endDate ?? entry.startDate)
}

/** The time that matters on `day`: start time on the first day, end time on the last, none between. */
export function entryTimeForDay(entry: DocumentEntry, day: string): string | null {
  if (day === entry.startDate) return entry.startTime
  if (day === entry.endDate) return entry.endTime
  return null
}

/** Documents with an entry covering `day`, each with that entry, earliest time first. */
export function documentsForDay(
  docs: TripDocument[],
  day: string,
): { doc: TripDocument; entry: DocumentEntry }[] {
  return docs
    .flatMap((doc) => {
      const entry = (doc.entries ?? []).find((e) => entryCovers(e, day))
      return entry ? [{ doc, entry }] : []
    })
    .sort((a, b) => {
      const ta = entryTimeForDay(a.entry, day) ?? "99:99"
      const tb = entryTimeForDay(b.entry, day) ?? "99:99"
      return ta.localeCompare(tb)
    })
}

export function documentTitle(doc: Pick<TripDocument, "reading" | "originalName">): string {
  return doc.reading?.title ?? doc.originalName ?? "Document"
}

/** Earliest entry date, for ordering a trip's documents (null = undated). */
export function firstEntryDate(doc: Pick<TripDocument, "entries">): string | null {
  const dates = (doc.entries ?? []).map((e) => e.startDate).sort()
  return dates[0] ?? null
}
