"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/together"
import { money } from "@/lib/money"
import { dayLabel } from "@/lib/trips/budget-pace"
import type { Expense } from "@/lib/trips/expense-types"
import { readReceipt } from "@/lib/trips/receipt-actions"
import { receiptState, type Receipt } from "@/lib/trips/receipt-types"
import { ReceiptView } from "./receipt-view"

export interface ReceiptPileProps {
  tripSlug: string
  receipts: Receipt[]
  expenses: Expense[]
  /** Server render time, so "reading…" vs "couldn't read" is stable across hydration. */
  nowMs: number
}

/** Receipts not yet attached to an expense. Renders nothing when there are none. */
export function ReceiptPile({ tripSlug, receipts, expenses, nowMs }: ReceiptPileProps) {
  const pile = receipts.filter((r) => r.expenseId === null)
  if (pile.length === 0) return null

  const receiptExpenseIds = new Set(
    receipts.flatMap((r) => (r.expenseId ? [r.expenseId] : [])),
  )

  return (
    <section className="flex flex-col gap-2">
      <Label>Receipts to match</Label>
      {pile.map((r) => (
        <PileCard
          key={r.id}
          receipt={r}
          tripSlug={tripSlug}
          expenses={expenses}
          receiptExpenseIds={receiptExpenseIds}
          nowMs={nowMs}
        />
      ))}
    </section>
  )
}

function PileCard({
  receipt,
  tripSlug,
  expenses,
  receiptExpenseIds,
  nowMs,
}: {
  receipt: Receipt
  tripSlug: string
  expenses: Expense[]
  receiptExpenseIds: Set<string>
  nowMs: number
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const state = isPending ? "reading" : receiptState(receipt, nowMs)
  const r = receipt.reading

  function readAgain() {
    startTransition(async () => {
      await readReceipt(receipt.id, tripSlug)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3">
      <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {receipt.mimeType === "application/pdf" ? (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-[10px]">
            PDF
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not optimisable
          <img src={receipt.url} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
        )}
        <span className="min-w-0 flex-1 text-[14px]">
          {state === "done" && r ? (
            <>
              <span className="block truncate">{r.merchant ?? "Receipt"}</span>
              <span className="t-num block text-[13px] text-muted-foreground">
                {[
                  r.date ? dayLabel(r.date) : null,
                  r.totalCents !== null && r.currency ? money(r.totalCents, r.currency) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {state === "reading" ? "reading…" : "couldn't read"}
            </span>
          )}
        </span>
      </button>
      {state === "failed" ? (
        <button
          type="button"
          onClick={readAgain}
          className="shrink-0 rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em]"
        >
          read again
        </button>
      ) : null}
      <ReceiptView
        receipt={receipt}
        tripSlug={tripSlug}
        expenses={expenses}
        receiptExpenseIds={receiptExpenseIds}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  )
}
