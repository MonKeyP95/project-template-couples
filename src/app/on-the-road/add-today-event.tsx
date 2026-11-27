"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { submitOrQueue } from "@/lib/offline/send"
import { PendingList } from "@/components/offline/pending-list"
import { deviceToday } from "@/lib/time/today"

/** "21" -> "21:00", "9:3" -> "09:30". Leaves unparseable input untouched. */
function normalizeTime(raw: string): string {
  const t = raw.trim()
  if (!t) return ""
  const m = t.match(/^(\d{1,2})(?::?(\d{0,2}))?$/)
  if (!m) return t
  const h = m[1].padStart(2, "0")
  const min = (m[2] ?? "").padEnd(2, "0").slice(0, 2)
  return `${h}:${min}`
}

/** Adds a timed event to today. Always by date (the phone's), so a copy stored
 * yesterday still writes today; the action appends to that date's day. */
export function AddTodayEvent({ tripId, tripSlug }: { tripId: string; tripSlug: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [time, setTime] = React.useState("")
  const [text, setText] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !text.trim()) return
    startTransition(async () => {
      const result = await submitOrQueue({
        kind: "event",
        id: crypto.randomUUID(),
        queuedAt: new Date().toISOString(),
        input: {
          tripId,
          tripSlug,
          dayDate: deviceToday(),
          dayId: null,
          time: normalizeTime(time),
          text: text.trim(),
        },
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setTime("")
      setText("")
      setError(null)
      setOpen(false)
      if (!result.queued) router.refresh()
    })
  }

  const pending = (
    <PendingList kind="event" label={(i) => `${i.input.time} ${i.input.text}`.trim()} />
  )

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          add event
        </button>
        {pending}
      </>
    )
  }

  return (
    <>
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => setTime((t) => normalizeTime(t))}
          inputMode="numeric"
          placeholder="00:00"
          disabled={isPending}
          className="w-20 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="what's happening?"
          disabled={isPending}
          autoFocus
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground"
        />
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !text.trim()}
          className="rounded-full border-0 bg-sea px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "add event"}
        </button>
      </div>
    </form>
    {pending}
    </>
  )
}
