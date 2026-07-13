"use client"

import * as React from "react"

import { logExpense } from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { MemberToneEntry } from "./packing-tab"

export interface EventExpenseProps {
  tripId: string
  tripSlug: string
  /** Expense title; the event's own text. */
  eventText: string
  /** Inherited from the event's day. */
  dayDate: string
  locationId: string | null
  currentUserId: string
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
}

/**
 * Compact "log a real expense against this event" control. Collapsed to a small
 * button; expands to amount + category + paid-by. Title, day, and location are
 * inherited from the event and its day, so they are not shown. Writes an
 * `expenses` row via `logExpense`; the itinerary itself does not change.
 */
export function EventExpense({
  tripId,
  tripSlug,
  eventText,
  dayDate,
  locationId,
  currentUserId,
  categories,
  members,
}: EventExpenseProps) {
  const [open, setOpen] = React.useState(false)
  const [amount, setAmount] = React.useState("")
  const [category, setCategory] = React.useState(categories[0]?.name ?? "")
  const [paidBy, setPaidBy] = React.useState(currentUserId)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit = Number.isFinite(Number(amount)) && Number(amount) > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !canSubmit) return
    startTransition(async () => {
      const result = await logExpense({
        tripId,
        tripSlug,
        title: eventText.trim() || "Expense",
        amount,
        category,
        paidBy,
        dayDate,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setAmount("")
      setError(null)
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add an expense for this event"
        className="mt-0.5 border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
      >
        + expense
      </button>
    )
  }

  const memberEntries = Object.entries(members)

  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <div className="flex w-24 items-baseline gap-1 rounded-lg border border-border bg-background px-2 py-1">
          <span className="font-mono text-[13px] text-muted-foreground">€</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            disabled={isPending}
            className="t-num w-full border-0 bg-transparent font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={isPending}
          className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        {memberEntries.length === 2 ? (
          <div className="inline-flex rounded-full border border-border bg-background p-0.5">
            {memberEntries.map(([userId, m]) => {
              const activePill = userId === paidBy
              return (
                <button
                  key={userId}
                  type="button"
                  onClick={() => setPaidBy(userId)}
                  disabled={isPending}
                  aria-pressed={activePill}
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                    activePill
                      ? m.tone === "sea"
                        ? "bg-sea text-background"
                        : "bg-clay text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.initial}
                </button>
              )
            })}
          </div>
        ) : (
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
            disabled={isPending}
            className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
          >
            {memberEntries.map(([userId, m]) => (
              <option key={userId} value={userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={isPending || !canSubmit}
          className="rounded-full border-0 bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={isPending}
          aria-label="Cancel"
          className="border-0 bg-transparent px-1 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}
