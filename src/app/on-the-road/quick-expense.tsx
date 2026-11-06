"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { logExpense } from "@/lib/trips/actions"
import { attachReceipt } from "@/lib/trips/receipt-actions"
import { prefillFromReading, type ReceiptReading } from "@/lib/trips/receipt-types"
import { ReceiptCameraButton } from "@/components/receipts/receipt-camera-button"
import { Label } from "@/components/together"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import { useCurrency } from "@/components/currency-context"
import { CurrencyChip } from "@/app/trips/[slug]/currency-chip"

export interface QuickExpenseProps {
  tripId: string
  tripSlug: string
  /** Every expense logged here is for today; other days are fixed on the trip page. */
  today: string
  currentPersonId: string
  categories: ExpenseCategoryRow[]
  /** Currency of today's location; null = the trip's. */
  locationCurrency: string | null
}

export function QuickExpense({
  tripId,
  tripSlug,
  today,
  currentPersonId,
  categories,
  locationCurrency,
}: QuickExpenseProps) {
  const { spendCurrency } = useCurrency()
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [expenseCurrency, setExpenseCurrency] = React.useState(
    locationCurrency ?? spendCurrency,
  )
  const [category, setCategory] = React.useState(categories[0]?.name ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [receiptId, setReceiptId] = React.useState<string | null>(null)
  const [readingReceipt, setReadingReceipt] = React.useState(false)

  function fillFromReceipt(reading: ReceiptReading) {
    const next = prefillFromReading(
      { title: name, amount, currency: expenseCurrency, dayDate: today },
      reading,
    )
    setName(next.title)
    setAmount(next.amount)
    setExpenseCurrency(next.currency)
  }

  const canSubmit =
    name.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || readingReceipt || !canSubmit) return
    startTransition(async () => {
      const result = await logExpense({
        tripId,
        tripSlug,
        title: name.trim(),
        amount,
        currency: expenseCurrency,
        category,
        paidBy: currentPersonId,
        dayDate: today,
        locationId: null,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setName("")
      setAmount("")
      setError(null)
      if (receiptId) {
        const attach = await attachReceipt(receiptId, result.expenseId!, tripSlug)
        setReceiptId(null)
        if (attach.error) setError("Expense saved; receipt left in the pile to match.")
      }
      router.refresh()
    })
  }

  return (
    <div className="px-[18px] py-3">
      <div className="flex items-center gap-3">
        <Label>Expense</Label>
        <CurrencyChip
          value={expenseCurrency}
          onChange={setExpenseCurrency}
          amount={amount}
          tripCurrencies={locationCurrency ? [locationCurrency] : []}
          disabled={isPending}
          className="items-center gap-2"
        />
      </div>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2.5">
        <div className="flex items-start gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            disabled={isPending}
            className="w-24 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[14px] text-foreground"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="what for?"
            disabled={isPending}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground"
          />
          <ReceiptCameraButton
            tripId={tripId}
            tripSlug={tripSlug}
            receiptId={receiptId}
            onReceiptIdChange={setReceiptId}
            onReading={fillFromReceipt}
            onBusyChange={setReadingReceipt}
            onError={setError}
            disabled={isPending}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isPending}
            aria-label="Category"
            className="max-w-[60%] truncate rounded-full border border-border bg-background px-2.5 py-1 text-[12px] text-muted-foreground"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending || readingReceipt || !canSubmit}
            className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending || readingReceipt ? "…" : "add"}
          </button>
        </div>
        {error ? (
          <div className="font-mono text-[10px] text-clay">{error}</div>
        ) : null}
      </form>
    </div>
  )
}
