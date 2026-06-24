"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { addExpenseCategory, saveBudgetItemsForScope } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"

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
  categories,
  spentByCategory,
}: {
  tripId: string
  tripSlug: string
  locationId: string | null
  items: BudgetItem[]
  withDates: boolean
  defaultCategory: string
  label: string
  /** Trip-wide category list; when present the picker uses it and a new
   * category persists trip-wide. Absent => the fixed default set, add-only. */
  categories?: ExpenseCategoryRow[]
  /** Actual spend by category name for this scope; shows spent vs planned. */
  spentByCategory?: Record<string, number>
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
  // null = not adding a custom category; a string = the name being typed.
  const [newCat, setNewCat] = React.useState<string | null>(null)

  const totalCents = rows.reduce((s, r) => s + asCents(r.value), 0)
  const spent = spentByCategory ?? {}
  const withSpent = spentByCategory != null
  const spentTotalCents = Object.values(spent).reduce((s, c) => s + c, 0)

  // The category order to follow: the trip's list, else the fixed default set.
  const catOrder: readonly string[] = categories
    ? categories.map((c) => c.name)
    : CATEGORIES

  // Categories shown as groups: those with a planned row or actual spend,
  // ordered by catOrder with extras appended; the default for an empty scope.
  const present = new Set([...rows.map((r) => r.category), ...Object.keys(spent)])
  let groupCats: string[]
  if (present.size > 0) {
    groupCats = catOrder.filter((c) => present.has(c))
    for (const c of present) if (!groupCats.includes(c)) groupCats.push(c)
  } else {
    groupCats = [defaultCategory]
  }
  const groups = groupCats.map((cat) => {
    const catRows = rows.filter((r) => r.category === cat)
    return {
      cat,
      rows: catRows,
      subtotalCents: catRows.reduce((s, r) => s + asCents(r.value), 0),
      spentCents: spent[cat] ?? 0,
    }
  })
  const shown = new Set(groupCats)
  const availableCats = catOrder.filter((c) => !shown.has(c))

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function addInCategory(category: string) {
    setRows((rs) => [
      ...rs,
      {
        id: crypto.randomUUID(),
        category,
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
  function pickCategory(v: string | null) {
    if (!v) return
    if (v === "__new__") setNewCat("")
    else addInCategory(v)
  }
  function confirmNewCat(e: React.FormEvent) {
    e.preventDefault()
    const name = (newCat ?? "").trim()
    if (!name) {
      setNewCat(null)
      return
    }
    // With a trip category list, a new name persists trip-wide (so it shows in
    // the expense picker too); otherwise it's just a local group label.
    if (categories) {
      startTransition(async () => {
        const res = await addExpenseCategory(tripId, tripSlug, name)
        if (res.error) {
          setError(res.error)
          return
        }
        addInCategory(name)
        setNewCat(null)
      })
    } else {
      addInCategory(name)
      setNewCat(null)
    }
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
        {withSpent ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            spent € {(spentTotalCents / 100).toFixed(0)} /
          </span>
        ) : null}
        <span className="font-mono text-[11px] text-foreground">
          € {(totalCents / 100).toFixed(0)}
        </span>
        <span className="ml-auto font-mono text-[12px] leading-none text-muted-foreground">
          {open ? "⌄" : "›"}
        </span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-3">
          {groups.map((g) => (
            <div key={g.cat}>
              <div className="flex items-baseline justify-between border-b border-rule pb-1">
                <span className="font-serif text-[13px] italic text-foreground">
                  {g.cat}
                </span>
                <span className="font-mono text-[11px]">
                  {withSpent ? (
                    <span className="text-muted-foreground">
                      spent € {(g.spentCents / 100).toFixed(0)} /{" "}
                    </span>
                  ) : null}
                  <span className="text-foreground">
                    € {(g.subtotalCents / 100).toFixed(0)}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 space-y-1.5">
                {g.rows.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-1.5">
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
                <button
                  type="button"
                  onClick={() => addInCategory(g.cat)}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
                >
                  + add
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-1">
            {newCat !== null ? (
              <form onSubmit={confirmNewCat} className="flex items-center gap-1.5">
                <input
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  autoFocus
                  maxLength={40}
                  placeholder="New category"
                  className="w-40 rounded-lg border border-clay bg-transparent px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <button
                  type="submit"
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
                >
                  add
                </button>
                <button
                  type="button"
                  onClick={() => setNewCat(null)}
                  aria-label="Cancel"
                  className="px-1 font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </form>
            ) : (
              <Select value="" onValueChange={pickCategory}>
                <SelectTrigger className="w-40 font-mono text-[10px] uppercase tracking-[0.14em]">
                  <SelectValue>+ add category</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableCats.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new__">+ New category…</SelectItem>
                </SelectContent>
              </Select>
            )}
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
