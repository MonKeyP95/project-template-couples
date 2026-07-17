"use client"

import * as React from "react"

import { savePreTripItems } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"

const PRE_TRIP_CATEGORY = "Pre-trip"

const SLOTS = [
  "Flights / getting there",
  "Travel insurance",
  "Docs & fees",
  "Medicine / vaccinations",
  "Gear & equipment",
] as const

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
    const bySubject = new Map(preTrip.map((i) => [i.subject.trim(), i]))
    const used = new Set<string>()
    const fixed: Row[] = SLOTS.map((label, i) => {
      const it = bySubject.get(label)
      if (it) used.add(label)
      return {
        id: `slot-${i}`,
        itemId: it?.id,
        subject: label,
        note: it?.whenLabel ?? "",
        value: it && it.amountCents > 0 ? fmt(it.amountCents) : "",
        fixed: true,
      }
    })
    const added: Row[] = preTrip
      .filter((i) => !used.has(i.subject.trim()))
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
    })
  }

  const total = rows.reduce((s, r) => s + asCents(r.value), 0)

  return (
    <div className="border-t border-border px-5 pt-4 pb-4">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
            <div className="flex items-center gap-2">
              {row.fixed ? (
                <span className="min-w-0 flex-1 text-[13px] text-foreground">
                  {row.subject}
                </span>
              ) : (
                <input
                  type="text"
                  value={row.subject}
                  placeholder="What"
                  onChange={(e) => patch(row.id, { subject: e.target.value })}
                  disabled={isPending}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
              )}
              {row.fixed ? null : (
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={isPending}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              )}
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

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={addRow}
          disabled={isPending}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add item
        </button>
        <div className="flex items-center gap-2">
          {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "save"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Pre-trip
        </span>
        <span className="t-num font-mono text-[14px] text-foreground">€{fmt(total)}</span>
      </div>
    </div>
  )
}
