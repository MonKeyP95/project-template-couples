import type { ReactNode } from "react"

import { Label } from "@/components/together"

/** Desktop "Trip folder" tab: `toolbar` right of the title, then documents and
 * notes side by side on wide screens (stacked below xl), then the checklist. */
export function TripFolder({
  toolbar,
  documents,
  documentsCount,
  notes,
  notesCount,
  checklist,
}: {
  toolbar: ReactNode
  documents: ReactNode
  documentsCount: number
  notes: ReactNode
  notesCount: number
  checklist: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-7 pb-2 lg:px-10">
        <h2 className="mr-auto font-serif text-[40px] leading-none text-foreground">
          Trip <em className="text-sea">folder</em>
        </h2>
        {toolbar}
      </div>
      <div className="grid gap-8 px-5 pt-4 pb-2 lg:px-10 xl:grid-cols-2">
        <FolderColumn label={`Documents · ${documentsCount}`}>{documents}</FolderColumn>
        <FolderColumn label={`Notes · ${notesCount}`}>{notes}</FolderColumn>
      </div>
      <section className="border-t border-border lg:px-5">
        <div className="px-5 pt-5">
          <Label>Checklist</Label>
        </div>
        {checklist}
      </section>
    </div>
  )
}

/** One folder column; `-mx-5` cancels the section's own phone padding so rows align with the label. */
function FolderColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <Label>{label}</Label>
      <div className="-mx-5">{children}</div>
    </section>
  )
}
