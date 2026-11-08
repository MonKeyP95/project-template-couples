"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const labelClass =
  "block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
const inputClass =
  "mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-clay focus:outline-none disabled:opacity-50"
const NEW_CATEGORY = "__new__"

export interface CostDraft {
  category: string
  /** The category was typed in the box rather than picked from the list. */
  isNewCategory: boolean
  subject: string
  value: string
  whenStart: string
  whenEnd: string
}

/** The always-open "Add cost" box of a budget scope: what, category, optional
 * dates and amount. `onAdd` receives the draft; the box clears on success. */
export function AddCostBox({
  categoryOptions,
  defaultCategory,
  showCategory,
  withDates,
  isPending,
  onAdd,
}: {
  categoryOptions: string[]
  defaultCategory: string
  /** Hidden in pre-trip mode, where every cost is Pre-trip. */
  showCategory: boolean
  withDates: boolean
  isPending: boolean
  /** Resolves true when the cost was added. */
  onAdd: (draft: CostDraft) => Promise<boolean>
}) {
  const [subject, setSubject] = React.useState("")
  const [value, setValue] = React.useState("")
  const [category, setCategory] = React.useState(defaultCategory)
  // null = picking from the list; a string = a new category being typed.
  const [newCat, setNewCat] = React.useState<string | null>(null)
  const [whenStart, setWhenStart] = React.useState("")
  const [whenEnd, setWhenEnd] = React.useState("")

  const typedCat = newCat?.trim() ?? ""
  const canAdd =
    (subject.trim() !== "" || Number(value) > 0) &&
    (newCat === null || typedCat !== "")

  async function add() {
    if (!canAdd || isPending) return
    const added = await onAdd({
      category: newCat === null ? category : typedCat,
      isNewCategory: newCat !== null,
      subject: subject.trim(),
      value,
      whenStart,
      whenEnd,
    })
    if (!added) return
    if (newCat !== null) {
      setCategory(typedCat)
      setNewCat(null)
    }
    setSubject("")
    setValue("")
    setWhenStart("")
    setWhenEnd("")
  }

  // Enter adds the cost instead of saving the whole scope.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return
    e.preventDefault()
    add()
  }

  function pickCategory(v: string | null) {
    if (!v) return
    if (v === NEW_CATEGORY) setNewCat("")
    else setCategory(v)
  }

  return (
    <div className="rounded-lg border border-rule p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground">
        Add cost
      </div>

      <div className="mt-2 flex items-end gap-2">
        <label className="block min-w-0 flex-1">
          <span className={labelClass}>What</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isPending}
            className={inputClass}
          />
        </label>
        <label className="block w-16 shrink-0">
          <span className={labelClass}>Amount</span>
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="0"
            disabled={isPending}
            className={`${inputClass} t-num text-right`}
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={isPending || !canAdd}
          className="mb-1 shrink-0 rounded-full border border-foreground bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground disabled:opacity-40"
        >
          add
        </button>
      </div>

      {showCategory || withDates ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {showCategory ? (
            <div className="w-40 shrink-0">
              <span className={labelClass}>Category</span>
              {newCat === null ? (
                <Select value={category} onValueChange={pickCategory}>
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_CATEGORY}>+ New category…</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    onKeyDown={onKeyDown}
                    autoFocus
                    maxLength={40}
                    placeholder="New category"
                    disabled={isPending}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setNewCat(null)}
                    aria-label="Cancel new category"
                    className="px-1 font-mono text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ) : null}
          {withDates ? (
            <>
              <label className="block shrink-0">
                <span className={labelClass}>From</span>
                <input
                  type="date"
                  value={whenStart}
                  onChange={(e) => setWhenStart(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={isPending}
                  className={`${inputClass} text-[11px]`}
                />
              </label>
              <label className="block shrink-0">
                <span className={labelClass}>To</span>
                <input
                  type="date"
                  value={whenEnd}
                  min={whenStart || undefined}
                  onChange={(e) => setWhenEnd(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={isPending}
                  className={`${inputClass} text-[11px]`}
                />
              </label>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
