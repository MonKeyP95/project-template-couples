"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { AddReceiptsButton } from "@/components/receipts/add-receipts-button"
import { readReceipt } from "@/lib/trips/receipt-actions"
import { receiptState } from "@/lib/trips/receipt-types"
import { documentTitle, type TripDocument } from "@/lib/trips/document-types"
import { DocumentView, entryDatesLabel } from "./document-view"

export interface DocumentsSectionProps {
  tripId: string
  tripSlug: string
  /** Already ordered by first date, undated last. */
  documents: TripDocument[]
  /** Server render time, for "reading…" vs "couldn't read". */
  nowMs: number
}

/** The trip's documents with an add button: bookings, confirmations, tickets. */
export function DocumentsSection({ tripId, tripSlug, documents, nowMs }: DocumentsSectionProps) {
  return (
    <div className="flex flex-col gap-2 px-5 pt-3 pb-4">
      {documents.map((doc) => (
        <DocumentCard key={doc.id} doc={doc} tripSlug={tripSlug} nowMs={nowMs} />
      ))}
      <AddReceiptsButton tripId={tripId} tripSlug={tripSlug} kind="document" label="add documents" />
    </div>
  )
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
    <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3">
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
