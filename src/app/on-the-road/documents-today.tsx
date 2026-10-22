"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { DocumentView } from "@/components/documents/document-view"
import {
  documentTitle,
  entryTimeForDay,
  type DocumentEntry,
  type TripDocument,
} from "@/lib/trips/document-types"

export interface DocumentsTodayProps {
  /** Documents with an entry covering today, each with that entry. */
  items: { doc: TripDocument; entry: DocumentEntry }[]
  today: string
  tripSlug: string
}

/** Bookings, tickets and confirmations that apply today. Nothing when there are none. */
export function DocumentsToday({ items, today, tripSlug }: DocumentsTodayProps) {
  if (items.length === 0) return null
  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <Label>Documents today</Label>
      <div className="mt-3 flex flex-col gap-3">
        {items.map(({ doc, entry }) => (
          <DocumentTodayRow key={doc.id} doc={doc} entry={entry} today={today} tripSlug={tripSlug} />
        ))}
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
  entry: DocumentEntry
  today: string
  tripSlug: string
}) {
  const [open, setOpen] = React.useState(false)
  const time = entryTimeForDay(entry, today)
  const reference = doc.reading?.reference
  const link = doc.reading?.link

  return (
    <div className="flex flex-col gap-0.5 text-[14px]">
      <button type="button" onClick={() => setOpen(true)} className="text-left">
        <span className="t-num">{time ? `${time} · ` : ""}</span>
        {documentTitle(doc)}
        {entry.label ? <span className="text-muted-foreground"> · {entry.label}</span> : null}
      </button>
      {entry.address ? <span className="text-[13px] text-muted-foreground">{entry.address}</span> : null}
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
