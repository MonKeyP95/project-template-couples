"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addNote } from "@/lib/trips/actions"
import { Label } from "@/components/together"
import type { TripNote } from "@/lib/trips/note-queries"

export interface QuickNoteProps {
  tripId: string
  tripSlug: string
  today: string
  notes: TripNote[]
}

export function QuickNote({ tripId, tripSlug, today, notes }: QuickNoteProps) {
  const router = useRouter()
  const [body, setBody] = React.useState("")
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
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setBody("")
      setError(null)
      router.refresh()
    })
  }

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <Label>Note</Label>
      <form onSubmit={submit} className="mt-3 flex gap-2">
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
          className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
      </form>
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-0.5">
          {notes.map((n) => (
            <li key={n.id} className="text-[13px] leading-snug text-foreground">
              {n.body}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
