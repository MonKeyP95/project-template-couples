"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { dayLabel } from "@/lib/trips/budget-pace"
import { deleteReceipt, updateDocument } from "@/lib/trips/receipt-actions"
import {
  documentTitle,
  type DocumentEntry,
  type TripDocument,
} from "@/lib/trips/document-types"

/** "3 Nov · 17 Nov" or "3–7 Nov"; empty when undated. */
export function entryDatesLabel(entries: DocumentEntry[] | null): string {
  return (entries ?? [])
    .map((e) => (e.endDate ? `${dayLabel(e.startDate)}–${dayLabel(e.endDate)}` : dayLabel(e.startDate)))
    .join(" · ")
}

export interface DocumentViewProps {
  doc: TripDocument
  tripSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** One document: its file, link and details, with editable title and dated entries. */
export function DocumentView({ doc, tripSlug, open, onOpenChange }: DocumentViewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{documentTitle(doc)}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open, so the edit state starts fresh each time. */}
        {open ? (
          <DocumentViewBody doc={doc} tripSlug={tripSlug} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const BLANK_ENTRY: DocumentEntry = {
  label: null,
  startDate: "",
  endDate: null,
  startTime: null,
  endTime: null,
  address: null,
}

function DocumentViewBody({
  doc,
  tripSlug,
  onDone,
}: {
  doc: TripDocument
  tripSlug: string
  onDone: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = React.useState(documentTitle(doc))
  const [entries, setEntries] = React.useState<DocumentEntry[]>(doc.entries ?? [])
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const r = doc.reading

  function setEntry(i: number, patch: Partial<DocumentEntry>) {
    setEntries((all) => all.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  }

  function run(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <div className="flex flex-wrap gap-3">
        <a href={doc.url} target="_blank" rel="noreferrer" className="underline">
          open {doc.mimeType === "application/pdf" ? "PDF" : "photo"}
        </a>
        {r?.link ? (
          <a href={r.link} target="_blank" rel="noreferrer" className="underline">
            open link
          </a>
        ) : null}
      </div>
      {r?.summary ? <p className="text-muted-foreground">{r.summary}</p> : null}
      {r?.reference ? <p className="t-num">Ref {r.reference}</p> : null}

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Days</span>
        {entries.map((e, i) => (
          <EntryEditor
            key={i}
            entry={e}
            onChange={(patch) => setEntry(i, patch)}
            onRemove={() => setEntries((all) => all.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          onClick={() => setEntries((all) => [...all, BLANK_ENTRY])}
          className="self-start font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground underline"
        >
          add day
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          // A day without a date would be dropped on save, so wait for one.
          disabled={isPending || entries.some((e) => !e.startDate)}
          onClick={() =>
            run(() => updateDocument(doc.id, { title: title.trim() || null, entries }, tripSlug))
          }
          className="rounded-full bg-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          save
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => deleteReceipt(doc.id, tripSlug))}
          className="rounded-full border border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-clay disabled:opacity-40"
        >
          delete
        </button>
      </div>
      {error ? <div className="font-mono text-[10px] text-clay">{error}</div> : null}
    </div>
  )
}

function EntryEditor({
  entry,
  onChange,
  onRemove,
}: {
  entry: DocumentEntry
  onChange: (patch: Partial<DocumentEntry>) => void
  onRemove: () => void
}) {
  const field = "rounded-lg border border-border bg-background px-2 py-1.5 text-[13px]"
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
      <div className="flex gap-2">
        <input
          value={entry.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value || null })}
          placeholder="e.g. Outbound flight"
          aria-label="Label"
          className={`min-w-0 flex-1 ${field}`}
        />
        <button type="button" onClick={onRemove} aria-label="Remove day" className="px-2 text-muted-foreground">
          ×
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={entry.startDate} aria-label="From"
          onChange={(e) => onChange({ startDate: e.target.value })} className={field} />
        <input type="date" value={entry.endDate ?? ""} aria-label="Until (optional)"
          onChange={(e) => onChange({ endDate: e.target.value || null })} className={field} />
        <input type="time" value={entry.startTime ?? ""} aria-label="Time on first day"
          onChange={(e) => onChange({ startTime: e.target.value || null })} className={field} />
        <input type="time" value={entry.endTime ?? ""} aria-label="Time on last day"
          onChange={(e) => onChange({ endTime: e.target.value || null })} className={field} />
      </div>
      <input
        value={entry.address ?? ""}
        onChange={(e) => onChange({ address: e.target.value || null })}
        placeholder="Address"
        aria-label="Address"
        className={field}
      />
    </div>
  )
}
