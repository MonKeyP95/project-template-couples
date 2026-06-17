"use client"

import * as React from "react"

import { updateTripBudget } from "@/lib/trips/actions"

/** Plain manual budget editor shown when AI mode is off, so a budget can be
 * set without the AI drafter. Writes via the same updateTripBudget action. */
export function BudgetTotalField({
  tripId,
  tripSlug,
  plannedBudgetCents,
}: {
  tripId: string
  tripSlug: string
  plannedBudgetCents: number
}) {
  const [value, setValue] = React.useState(
    plannedBudgetCents > 0 ? (plannedBudgetCents / 100).toFixed(0) : "",
  )
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function save() {
    const n = Number(value)
    const cents = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : -1
    if (cents < 0) {
      setError("Enter a valid amount.")
      return
    }
    setError(null)
    startTransition(async () => {
      const r = await updateTripBudget({ tripId, tripSlug, plannedBudgetCents: cents })
      if (r.error) setError(r.error)
    })
  }

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="flex items-center justify-between gap-3">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Budget total
        </label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">€</span>
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 rounded-lg border border-clay bg-transparent px-3 py-1.5 text-right font-mono text-[12px] text-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            save
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 text-[11px] text-clay">{error}</p> : null}
    </div>
  )
}
