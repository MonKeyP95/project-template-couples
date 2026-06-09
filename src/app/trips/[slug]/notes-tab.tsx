"use client"

import * as React from "react"

import { Avatar, Label } from "@/components/together"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  addNote,
  copyNotesFromTrip,
  deleteNote,
  updateNote,
} from "@/lib/trips/actions"
import { ImportFromTripControl } from "./import-from-trip"
import type { TripNote } from "@/lib/trips/note-queries"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { slugToTone, type CardTone } from "@/lib/trips/slug-tone"

import type { MemberToneEntry } from "./packing-tab"

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

function formatNoteDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso))
}

// Tone text color for the location header name (matches itinerary headers).
const toneText: Record<CardTone, string> = {
  sea: "text-sea",
  clay: "text-clay",
  moss: "text-moss",
  sand: "text-sand",
}

const GENERAL_KEY = "__general__"

interface NoteGroup {
  key: string
  name: string
  tone: CardTone | null
  /** Location to file new notes under; null = General. */
  locationId: string | null
  notes: TripNote[]
}

/** General block first, then one block per location in sort order. Notes keep
 * the newest-first order they arrive in from getTripNotes. */
function buildGroups(
  notes: TripNote[],
  locations: ItineraryLocation[],
): NoteGroup[] {
  const byLoc = new Map<string, TripNote[]>()
  const general: TripNote[] = []
  for (const n of notes) {
    if (n.locationId) {
      const arr = byLoc.get(n.locationId)
      if (arr) arr.push(n)
      else byLoc.set(n.locationId, [n])
    } else {
      general.push(n)
    }
  }
  const groups: NoteGroup[] = [
    {
      key: GENERAL_KEY,
      name: "General",
      tone: null,
      locationId: null,
      notes: general,
    },
  ]
  for (const loc of locations) {
    groups.push({
      key: loc.id,
      name: loc.name,
      tone: slugToTone(loc.id),
      locationId: loc.id,
      notes: byLoc.get(loc.id) ?? [],
    })
  }
  return groups
}

export function NotesTab({
  tripId,
  tripSlug,
  initialNotes,
  locations,
  members,
}: {
  tripId: string
  tripSlug: string
  initialNotes: TripNote[]
  locations: ItineraryLocation[]
  members: Record<string, MemberToneEntry>
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState<Set<string>>(new Set())

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const groups = buildGroups(initialNotes, locations)

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      <div className="flex items-baseline justify-between">
        <Label>Notes</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="mt-4">
        <ImportFromTripControl
          tripId={tripId}
          label="Copy notes from another trip"
          onCopy={(src) => copyNotesFromTrip(tripId, src, tripSlug)}
        />
      </div>

      <div className="mt-5">
        {groups.map((group) => {
          const isOpen = open.has(group.key)
          const count = group.notes.length
          return (
            <div
              key={group.key}
              className="border-t border-rule first:border-t-0"
            >
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`t-display block text-[20px] leading-none ${
                      group.tone ? toneText[group.tone] : "text-foreground"
                    }`}
                  >
                    {group.name}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {count === 0
                      ? "no notes"
                      : `${count} ${count === 1 ? "note" : "notes"}`}
                  </span>
                </span>
                <span className="px-1 font-mono text-[13px] leading-none text-muted-foreground">
                  {isOpen ? "⌄" : "›"}
                </span>
              </button>

              {isOpen ? (
                <div className="pb-4">
                  <AddNoteRow
                    tripId={tripId}
                    tripSlug={tripSlug}
                    locationId={group.locationId}
                  />
                  {count === 0 ? null : (
                    <div className="mt-4 flex flex-col gap-5">
                      {group.notes.map((note) => (
                        <NoteCard
                          key={note.id}
                          note={note}
                          tripSlug={tripSlug}
                          locations={locations}
                          member={members[note.createdBy]}
                          isEditing={editingId === note.id}
                          onStartEdit={() => setEditingId(note.id)}
                          onStopEdit={() => setEditingId(null)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function AddNoteRow({
  tripId,
  tripSlug,
  locationId,
}: {
  tripId: string
  tripSlug: string
  locationId: string | null
}) {
  const [body, setBody] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await addNote({ tripId, tripSlug, body, locationId })
      if (result.error) {
        setError(result.error)
        return
      }
      setBody("")
      textareaRef.current?.focus()
    })
  }

  return (
    <form onSubmit={submit}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="jot down a note…"
        rows={3}
        disabled={isPending}
        className="w-full resize-none rounded-lg border border-rule bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50 [field-sizing:content]"
      />
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          disabled={!body.trim() || isPending}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "+ save"}
        </button>
      </div>
    </form>
  )
}

function NoteCard({
  note,
  tripSlug,
  locations,
  member,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  note: TripNote
  tripSlug: string
  locations: ItineraryLocation[]
  member: MemberToneEntry | undefined
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  if (isEditing) {
    return (
      <NoteEditor
        note={note}
        tripSlug={tripSlug}
        locations={locations}
        onDone={onStopEdit}
      />
    )
  }
  return (
    <NoteView
      note={note}
      tripSlug={tripSlug}
      member={member}
      onStartEdit={onStartEdit}
    />
  )
}

function NoteView({
  note,
  tripSlug,
  member,
  onStartEdit,
}: {
  note: TripNote
  tripSlug: string
  member: MemberToneEntry | undefined
  onStartEdit: () => void
}) {
  return (
    <div>
      <p className="whitespace-pre-wrap text-[14px] leading-snug text-foreground">
        {note.body}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {member ? (
            <Avatar name={member.displayName} size={18} tone={member.tone} />
          ) : null}
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {formatNoteDate(note.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onStartEdit}
            className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            aria-label="Edit note"
          >
            ✎
          </button>
          <form
            action={deleteNote.bind(null, note.id, tripSlug)}
            onSubmit={(e) => {
              if (!window.confirm("Delete this note? This can't be undone.")) {
                e.preventDefault()
              }
            }}
            className="inline-flex"
          >
            <button
              type="submit"
              className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
              aria-label="Delete note"
            >
              ×
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function NoteEditor({
  note,
  tripSlug,
  locations,
  onDone,
}: {
  note: TripNote
  tripSlug: string
  locations: ItineraryLocation[]
  onDone: () => void
}) {
  const [body, setBody] = React.useState(note.body)
  const [locationId, setLocationId] = React.useState<string | null>(
    note.locationId,
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await updateNote({
        noteId: note.id,
        tripSlug,
        body,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <form onSubmit={save}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        disabled={isPending}
        autoFocus
        className="w-full resize-none rounded-lg border border-clay bg-card px-3 py-2 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50 [field-sizing:content]"
      />
      <label className="mt-2 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Location
        </span>
        <Select
          value={locationId}
          onValueChange={(value: string | null) => setLocationId(value)}
          disabled={isPending}
        >
          <SelectTrigger className="py-1.5">
            <SelectValue>
              {(value: string | null) =>
                value === null
                  ? "General (no location)"
                  : (locations.find((l) => l.id === value)?.name ??
                    "General (no location)")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>General (no location)</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={!body.trim() || isPending}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
      </div>
    </form>
  )
}
