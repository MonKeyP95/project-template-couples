"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addNote } from "@/lib/trips/actions"
import type { TripNote } from "@/lib/trips/note-queries"
import { fromLocalInput, isDue, reminderLabel } from "@/lib/trips/note-reminders"
import { ReminderDue } from "@/app/trips/[slug]/note-parts"
import { RemindField } from "@/app/trips/[slug]/remind-field"

export interface QuickNoteProps {
  tripId: string
  tripSlug: string
  today: string
  /** Due notes first, then today's. */
  notes: TripNote[]
  tz: string
  now: number
}

export function QuickNote({ tripId, tripSlug, today, notes, tz, now }: QuickNoteProps) {
  const router = useRouter()
  const [body, setBody] = React.useState("")
  const [remind, setRemind] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !body.trim()) return
    startTransition(async () => {
      const result = await addNote({
        tripId,
        tripSlug,
        body: body.trim(),
        dayDate: today,
        remindAt: fromLocalInput(remind),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setBody("")
      setRemind("")
      setError(null)
      router.refresh()
    })
  }

  return (
    <div className="px-[18px] py-3">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="note to remember today…"
          disabled={isPending}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground"
        />
        <button
          type="submit"
          disabled={isPending || !body.trim()}
          className="rounded-full border-0 bg-sea px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
      </form>
      <RemindField value={remind} onChange={setRemind} disabled={isPending} />
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-0.5">
          {notes.map((n) => (
            <li
              key={n.id}
              className={`text-[13px] leading-snug text-foreground ${isDue(n, new Date(now)) ? "border-l-2 border-clay py-1 pl-3" : ""}`}
            >
              {isDue(n, new Date(now)) && n.remindAt ? (
                <ReminderDue noteId={n.id} tripSlug={tripSlug} label={reminderLabel(n.remindAt, tz)} />
              ) : null}
              {n.body}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
