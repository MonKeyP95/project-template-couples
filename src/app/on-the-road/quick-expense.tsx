"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { logExpense } from "@/lib/trips/actions"
import { attachReceipt } from "@/lib/trips/receipt-actions"
import { prefillFromReading, type ReceiptReading } from "@/lib/trips/receipt-types"
import { ReceiptCameraButton } from "@/components/receipts/receipt-camera-button"
import { CategoryIcon, Label, categoryToneOf } from "@/components/together"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { ItineraryEvent } from "@/lib/trips/itinerary-types"
import { useCurrency } from "@/components/currency-context"
import { useExpenseSaved } from "@/components/close-on-expense-saved"
import { CurrencyChip } from "@/app/trips/[slug]/currency-chip"
import { parseAmount } from "@/lib/money"

export interface QuickExpenseProps {
  tripId: string
  tripSlug: string
  /** Every expense logged here is for today; other days are fixed on the trip page. */
  today: string
  currentPersonId: string
  categories: ExpenseCategoryRow[]
  /** Today's events, offered as chips that fill the title and category. */
  events: ItineraryEvent[]
  /** Currency of today's location; null = the trip's. */
  locationCurrency: string | null
}

export function QuickExpense({
  tripId,
  tripSlug,
  today,
  currentPersonId,
  categories,
  events,
  locationCurrency,
}: QuickExpenseProps) {
  const { entryCurrency } = useCurrency()
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [expenseCurrency, setExpenseCurrency] = React.useState(
    locationCurrency ?? entryCurrency,
  )
  const [category, setCategory] = React.useState(categories[0]?.name ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const onSaved = useExpenseSaved()
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

  function fillFromEvent(event: ItineraryEvent) {
    setName(event.text)
    if (categories.some((c) => c.name === event.category)) {
      setCategory(event.category!)
    }
  }

  const canSubmit =
    name.trim().length > 0 &&
    Number.isFinite(parseAmount(amount)) &&
    parseAmount(amount) > 0

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
      onSaved?.()
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
        <EventChips events={events} selected={name} onPick={fillFromEvent} disabled={isPending} />
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
          <CategoryPicker
            names={categories.map((c) => c.name)}
            value={category}
            onChange={setCategory}
            disabled={isPending}
          />
          <button
            type="submit"
            disabled={isPending || readingReceipt || !canSubmit}
            className="rounded-full border-0 bg-sea px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
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

/** The trip's categories as tappable icons; the picked one's name beside them. */
function CategoryPicker({
  names,
  value,
  onChange,
  disabled,
}: {
  names: string[]
  value: string
  onChange: (name: string) => void
  disabled: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Category" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={name === value}
          onClick={() => onChange(name)}
          disabled={disabled}
          className={`rounded-full p-0.5 ring-offset-1 ring-offset-background transition-opacity ${
            name === value ? "ring-2 ring-foreground" : "opacity-60 hover:opacity-100"
          }`}
        >
          <CategoryIcon name={name} tone={categoryToneOf(name, names)} size={28} />
        </button>
      ))}
      <span className="truncate text-[12px] text-muted-foreground">{value}</span>
    </div>
  )
}

function EventChips({
  events,
  selected,
  onPick,
  disabled,
}: {
  events: ItineraryEvent[]
  selected: string
  onPick: (event: ItineraryEvent) => void
  disabled: boolean
}) {
  const named = events.filter((e) => e.text.trim().length > 0)
  if (named.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {named.map((event, i) => (
        <button
          key={`${i}-${event.text}`}
          type="button"
          onClick={() => onPick(event)}
          disabled={disabled}
          aria-pressed={selected === event.text}
          className="max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[12px] text-muted-foreground aria-pressed:border-foreground aria-pressed:text-foreground"
        >
          {event.text}
        </button>
      ))}
    </div>
  )
}
