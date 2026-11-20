"use client"

import * as React from "react"

import type { StepPlace } from "./budget-drafter-steps"

const BUTTON =
  "rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-40"

/** The edit list's last row: name a category (an existing one or a new one)
 * and, on a multi-place trip, where it belongs. */
export function AddCategoryForm({
  categories,
  places,
  disabled,
  onAdd,
}: {
  categories: string[]
  /** Empty on a 0-1 place trip: everything is the trip, so no place select. */
  places: StepPlace[]
  disabled: boolean
  onAdd: (category: string, locationId: string | null) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [placeId, setPlaceId] = React.useState("")
  const listId = React.useId()

  function close() {
    setOpen(false)
    setName("")
    setPlaceId("")
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onAdd(trimmed, placeId || null)
    close()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex w-full items-center border-0 border-t border-rule bg-transparent py-2 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        + add a category
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5 border-t border-rule py-2">
      <input
        type="text"
        list={listId}
        value={name}
        maxLength={40}
        placeholder="Category"
        autoFocus
        onChange={(e) => setName(e.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
      />
      <datalist id={listId}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {places.length > 0 ? (
        <select
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
          disabled={disabled}
          aria-label="Where"
          className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
        >
          <option value="">Trip-wide</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
      <button type="submit" disabled={disabled || !name.trim()} className={BUTTON}>
        add
      </button>
      <button type="button" onClick={close} disabled={disabled} className={BUTTON}>
        cancel
      </button>
    </form>
  )
}
