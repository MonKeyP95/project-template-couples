"use client"

import { Label } from "@/components/together"

export interface ListRow {
  /** The walk step index this row opens. */
  index: number
  label: string
  /** Pre-formatted right-hand figure; "" shows a dash. */
  amount: string
}

export interface ListGroup {
  title: string
  rows: ListRow[]
}

/** Edit mode's entry screen: every walk heading with its subtotal; tap one to
 * open that step. */
export function BudgetDrafterList({
  groups,
  total,
  error,
  isPending,
  onOpen,
  onSave,
  onCancel,
}: {
  groups: ListGroup[]
  total: string
  error: string | null
  isPending: boolean
  onOpen: (index: number) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <>
      <Label>Edit budget</Label>

      {groups.map((g) => (
        <div key={g.title} className="mt-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {g.title}
          </div>
          <div className="mt-1 border-t border-rule">
            {g.rows.map((r) => (
              <button
                key={r.index}
                type="button"
                onClick={() => onOpen(r.index)}
                disabled={isPending}
                className="flex w-full items-center justify-between gap-3 border-0 border-t border-rule bg-transparent py-2 text-left first:border-t-0 hover:bg-muted/40"
              >
                <span className="min-w-0 truncate text-[13px] text-foreground">{r.label}</span>
                <span className="t-num shrink-0 text-[13px] text-muted-foreground">
                  {r.amount || "—"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="font-serif text-[15px] italic text-foreground">Total</span>
        <span className="t-num text-[18px] text-foreground">{total}</span>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
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
