"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { saveBudgetItems } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

const CATEGORIES = [
  "Accommodation",
  "Transportation",
  "Food",
  "Activities",
  "Other",
] as const
const PLACED = new Set<string>(["Accommodation", "Activities"])

interface Row {
  id: string
  category: string
  subject: string
  when: string
  value: string
  locationId: string | null
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** AI-off budget editor: items grouped by category, total = sum, replace-all save. */
export function BudgetItemList({
  tripId,
  tripSlug,
  items,
  locations,
}: {
  tripId: string
  tripSlug: string
  items: BudgetItem[]
  locations: ItineraryLocation[]
}) {
  const [rows, setRows] = React.useState<Row[]>(() =>
    items.map((it) => ({
      id: crypto.randomUUID(),
      category: it.category,
      subject: it.subject,
      when: it.whenLabel,
      value: it.amountCents ? (it.amountCents / 100).toFixed(0) : "",
      locationId: it.locationId,
    })),
  )
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  const totalCents = rows.reduce((s, r) => s + asCents(r.value), 0)

  function patch(id: string, p: Partial<Row>) {
    setSaved(false)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function add(category: string) {
    setSaved(false)
    setRows((rs) => [
      ...rs,
      { id: crypto.randomUUID(), category, subject: "", when: "", value: "", locationId: null },
    ])
  }
  function remove(id: string) {
    setSaved(false)
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function save() {
    const payload = rows
      .filter((r) => r.subject.trim() !== "" || asCents(r.value) > 0)
      .map((r) => ({
        category: r.category,
        subject: r.subject,
        whenLabel: r.when,
        amountCents: asCents(r.value),
        locationId: PLACED.has(r.category) ? r.locationId : null,
      }))
    setError(null)
    startTransition(async () => {
      const res = await saveBudgetItems({ tripId, tripSlug, items: payload })
      if (res.error) setError(res.error)
      else setSaved(true)
    })
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Budget plan
        </span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] text-foreground">
            € {(totalCents / 100).toFixed(0)}
          </span>
          <span className="font-mono text-[13px] leading-none text-muted-foreground">
            {open ? "⌄" : "›"}
          </span>
        </span>
      </button>

      {open ? (
        <>
      {CATEGORIES.map((category) => {
        const catRows = rows.filter((r) => r.category === category)
        const placed = PLACED.has(category) && locations.length > 0
        return (
          <div key={category} className="mt-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {category}
            </div>
            <div className="mt-1.5 space-y-1.5">
              {catRows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={r.subject}
                    onChange={(e) => patch(r.id, { subject: e.target.value })}
                    placeholder="What"
                    className="min-w-0 flex-1 rounded-lg border border-clay bg-transparent px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <input
                    value={r.when}
                    onChange={(e) => patch(r.id, { when: e.target.value })}
                    placeholder="When"
                    className="w-16 rounded-lg border border-clay bg-transparent px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={r.value}
                    onChange={(e) => patch(r.id, { value: e.target.value })}
                    placeholder="0"
                    className="w-16 rounded-lg border border-clay bg-transparent px-2 py-1.5 text-right text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {placed ? (
                    <Select
                      value={r.locationId}
                      onValueChange={(v: string | null) => patch(r.id, { locationId: v })}
                    >
                      <SelectTrigger className="w-28 font-mono text-[11px]">
                        <SelectValue placeholder="place">
                          {r.locationId
                            ? locations.find((l) => l.id === r.locationId)?.name ?? "place"
                            : "place"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>no place</SelectItem>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
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
              <button
                type="button"
                onClick={() => add(category)}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
              >
                + {category.toLowerCase()}
              </button>
            </div>
          </div>
        )
      })}

      {error ? <p className="mt-2 text-[11px] text-clay">{error}</p> : null}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="mt-4 rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {saved ? "saved" : "save budget"}
      </button>
        </>
      ) : null}
    </div>
  )
}
