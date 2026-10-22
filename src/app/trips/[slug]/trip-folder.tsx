import type { ReactNode } from "react"

import { Label } from "@/components/together"

/** Desktop "Trip folder" tab: documents, notes and the things-to-bring checklist. */
export function TripFolder({
  documents,
  notes,
  checklist,
}: {
  documents: ReactNode
  notes: ReactNode
  checklist: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <FolderPart label="Documents">{documents}</FolderPart>
      <FolderPart label="Notes">{notes}</FolderPart>
      <FolderPart label="Checklist">{checklist}</FolderPart>
    </div>
  )
}

function FolderPart({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-t border-border first:border-t-0">
      <div className="px-5 pt-5">
        <Label>{label}</Label>
      </div>
      {children}
    </section>
  )
}
