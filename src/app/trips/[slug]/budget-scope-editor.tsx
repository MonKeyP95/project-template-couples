"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { saveBudgetItemsForScope } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"

const CATEGORIES = [
  "Accommodation",
  "Transportation",
  "Food",
  "Activities",
  "Other",
] as const

interface Row {
  id: string
  category: string
  subject: string
  value: string
  whenStart: string
  whenEnd: string
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** Collapsible cost editor for one scope: a location, or the trip-wide bucket
 * (locationId null, withDates true). Explicit save replaces just this scope. */
export function BudgetScopeEditor({
  tripId,
  tripSlug,
  locationId,
  items,
  withDates,
  defaultCategory,
  label,
}: {
  tripId: string
  tripSlug: string
  locationId: string | null
  items: BudgetItem[]
  withDates: boolean
  defaultCategory: string
  label: string
}) {
  const [rows, setRows] = React.useState<Row[]>(() =>
    items.map((it) => ({
      id: crypto.randomUUID(),
      category: it.category,
      subject: it.subject,
      value: it.amountCents ? (it.amountCents / 100).toFixed(0) : "",
      whenStart: it.whenStart ?? "",
      whenEnd: it.whenEnd ?? "",
    })),
  )
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  const totalCents = rows.reduce((s, r) => s + asCents(r.value), 0)

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function add() {
    setRows((rs) => [
      ...rs,
      {
        id: crypto.randomUUID(),
        category: defaultCategory,
        subject: "",
        value: "",
        whenStart: "",
        whenEnd: "",
      },
    ])
  }
  function remove(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function save() {
    const payload = rows
      .filter((r) => r.subject.trim() !== "" || asCents(r.value) > 0)
      .map((r) => ({
        category: r.category,
        subject: r.subject,
        whenLabel: "",
        amountCents: asCents(r.value),
        locationId,
        whenStart: withDates && r.whenStart ? r.whenStart : null,
        whenEnd: withDates && r.whenEnd ? r.whenEnd : null,
      }))
    setError(null)
    startTransition(async () => {
      const res = await saveBudgetItemsForScope({
        tripId,
        tripSlug,
        locationId,
        items: payload,
      })
      if (res.error) setError(res.error)
    })
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[11px] text-foreground">
          € {(totalCents / 100).toFixed(0)}
        </span>
        <span className="ml-auto font-mono text-[12px] leading-none text-muted-foreground">
          {open ? "⌄" : "›"}
        </span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-1.5">
              <Select
                value={r.category}
                onValueChange={(v: string | null) =>
                  patch(r.id, { category: v ?? defaultCategory })
                }
              >
                <SelectTrigger className="w-32 font-mono text-[11px]">
                  <SelectValue>{r.category}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                value={r.subject}
                onChange={(e) => patch(r.id, { subject: e.target.value })}
                placeholder="What"
                className="min-w-0 flex-1 rounded-lg border border-clay bg-transparent px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {withDates ? (
                <>
                  <input
                    type="date"
                    aria-label="Start date"
                    value={r.whenStart}
                    onChange={(e) => patch(r.id, { whenStart: e.target.value })}
                    className="rounded-lg border border-clay bg-transparent px-2 py-1.5 text-[11px] text-foreground focus:outline-none"
                  />
                  <input
                    type="date"
                    aria-label="End date"
                    value={r.whenEnd}
                    min={r.whenStart || undefined}
                    onChange={(e) => patch(r.id, { whenEnd: e.target.value })}
                    className="rounded-lg border border-clay bg-transparent px-2 py-1.5 text-[11px] text-foreground focus:outline-none"
                  />
                </>
              ) : null}
              <input
                type="number"
                inputMode="numeric"
                value={r.value}
                onChange={(e) => patch(r.id, { value: e.target.value })}
                placeholder="0"
                className="w-16 rounded-lg border border-clay bg-transparent px-2 py-1.5 text-right text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label="Remove item"
                className="px-1 font-mono text-[13px] text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={add}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              + add cost
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              save
            </button>
          </div>
          {error ? <p className="text-[11px] text-clay">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
