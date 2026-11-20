"use client"

import * as React from "react"

import { AddDocumentButtons } from "@/components/documents/document-search"
import { copyNotesFromTrip } from "@/lib/trips/actions"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { ImportFromTripControl } from "./import-from-trip"
import { ImportItemsDialog } from "./import-items-dialog"
import { AddNoteForm } from "./note-parts"
import { toolbarPill } from "./toolbar-pill"

type Panel = "note" | "import"

const DASHED =
  "block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"

/** Trip folder title-row actions: add documents, + note and import; one panel open at a time. */
export function FolderToolbar({
  tripId,
  tripSlug,
  locations,
  currentUserId,
}: {
  tripId: string
  tripSlug: string
  locations: ItineraryLocation[]
  currentUserId: string
}) {
  const [panel, setPanel] = React.useState<Panel | null>(null)
  const [checklistOpen, setChecklistOpen] = React.useState(false)

  function pill(key: Panel, label: string) {
    return (
      <button
        type="button"
        aria-expanded={panel === key}
        onClick={() => setPanel(panel === key ? null : key)}
        className={toolbarPill(panel === key, "sand")}
      >
        {label}
      </button>
    )
  }

  return (
    <>
      <AddDocumentButtons tripId={tripId} tripSlug={tripSlug} buttonClassName={toolbarPill(false, "sand")} />
      {pill("note", "+ note")}
      {pill("import", "import")}
      {panel ? (
        <div className="order-last w-full rounded-xl border border-border bg-card p-4">
          {panel === "note" ? (
            <AddNoteForm tripId={tripId} tripSlug={tripSlug} locations={locations} />
          ) : (
            <div className="flex flex-col gap-2">
              <ImportFromTripControl
                tripId={tripId}
                label="Copy notes from another trip"
                onCopy={(src) => copyNotesFromTrip(tripId, src, tripSlug)}
              />
              <button type="button" onClick={() => setChecklistOpen(true)} className={DASHED}>
                Import a checklist
              </button>
            </div>
          )}
        </div>
      ) : null}
      <ImportItemsDialog
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        tripId={tripId}
        tripSlug={tripSlug}
        currentUserId={currentUserId}
        defaultTarget="shared"
      />
    </>
  )
}
