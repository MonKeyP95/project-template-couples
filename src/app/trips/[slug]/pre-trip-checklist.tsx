"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { savePreTripItems } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"

const PRE_TRIP_CATEGORY = "Pre-trip"

const SLOTS = [
  { label: "Flights / getting there", noun: "flight" },
  { label: "Travel insurance", noun: "policy" },
  { label: "Docs & fees", noun: "doc" },
  { label: "Medicine / vaccinations", noun: "item" },
  { label: "Gear & equipment", noun: "item" },
] as const

const STEP_COUNT = SLOTS.length + 2

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

interface Row {
  id: string
  /** The saved item's id, when this row round-tripped from the budget. */
  itemId?: string
  subject: string
  note: string
  value: string
  /** A fixed slot's label is not editable; added rows are, and can be removed. */
  fixed: boolean
}

export interface PreTripChecklistProps {
  tripId: string
  tripSlug: string
  budgetItems: BudgetItem[]
}

export function PreTripChecklist({
  tripId,
  tripSlug,
  budgetItems,
}: PreTripChecklistProps) {
  const [rows, setRows] = React.useState<Row[]>(() => {
    const preTrip = budgetItems.filter((i) => i.category === PRE_TRIP_CATEGORY)
    const slotLabels = new Set<string>(SLOTS.map((s) => s.label))
    const fixed: Row[] = []
    for (const { label } of SLOTS) {
      const items = preTrip.filter((i) => i.subject.trim() === label)
      if (items.length === 0) {
        fixed.push({ id: `slot-${label}-new`, subject: label, note: "", value: "", fixed: true })
      } else {
        items.forEach((it, k) => {
          fixed.push({
            id: `slot-${label}-${k}`,
            itemId: it.id,
            subject: label,
            note: it.whenLabel,
            value: it.amountCents > 0 ? fmt(it.amountCents) : "",
            fixed: true,
          })
        })
      }
    }
    const added: Row[] = preTrip
      .filter((i) => !slotLabels.has(i.subject.trim()))
      .map((i) => ({
        id: `added-${i.id}`,
        itemId: i.id,
        subject: i.subject,
        note: i.whenLabel,
        value: i.amountCents > 0 ? fmt(i.amountCents) : "",
        fixed: false,
      }))
    return [...fixed, ...added]
  })
  const [open, setOpen] = React.useState(false)
  const [stepIndex, setStepIndex] = React.useState(0)
  const [isPending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }

  function addRow() {
    setRows((rs) => [
      ...rs,
      { id: `new-${crypto.randomUUID()}`, subject: "", note: "", value: "", fixed: false },
    ])
  }

  function addSlotRow(label: string) {
    setRows((rs) => [
      ...rs,
      { id: `new-${crypto.randomUUID()}`, subject: label, note: "", value: "", fixed: true },
    ])
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function save() {
    if (isPending) return
    setError(null)
    const items = rows
      .filter((r) => asCents(r.value) > 0 && r.subject.trim() !== "")
      .map((r) => ({
        id: r.itemId,
        category: PRE_TRIP_CATEGORY,
        subject: r.subject.trim(),
        whenLabel: r.note.trim(),
        amountCents: asCents(r.value),
        locationId: null,
      }))
    startTransition(async () => {
      const res = await savePreTripItems({ tripId, tripSlug, items })
      if (res.error) setError(res.error)
      else setOpen(false)
    })
  }

  const total = rows.reduce((s, r) => s + asCents(r.value), 0)
  const addedRows = rows.filter((r) => !r.fixed)
  const slotRows = (label: string) => rows.filter((r) => r.fixed && r.subject === label)

  if (!open) {
    const hasItems = rows.some((r) => asCents(r.value) > 0)
    return (
      <div className="flex items-center justify-between border-t border-border px-5 pt-4 pb-3">
        <button
          type="button"
          onClick={() => {
            setStepIndex(0)
            setOpen(true)
          }}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          {hasItems ? "Edit before-you-go" : "Fill before-you-go"}
        </button>
        <span className="t-num font-mono text-[13px] text-muted-foreground">€{fmt(total)}</span>
      </div>
    )
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-4">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        {stepIndex < SLOTS.length
          ? renderSlotStep(SLOTS[stepIndex], stepIndex)
          : stepIndex === SLOTS.length
            ? renderExtrasStep()
            : renderReview()}
      </div>
    </div>
  )

  function stepHeader(right: React.ReactNode) {
    return (
      <div className="flex items-center justify-between">
        <Label>before you go</Label>
        {right}
      </div>
    )
  }

  function renderSlotStep(slot: { label: string; noun: string }, i: number) {
    const slotItems = slotRows(slot.label)
    return (
      <>
        {stepHeader(
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {i + 1} of {STEP_COUNT}
          </span>,
        )}

        <div className="mt-2 font-serif text-[15px] italic text-foreground">
          {slot.label}
        </div>

        <div className="mt-3 space-y-2">
          {slotItems.map((row) => (
            <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={row.note}
                  placeholder="Note (optional)"
                  onChange={(e) => patch(row.id, { note: e.target.value })}
                  disabled={isPending}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
                />
                <span className="inline-flex items-baseline gap-1">
                  <span className="font-mono text-[12px] text-muted-foreground">€</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={row.value}
                    onChange={(e) => patch(row.id, { value: e.target.value })}
                    disabled={isPending}
                    className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
                  />
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={isPending}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2">
          <button
            type="button"
            onClick={() => addSlotRow(slot.label)}
            disabled={isPending}
            className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            + add {slot.noun}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStepIndex((s) => Math.max(0, s - 1))}
            disabled={i === 0}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => setStepIndex((s) => s + 1)}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              next
            </button>
          </div>
        </div>
      </>
    )
  }

  function renderExtrasStep() {
    return (
      <>
        {stepHeader(
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {SLOTS.length + 1} of {STEP_COUNT}
          </span>,
        )}

        <div className="mt-2 font-serif text-[15px] italic text-foreground">
          Anything else?
        </div>

        <div className="mt-3 space-y-2">
          {addedRows.map((row) => (
            <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.subject}
                  placeholder="What"
                  onChange={(e) => patch(row.id, { subject: e.target.value })}
                  disabled={isPending}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={isPending}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={row.note}
                  placeholder="Note (optional)"
                  onChange={(e) => patch(row.id, { note: e.target.value })}
                  disabled={isPending}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
                />
                <span className="inline-flex items-baseline gap-1">
                  <span className="font-mono text-[12px] text-muted-foreground">€</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={row.value}
                    onChange={(e) => patch(row.id, { value: e.target.value })}
                    disabled={isPending}
                    className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
                  />
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2">
          <button
            type="button"
            onClick={addRow}
            disabled={isPending}
            className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            + add item
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStepIndex(SLOTS.length - 1)}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => setStepIndex((s) => s + 1)}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              next
            </button>
          </div>
        </div>
      </>
    )
  }

  function renderReview() {
    const lines = rows.filter((r) => asCents(r.value) > 0)
    return (
      <>
        {stepHeader(
          <button
            type="button"
            onClick={() => setStepIndex(SLOTS.length)}
            disabled={isPending}
            className="border-0 bg-transparent p-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            back
          </button>,
        )}

        <div className="mt-2 border-t border-rule">
          {lines.length === 0 ? (
            <div className="py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Nothing added yet
            </div>
          ) : (
            lines.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="text-[13px] text-foreground">{row.subject.trim()}</span>
                  {row.note.trim() ? (
                    <span className="ml-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
                      {row.note.trim()}
                    </span>
                  ) : null}
                </span>
                <span className="t-num font-mono text-[13px] text-foreground">
                  €{fmt(asCents(row.value))}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-serif text-[15px] italic text-foreground">Pre-trip</span>
          <span className="t-num text-[18px] text-foreground">€{fmt(total)}</span>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "apply"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            cancel
          </button>
          {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
        </div>
      </>
    )
  }
}
