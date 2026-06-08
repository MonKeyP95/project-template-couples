"use client"

import * as React from "react"

import { addExpenseCategory } from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"

const ADD_SENTINEL = "__add_category__"

export interface CategorySelectProps {
  categories: ExpenseCategoryRow[]
  value: string
  onChange: (name: string) => void
  tripId: string
  tripSlug: string
  disabled: boolean
}

/**
 * The plain category dropdown plus a "+ Add category…" entry. Picking that entry
 * reveals a small input to name a new category, which is created and selected.
 * No delete — categories are add-only from here.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  tripId,
  tripSlug,
  disabled,
}: CategorySelectProps) {
  const [adding, setAdding] = React.useState(false)
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const busy = disabled || isPending

  function onSelect(next: string) {
    if (next === ADD_SENTINEL) {
      setAdding(true)
      return
    }
    onChange(next)
  }

  function add() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    startTransition(async () => {
      const result = await addExpenseCategory(tripId, tripSlug, trimmed)
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.category) onChange(result.category.name)
      setName("")
      setAdding(false)
      setError(null)
    })
  }

  return (
    <>
      <select
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
        <option value={ADD_SENTINEL}>+ Add category…</option>
      </select>

      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
              if (e.key === "Escape") {
                setAdding(false)
                setName("")
              }
            }}
            placeholder="New category…"
            disabled={busy}
            className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !name.trim()}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground disabled:opacity-40"
          >
            add
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </>
  )
}
