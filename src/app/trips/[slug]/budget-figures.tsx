"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { updateTripBudget } from "@/lib/trips/actions"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

function Cue({ label }: { label: string }) {
  return (
    <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
      {label}
    </span>
  )
}

function AmountField({
  valueCents,
  onSave,
  trigger,
  additive = false,
}: {
  valueCents: number
  onSave: (cents: number) => Promise<{ error?: string }>
  trigger: React.ReactNode
  /** When true, the entered amount is added to the current value instead of replacing it. */
  additive?: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function open() {
    // Additive fields start blank (you type the amount to add); replace fields
    // pre-fill the current value so an edit is a tweak, not a retype.
    setValue(!additive && valueCents > 0 ? (valueCents / 100).toFixed(0) : "")
    setError(null)
    setEditing(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const num = Number(value)
    if (!Number.isFinite(num) || num < 0) {
      setError("Enter a valid amount.")
      return
    }
    const cents = Math.round(num * 100)
    const next = additive ? valueCents + cents : cents
    startTransition(async () => {
      const result = await onSave(next)
      if (result.error) {
        setError(result.error)
        return
      }
      setEditing(false)
    })
  }

  if (!editing) {
    // For an additive field with nothing saved yet, the trigger placeholder
    // ("+ set savings") already carries the affordance, so skip the cue.
    const showCue = !additive || valueCents > 0
    return (
      <button
        type="button"
        onClick={open}
        className="inline-flex items-baseline border-0 bg-transparent p-0 text-left"
      >
        {trigger}
        {showCue ? <Cue label={additive ? "+" : "edit"} /> : null}
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditing(false)
      }}
      className="inline-flex items-center gap-1.5"
    >
      <span className="t-display text-[20px] text-muted-foreground">
        {additive ? "+€" : "€"}
      </span>
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isPending}
        className="t-num w-24 border-0 border-b border-border bg-transparent text-[20px] text-foreground outline-none focus:border-foreground"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full border-0 bg-foreground px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
      >
        {isPending ? "…" : additive ? "add" : "save"}
      </button>
      {error ? (
        <span className="font-mono text-[9px] text-clay">{error}</span>
      ) : null}
    </form>
  )
}

export interface BudgetFiguresProps {
  tripId: string
  tripSlug: string
  spentCents: number
  plannedBudgetCents: number
  savedCents: number
}

export function BudgetFigures({
  tripId,
  tripSlug,
  spentCents,
  plannedBudgetCents,
  savedCents,
}: BudgetFiguresProps) {
  const hasPlanned = plannedBudgetCents > 0
  const leftCents = Math.max(0, plannedBudgetCents - spentCents)
  const spentPct = hasPlanned
    ? Math.min(100, Math.round((spentCents / plannedBudgetCents) * 100))
    : 0
  const savedToGo = Math.max(0, plannedBudgetCents - savedCents)
  const savedPct = hasPlanned
    ? Math.min(100, Math.round((savedCents / plannedBudgetCents) * 100))
    : 0

  const savePlanned = (cents: number) =>
    updateTripBudget({ tripId, tripSlug, plannedBudgetCents: cents })
  const saveSaved = (cents: number) =>
    updateTripBudget({ tripId, tripSlug, savedCents: cents })

  return (
    <>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="t-display text-[22px] text-muted-foreground">€</span>
        <span className="t-display t-num text-[42px] leading-none text-foreground">
          {fmt(spentCents)}
        </span>
        <AmountField
          valueCents={plannedBudgetCents}
          onSave={savePlanned}
          trigger={
            hasPlanned ? (
              <span className="t-display text-[22px] text-muted-foreground">
                {" "}/ €{fmt(plannedBudgetCents)}
              </span>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                + set a budget
              </span>
            )
          }
        />
      </div>

      {hasPlanned ? (
        <>
          <div className="mt-3">
            <Bar pct={spentPct} tone="sea" />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>{spentPct}% of planned</span>
            <span>€{fmt(leftCents)} left</span>
          </div>
        </>
      ) : null}

      <div className="mt-5">
        <Label>Saved so far</Label>
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="t-display text-[18px] text-muted-foreground">€</span>
          <span className="t-display t-num text-[28px] leading-none text-foreground">
            {fmt(savedCents)}
          </span>
          <AmountField
            additive
            valueCents={savedCents}
            onSave={saveSaved}
            trigger={
              savedCents > 0 ? (
                hasPlanned ? (
                  <span className="t-display text-[18px] text-muted-foreground">
                    {" "}/ €{fmt(plannedBudgetCents)}
                  </span>
                ) : (
                  <span className="t-display text-[18px] text-muted-foreground" />
                )
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  + set savings
                </span>
              )
            }
          />
        </div>
        {hasPlanned && savedCents > 0 ? (
          <>
            <div className="mt-3">
              <Bar pct={savedPct} tone="moss" />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              <span>{savedPct}% saved</span>
              <span>€{fmt(savedToGo)} to go</span>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
