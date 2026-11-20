"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { readReceipt } from "@/lib/trips/receipt-actions"
import { receiptState } from "@/lib/trips/receipt-types"
import { documentTitle, searchDocuments, type TripDocument } from "@/lib/trips/document-types"
import { DocumentView, entryDatesLabel } from "./document-view"
import { AddDocumentButtons, DocumentSearch } from "./document-search"

const SEARCH_FROM = 4

export interface DocumentsSectionProps {
  tripId: string
  tripSlug: string
  /** Already ordered by first date, undated last. */
  documents: TripDocument[]
  /** Server render time, for "reading…" vs "couldn't read". */
  nowMs: number
  /** False when the add buttons live in the page header instead. */
  withAdd?: boolean
}

/** The trip's documents with search and add buttons: bookings, confirmations, tickets. */
export function DocumentsSection({
  tripId,
  tripSlug,
  documents,
  nowMs,
  withAdd = true,
}: DocumentsSectionProps) {
  const [query, setQuery] = React.useState("")
  const shown = searchDocuments(documents, query)
  return (
    <div className="flex flex-col gap-2 px-5 pt-3 pb-4">
      {documents.length >= SEARCH_FROM ? <DocumentSearch query={query} onQueryChange={setQuery} /> : null}
      {shown.length > 0 ? (
        <div className="flex flex-col">
          {shown.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} tripSlug={tripSlug} nowMs={nowMs} />
          ))}
        </div>
      ) : null}
      {query && shown.length === 0 ? <NoMatch /> : null}
      {withAdd ? <AddDocumentButtons tripId={tripId} tripSlug={tripSlug} /> : null}
    </div>
  )
}

function NoMatch() {
  return <p className="text-[13px] text-muted-foreground">no documents match</p>
}

function DocumentCard({
  doc,
  tripSlug,
  nowMs,
}: {
  doc: TripDocument
  tripSlug: string
  nowMs: number
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const state = isPending ? "reading" : receiptState(doc, nowMs)
  const dates = entryDatesLabel(doc.entries)

  function readAgain() {
    startTransition(async () => {
      await readReceipt(doc.id, tripSlug)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-3 border-t border-rule py-2.5 first:border-t-0">
      <span className="flex h-8 w-[26px] shrink-0 items-end justify-center rounded-[4px] border border-border bg-sand-tint pb-[3px] font-mono text-[8px] text-muted-foreground">
        {doc.mimeType === "application/pdf" ? "PDF" : "IMG"}
      </span>
      <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px]">{documentTitle(doc)}</span>
        <span className="t-num block text-[13px] text-muted-foreground">
          {state === "reading" ? "reading…" : state === "failed" ? "couldn't read" : dates || "no dates"}
        </span>
      </button>
      {state === "failed" ? (
        <button
          type="button"
          onClick={readAgain}
          className="shrink-0 rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em]"
        >
          read again
        </button>
      ) : null}
      <DocumentView doc={doc} tripSlug={tripSlug} open={open} onOpenChange={setOpen} />
    </div>
  )
}
