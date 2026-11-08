"use client"

import * as React from "react"

import { normalizeTime } from "./event-draft-rows"

const labelClass =
  "block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"

/** The always-open "Add event" box of a day form: start, end and what happens.
 * `onAdd` appends the typed event to the form's list. */
export function AddEventBox({
  time,
  setTime,
  endTime,
  setEndTime,
  text,
  setText,
  onAdd,
  isPending,
  autoFocus,
}: {
  time: string
  setTime: (s: string) => void
  endTime: string
  setEndTime: (s: string) => void
  text: string
  setText: (s: string) => void
  onAdd: () => void
  isPending: boolean
  autoFocus?: boolean
}) {
  // Enter adds the event instead of submitting the whole day form.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return
    e.preventDefault()
    onAdd()
  }

  return (
    <div className="rounded-lg border border-rule p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground">
        Add event
      </div>

      <div className="mt-2 flex items-end gap-2">
        <label className="block w-16 shrink-0">
          <span className={labelClass}>Time</span>
          <input
            type="text"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={() => setTime(normalizeTime(time))}
            onKeyDown={onKeyDown}
            placeholder="00:00"
            disabled={isPending}
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
        <label className="block w-16 shrink-0">
          <span className={labelClass}>End</span>
          <input
            type="text"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            onBlur={() => setEndTime(normalizeTime(endTime))}
            onKeyDown={onKeyDown}
            placeholder="00:00"
            disabled={isPending}
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
        <label className="block min-w-0 flex-1">
          <span className={labelClass}>What happens</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Dinner at the harbour"
            autoFocus={autoFocus}
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          disabled={isPending || !text.trim()}
          className="rounded-full border border-foreground bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground disabled:opacity-40"
        >
          add
        </button>
      </div>
    </div>
  )
}
