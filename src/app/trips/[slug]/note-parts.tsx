"use client"

import * as React from "react"

import { Avatar } from "@/components/together"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { addNote, clearNoteReminder, deleteNote, updateNote } from "@/lib/trips/actions"
import {
  fromLocalInput,
  isDue,
  reminderLabel,
  toLocalInput,
} from "@/lib/trips/note-reminders"
import type { TripNote } from "@/lib/trips/note-queries"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { slugToTone, type CardTone } from "@/lib/trips/slug-tone"

import type { MemberToneEntry } from "./packing-tab"
import { RemindField } from "./remind-field"

const TRIP_WIDE = "Trip-wide"

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

function formatNoteDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso))
}

const toneText: Record<CardTone, string> = {
  sea: "text-sea",
  clay: "text-clay",
  moss: "text-moss",
  sand: "text-sand",
}

/** The note's place name, or "Trip-wide" when it has none (or it was deleted). */
export function placeName(locationId: string | null, locations: ItineraryLocation[]): string {
  return locations.find((l) => l.id === locationId)?.name ?? TRIP_WIDE
}

/** Small place label on a note, in the place's itinerary tone. */
export function PlaceTag({
  locationId,
  locations,
}: {
  locationId: string | null
  locations: ItineraryLocation[]
}) {
  const found = locations.some((l) => l.id === locationId)
  const color = found && locationId ? toneText[slugToTone(locationId)] : "text-muted-foreground"
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${color}`}>
      {placeName(locationId, locations)}
    </span>
  )
}

function PlacePicker({
  value,
  onChange,
  locations,
  disabled,
}: {
  value: string | null
  onChange: (value: string | null) => void
  locations: ItineraryLocation[]
  disabled?: boolean
}) {
  return (
    <label className="mt-2 block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Place
      </span>
      <Select value={value} onValueChange={(v: string | null) => onChange(v)} disabled={disabled}>
        <SelectTrigger className="py-1.5">
          <SelectValue>{(v: string | null) => placeName(v, locations)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>{TRIP_WIDE}</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

const TEXTAREA =
  "w-full resize-none rounded-lg border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:border-clay focus:outline-none disabled:opacity-50 [field-sizing:content]"
const SAVE =
  "rounded-full border-0 bg-sea px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"

/** New note box: text, optional place (Trip-wide by default), save. Stays open for the next note. */
export function AddNoteForm({
  tripId,
  tripSlug,
  locations,
}: {
  tripId: string
  tripSlug: string
  locations: ItineraryLocation[]
}) {
  const [body, setBody] = React.useState("")
  const [locationId, setLocationId] = React.useState<string | null>(null)
  const [remind, setRemind] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await addNote({
        tripId,
        tripSlug,
        body,
        locationId,
        remindAt: fromLocalInput(remind),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setBody("")
      setRemind("")
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
        className={`${TEXTAREA} border-rule`}
      />
      <PlacePicker value={locationId} onChange={setLocationId} locations={locations} disabled={isPending} />
      <RemindField value={remind} onChange={setRemind} disabled={isPending} />
      {error ? <div className="mt-2 font-mono text-[10px] text-clay">{error}</div> : null}
      <div className="mt-2 flex justify-end">
        <button type="submit" disabled={!body.trim() || isPending} className={SAVE}>
          {isPending ? "…" : "+ save"}
        </button>
      </div>
    </form>
  )
}

export function NoteCard({
  note,
  tripSlug,
  locations,
  member,
  isEditing,
  onStartEdit,
  onStopEdit,
  tz,
  now,
}: {
  note: TripNote
  tripSlug: string
  locations: ItineraryLocation[]
  member: MemberToneEntry | undefined
  isEditing: boolean
  /** Device timezone (tz cookie) for showing and editing the reminder. */
  tz: string
  /** Render time in ms, from the server, so due-ness matches on both sides. */
  now: number
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  if (isEditing) {
    return (
      <NoteEditor note={note} tripSlug={tripSlug} locations={locations} tz={tz} onDone={onStopEdit} />
    )
  }
  return (
    <NoteView
      note={note}
      tripSlug={tripSlug}
      locations={locations}
      member={member}
      onStartEdit={onStartEdit}
      tz={tz}
      now={now}
    />
  )
}

function NoteView({
  note,
  tripSlug,
  locations,
  member,
  onStartEdit,
  tz,
  now,
}: {
  note: TripNote
  tripSlug: string
  locations: ItineraryLocation[]
  member: MemberToneEntry | undefined
  onStartEdit: () => void
  tz: string
  now: number
}) {
  const due = isDue(note, new Date(now))
  return (
    <div className={due ? "border-l-2 border-clay pl-3" : undefined}>
      {due && note.remindAt ? (
        <ReminderDue noteId={note.id} tripSlug={tripSlug} label={reminderLabel(note.remindAt, tz)} />
      ) : null}
      <p className="whitespace-pre-wrap text-[14px] leading-snug text-foreground">{note.body}</p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {member ? <Avatar name={member.displayName} size={18} tone={member.tone} /> : null}
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {formatNoteDate(note.createdAt)}
          </span>
          <PlaceTag locationId={note.locationId} locations={locations} />
          {note.remindAt && !due ? (
            <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              remind {reminderLabel(note.remindAt, tz)}
            </span>
          ) : null}
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
  tz,
  onDone,
}: {
  note: TripNote
  tripSlug: string
  locations: ItineraryLocation[]
  tz: string
  onDone: () => void
}) {
  const [body, setBody] = React.useState(note.body)
  const [locationId, setLocationId] = React.useState<string | null>(note.locationId)
  const [remind, setRemind] = React.useState(() => toLocalInput(note.remindAt, tz))
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
        remindAt: remind === toLocalInput(note.remindAt, tz) ? note.remindAt : fromLocalInput(remind),
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
        className={`${TEXTAREA} border-clay`}
      />
      <PlacePicker value={locationId} onChange={setLocationId} locations={locations} disabled={isPending} />
      <RemindField value={remind} onChange={setRemind} disabled={isPending} />
      {error ? <div className="mt-2 font-mono text-[10px] text-clay">{error}</div> : null}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button type="submit" disabled={!body.trim() || isPending} className={SAVE}>
          {isPending ? "…" : "save"}
        </button>
      </div>
    </form>
  )
}

/** A due reminder line: when it was for, and "done" to clear it. */
export function ReminderDue({
  noteId,
  tripSlug,
  label,
}: {
  noteId: string
  tripSlug: string
  label: string
}) {
  const [isPending, startTransition] = React.useTransition()
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-clay">
        reminder · {label}
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(async () => void (await clearNoteReminder(noteId, tripSlug)))}
        className="rounded-full border border-clay px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-clay hover:bg-clay-tint disabled:opacity-40"
      >
        {isPending ? "…" : "done"}
      </button>
    </div>
  )
}
