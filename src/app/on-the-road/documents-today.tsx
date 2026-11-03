"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { AddDocumentButtons, DocumentSearch } from "@/components/documents/document-search"
import { DocumentView, entryDatesLabel } from "@/components/documents/document-view"
import {
  documentsForDay,
  documentTitle,
  entryTimeForDay,
  searchDocuments,
  type DocumentEntry,
  type TripDocument,
} from "@/lib/trips/document-types"

export interface DocumentsTodayProps {
  /** All of the trip's documents. */
  documents: TripDocument[]
  today: string
  tripId: string
  tripSlug: string
}

/**
 * Bookings, tickets and confirmations that apply today, with add buttons.
 * Typing in the search box searches all of the trip's documents instead.
 */
export function DocumentsToday({ documents, today, tripId, tripSlug }: DocumentsTodayProps) {
  const [query, setQuery] = React.useState("")
  const items = query.trim()
    ? searchDocuments(documents, query).map((doc) => ({ doc, entry: null }))
    : documentsForDay(documents, today)
  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <Label>Documents</Label>
      <div className="mt-3 flex flex-col gap-3">
        <DocumentSearch query={query} onQueryChange={setQuery} />
        {items.map(({ doc, entry }) => (
          <DocumentTodayRow key={doc.id} doc={doc} entry={entry} today={today} tripSlug={tripSlug} />
        ))}
        {items.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {query.trim() ? "no documents match" : "nothing for today"}
          </p>
        ) : null}
        <AddDocumentButtons tripId={tripId} tripSlug={tripSlug} />
      </div>
    </section>
  )
}

function DocumentTodayRow({
  doc,
  entry,
  today,
  tripSlug,
}: {
  doc: TripDocument
  /** Today's entry; null for a search hit, which shows its dates instead. */
  entry: DocumentEntry | null
  today: string
  tripSlug: string
}) {
  const [open, setOpen] = React.useState(false)
  const time = entry ? entryTimeForDay(entry, today) : null
  const reference = doc.reading?.reference
  const link = doc.reading?.link

  return (
    <div className="flex flex-col gap-0.5 text-[14px]">
      <button type="button" onClick={() => setOpen(true)} className="text-left">
        <span className="t-num">{time ? `${time} · ` : ""}</span>
        {documentTitle(doc)}
        {entry?.label ? <span className="text-muted-foreground"> · {entry.label}</span> : null}
      </button>
      {entry === null ? (
        <span className="t-num text-[13px] text-muted-foreground">{entryDatesLabel(doc.entries) || "no dates"}</span>
      ) : null}
      {entry?.address ? <span className="text-[13px] text-muted-foreground">{entry.address}</span> : null}
      <div className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
        {reference ? <span>ref {reference}</span> : null}
        <a href={doc.url} target="_blank" rel="noreferrer" className="underline">
          open
        </a>
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="underline">
            link
          </a>
        ) : null}
      </div>
      <DocumentView doc={doc} tripSlug={tripSlug} open={open} onOpenChange={setOpen} />
    </div>
  )
}
