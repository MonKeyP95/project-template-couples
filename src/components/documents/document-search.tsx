"use client"

import { AddReceiptsButton } from "@/components/receipts/add-receipts-button"
import { Input } from "@/components/ui/input"

/** Search box for a trip's documents: hotel name, flight number, "booking". */
export function DocumentSearch({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (query: string) => void
}) {
  return (
    <Input
      type="search"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      placeholder="search documents"
      aria-label="Search documents"
    />
  )
}

/** Take a photo of a document, or pick files; both upload and read the same way. */
export function AddDocumentButtons({ tripId, tripSlug }: { tripId: string; tripSlug: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <AddReceiptsButton tripId={tripId} tripSlug={tripSlug} kind="document" camera label="take a photo" />
      <AddReceiptsButton tripId={tripId} tripSlug={tripSlug} kind="document" label="add documents" />
    </div>
  )
}
