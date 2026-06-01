"use client"

import * as React from "react"

import { Avatar, Label } from "@/components/together"
import { addNote, deleteNote, updateNote } from "@/lib/trips/actions"
import type { TripNote } from "@/lib/trips/note-queries"

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

export function NotesTab({
  tripId,
  tripSlug,
  initialNotes,
  members,
}: {
  tripId: string
  tripSlug: string
  initialNotes: TripNote[]
  members: Record<string, MemberToneEntry>
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null)

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      <div className="flex items-baseline justify-between">
        <Label>Notes</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="mt-4">
        <AddNoteRow tripId={tripId} tripSlug={tripSlug} />
      </div>

      {initialNotes.length === 0 ? (
        <p className="mt-5 font-serif text-[15px] italic text-muted-foreground">
          No notes yet — jot the first one.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          {initialNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              tripSlug={tripSlug}
              member={members[note.createdBy]}
              isEditing={editingId === note.id}
              onStartEdit={() => setEditingId(note.id)}
              onStopEdit={() => setEditingId(null)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AddNoteRow({
  tripId,
  tripSlug,
}: {
  tripId: string
  tripSlug: string
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
      const result = await addNote({ tripId, tripSlug, body })
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
  member,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  note: TripNote
  tripSlug: string
  member: MemberToneEntry | undefined
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  if (isEditing) {
    return <NoteEditor note={note} tripSlug={tripSlug} onDone={onStopEdit} />
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
            <Avatar
              name={member.displayName}
              size={18}
              tone={member.tone}
            />
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
              if (
                !window.confirm("Delete this note? This can't be undone.")
              ) {
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
  onDone,
}: {
  note: TripNote
  tripSlug: string
  onDone: () => void
}) {
  const [body, setBody] = React.useState(note.body)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await updateNote({ noteId: note.id, tripSlug, body })
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
