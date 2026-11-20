import type { ReactNode } from "react"

import { Label } from "@/components/together"

/** Desktop "Trip folder" tab: documents, notes and the things-to-bring checklist;
 * `actions` sit right of the title, like the other tabs' toolbars. */
export function TripFolder({
  documents,
  notes,
  checklist,
  actions,
}: {
  documents: ReactNode
  notes: ReactNode
  checklist: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-7 pb-2 lg:px-10">
        <h2 className="mr-auto font-serif text-[40px] leading-none text-foreground">
          Trip <em className="text-sea">folder</em>
        </h2>
        {actions}
      </div>
      <FolderPart label="Documents">{documents}</FolderPart>
      <FolderPart label="Notes">{notes}</FolderPart>
      <FolderPart label="Checklist">{checklist}</FolderPart>
    </div>
  )
}

function FolderPart({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-t border-border first:border-t-0 lg:px-5">
      <div className="px-5 pt-5">
        <Label>{label}</Label>
      </div>
      {children}
    </section>
  )
}
