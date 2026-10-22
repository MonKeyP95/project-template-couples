"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { money } from "@/lib/money"
import { dayLabel } from "@/lib/trips/budget-pace"
import type { Expense } from "@/lib/trips/expense-types"
import { attachReceipt, deleteReceipt } from "@/lib/trips/receipt-actions"
import { suggestExpenseMatches, type Receipt } from "@/lib/trips/receipt-types"

export interface ReceiptViewProps {
  receipt: Receipt
  tripSlug: string
  /** Given for a pile receipt: the trip's expenses to match against. */
  expenses?: Expense[]
  /** Expenses that already have a receipt; never suggested. */
  receiptExpenseIds?: Set<string>
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** One receipt: the file, what was read off it, and match / detach / delete. */
export function ReceiptView({
  receipt,
  tripSlug,
  expenses,
  receiptExpenseIds,
  open,
  onOpenChange,
}: ReceiptViewProps) {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const r = receipt.reading

  function run(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{r?.merchant ?? "Receipt"}</DialogTitle>
        </DialogHeader>

        {receipt.mimeType === "application/pdf" ? (
          <a href={receipt.url} target="_blank" rel="noreferrer" className="text-[14px] underline">
            open PDF
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not optimisable
          <img src={receipt.url} alt="Receipt" className="max-h-[50vh] w-full rounded-lg object-contain" />
        )}

        {r ? <ReadingText reading={r} /> : null}

        {expenses && receipt.expenseId === null ? (
          <MatchPicker
            receipt={receipt}
            expenses={expenses}
            receiptExpenseIds={receiptExpenseIds ?? new Set()}
            disabled={isPending}
            onPick={(expenseId) => run(() => attachReceipt(receipt.id, expenseId, tripSlug))}
          />
        ) : null}

        <div className="flex gap-2">
          {receipt.expenseId !== null ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => attachReceipt(receipt.id, null, tripSlug))}
              className="rounded-full border border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] disabled:opacity-40"
            >
              detach
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => deleteReceipt(receipt.id, tripSlug))}
            className="rounded-full border border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-clay disabled:opacity-40"
          >
            delete
          </button>
        </div>
        {error ? <div className="font-mono text-[10px] text-clay">{error}</div> : null}
      </DialogContent>
    </Dialog>
  )
}

function ReadingText({ reading }: { reading: NonNullable<Receipt["reading"]> }) {
  const currency = reading.currency ?? ""
  return (
    <div className="flex flex-col gap-1 text-[14px]">
      {reading.summary ? <p className="text-muted-foreground">{reading.summary}</p> : null}
      {reading.date ? <p>{dayLabel(reading.date)}</p> : null}
      {reading.items.length ? (
        <ul className="flex flex-col gap-0.5 text-[13px]">
          {reading.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>{item.label}</span>
              {item.amountCents !== null && currency ? (
                <span className="t-num">{money(item.amountCents, currency)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {reading.totalCents !== null && currency ? (
        <p className="t-num font-medium">Total {money(reading.totalCents, currency)}</p>
      ) : null}
    </div>
  )
}

function MatchPicker({
  receipt,
  expenses,
  receiptExpenseIds,
  disabled,
  onPick,
}: {
  receipt: Receipt
  expenses: Expense[]
  receiptExpenseIds: Set<string>
  disabled: boolean
  onPick: (expenseId: string) => void
}) {
  const suggestions = suggestExpenseMatches(receipt.reading, expenses, receiptExpenseIds)
  const others = expenses.filter((e) => !e.isSettlement)

  return (
    <div className="flex flex-col gap-2">
      {suggestions.map((e) => (
        <button
          key={e.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(e.id)}
          className="flex justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-[14px] disabled:opacity-40"
        >
          <span className="truncate">
            {e.title}
            {e.dayDate ? <span className="text-muted-foreground"> · {dayLabel(e.dayDate)}</span> : null}
          </span>
          <span className="t-num">{money(e.amountCents, e.currency)}</span>
        </button>
      ))}
      <select
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        aria-label="Pick another expense"
        className="rounded-lg border border-border bg-background px-3 py-2 text-[13px]"
      >
        <option value="">pick another expense</option>
        {others.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title} · {money(e.amountCents, e.currency)}
            {e.dayDate ? ` · ${dayLabel(e.dayDate)}` : ""}
          </option>
        ))}
      </select>
    </div>
  )
}
