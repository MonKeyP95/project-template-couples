"use client"

import * as React from "react"

import { partialSettleUp, settleUp } from "@/lib/trips/actions"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

export interface SettleUpButtonsProps {
  owedCents: number
  tripId: string
  tripSlug: string
}

/** The settle + partial controls, shared by the full card and the compact strip. */
export function SettleUpButtons({
  owedCents,
  tripId,
  tripSlug,
}: SettleUpButtonsProps) {
  const [showInput, setShowInput] = React.useState(false)
  const [amount, setAmount] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submitPartial(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    startTransition(async () => {
      const result = await partialSettleUp(tripId, tripSlug, amount)
      if (result.error) {
        setError(result.error)
        return
      }
      setAmount("")
      setShowInput(false)
      setError(null)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <form action={settleUp.bind(null, tripId, tripSlug)}>
          <button
            type="submit"
            className="rounded-full border-0 bg-foreground px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-background"
          >
            settle up
          </button>
        </form>
        {showInput ? (
          <form onSubmit={submitPartial} className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={fmt(owedCents)}
              disabled={isPending}
              aria-label="Partial amount"
              className="t-num w-20 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full border-0 bg-foreground px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
            >
              ok
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowInput(true)
              setError(null)
            }}
            className="rounded-full border border-border bg-card px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground"
          >
            partial
          </button>
        )}
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}
