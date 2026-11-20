"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { copyNotesFromTrip } from "@/lib/trips/actions"
import { AssistantBlock } from "@/components/assistant-block"
import { PlanningPlaceDoor } from "./find-a-place-planning"
import { ImportFromTripControl } from "./import-from-trip"
import { AddNoteForm, NoteCard } from "./note-parts"
import type { TripNote } from "@/lib/trips/note-queries"
import type { ItineraryLocation } from "@/lib/trips/location-types"

import type { MemberToneEntry } from "./packing-tab"

/** The trip's notes as one newest-first list, each tagged with its place.
 * "phone" adds the assistant bar, import and an add box above the list; on
 * "folder" those live in the trip folder's toolbar. */
export function NotesTab({
  tripId,
  tripSlug,
  destination,
  initialNotes,
  locations,
  members,
  layout,
}: {
  tripId: string
  tripSlug: string
  destination: string
  initialNotes: TripNote[]
  locations: ItineraryLocation[]
  members: Record<string, MemberToneEntry>
  layout: "phone" | "folder"
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null)

  return (
    <section className={layout === "phone" ? "px-5 pt-5" : "px-5 pt-3"}>
      {layout === "phone" ? (
        <>
          <AssistantBlock
            surface="notes"
            tripSlug={tripSlug}
            className="mb-4 block"
            bar
            door={<PlanningPlaceDoor tripId={tripId} tripSlug={tripSlug} destination={destination} />}
          />
          <Label>Notes</Label>
          <div className="mt-4">
            <ImportFromTripControl
              tripId={tripId}
              label="Copy notes from another trip"
              onCopy={(src) => copyNotesFromTrip(tripId, src, tripSlug)}
            />
          </div>
          <div className="mt-4">
            <AddNoteForm tripId={tripId} tripSlug={tripSlug} locations={locations} />
          </div>
        </>
      ) : null}

      {initialNotes.length === 0 ? (
        <p className="py-3 text-[13px] text-muted-foreground">no notes yet</p>
      ) : (
        <div className={layout === "phone" ? "mt-5" : undefined}>
          {initialNotes.map((note) => (
            <div key={note.id} className="border-t border-rule py-4 first:border-t-0 first:pt-0">
              <NoteCard
                note={note}
                tripSlug={tripSlug}
                locations={locations}
                member={members[note.createdBy]}
                isEditing={editingId === note.id}
                onStartEdit={() => setEditingId(note.id)}
                onStopEdit={() => setEditingId(null)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
