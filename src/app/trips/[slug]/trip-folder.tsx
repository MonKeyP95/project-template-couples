import type { ReactNode } from "react"

import { Label } from "@/components/together"

/** Desktop "Trip folder" tab: `toolbar` right of the title, then two boxes side
 * by side on wide screens (stacked below xl): documents with the things-to-bring
 * checklist under them, and notes. */
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
      <div className="grid items-start gap-4 px-5 pt-4 pb-8 lg:px-10 xl:grid-cols-2">
        <FolderBox>
          <Label>{`Documents · ${documentsCount}`}</Label>
          <div className="-mx-5">{documents}</div>
          <div className="mt-2 border-t border-border pt-5">
            <Label>Checklist</Label>
          </div>
          <div className="-mx-5">{checklist}</div>
        </FolderBox>
        <FolderBox>
          <Label>{`Notes · ${notesCount}`}</Label>
          <div className="-mx-5">{notes}</div>
        </FolderBox>
      </div>
    </div>
  )
}

/** A boxed folder column; `-mx-5` on its parts cancels their own phone padding so rows align with the label. */
function FolderBox({ children }: { children: ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-border bg-card p-5">{children}</section>
}
