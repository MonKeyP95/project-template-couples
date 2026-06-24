"use client"

import * as React from "react"

import { addExpenseCategory, deleteExpenseCategory } from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const ADD_SENTINEL = "__add_category__"
const MANAGE_SENTINEL = "__manage_category__"

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
  const [managing, setManaging] = React.useState(false)
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const busy = disabled || isPending

  function onSelect(next: string | null) {
    if (next === null) return
    if (next === ADD_SENTINEL) {
      setAdding(true)
      return
    }
    if (next === MANAGE_SENTINEL) {
      setManaging(true)
      return
    }
    onChange(next)
  }

  function remove(c: ExpenseCategoryRow) {
    if (busy) return
    if (
      !confirm(
        `Delete "${c.name}"? Its expenses move to "Other" and its planned budget items are removed.`,
      )
    )
      return
    startTransition(async () => {
      const result = await deleteExpenseCategory(c.id, tripSlug)
      if (result.error) {
        setError(result.error)
        return
      }
      setError(null)
    })
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
      <Select value={value} onValueChange={onSelect} disabled={disabled}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.name}>
              {c.name}
            </SelectItem>
          ))}
          <SelectItem value={ADD_SENTINEL} className="text-clay">
            + Add category…
          </SelectItem>
          <SelectItem value={MANAGE_SENTINEL} className="text-muted-foreground">
            Edit categories…
          </SelectItem>
        </SelectContent>
      </Select>

      {managing ? (
        <div className="mt-2 rounded-lg border border-rule p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Edit categories
            </span>
            <button
              type="button"
              onClick={() => setManaging(false)}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
            >
              done
            </button>
          </div>
          <div className="space-y-0.5">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-foreground">{c.name}</span>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  disabled={busy}
                  aria-label={`Delete ${c.name}`}
                  className="px-1 font-mono text-[13px] text-muted-foreground hover:text-clay disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
