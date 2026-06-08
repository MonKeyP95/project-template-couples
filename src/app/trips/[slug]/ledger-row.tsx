"use client"

import * as React from "react"

import { Avatar, MonoBadge, type MonoBadgeTone } from "@/components/together"
import { deleteExpense, updateExpense } from "@/lib/trips/actions"
import {
  EXPENSE_CATEGORY_DEFAULT,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"

import { ExpenseFields } from "./expense-fields"
import type { MemberToneEntry } from "./packing-tab"
import type { ItineraryLocation } from "@/lib/trips/location-types"

const CATEGORY_TONE: Record<string, MonoBadgeTone> = {
  Surf: "sea",
  Dive: "sea",
  Trek: "moss",
  Food: "clay",
  Transit: "ink",
  Lodging: "sand",
  Settlement: "ink",
  Other: "ink",
}

const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

function ledgerDate(date: string | null): { mon: string; day: string } | null {
  if (!date) return null
  const d = new Date(`${date}T00:00:00Z`)
  return {
    mon: MONTH_SHORT.format(d).toUpperCase(),
    day: String(d.getUTCDate()),
  }
}

export interface LedgerRowProps {
  expense: Expense
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  categories: ExpenseCategoryRow[]
  locationChip?: { name: string | null; tagged: boolean }
}

export function LedgerRow({
  expense,
  members,
  tripSlug,
  locations,
  categories,
  locationChip,
}: LedgerRowProps) {
  const [editing, setEditing] = React.useState(false)

  if (editing && !expense.isSettlement) {
    return (
      <LedgerRowEditor
        expense={expense}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
        categories={categories}
        onDone={() => setEditing(false)}
      />
    )
  }

  return (
    <LedgerRowView
      expense={expense}
      members={members}
      tripSlug={tripSlug}
      locationChip={locationChip}
      onEdit={() => setEditing(true)}
    />
  )
}

function LedgerRowView({
  expense,
  members,
  tripSlug,
  locationChip,
  onEdit,
}: {
  expense: Expense
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locationChip?: { name: string | null; tagged: boolean }
  onEdit: () => void
}) {
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const payer = members[expense.paidBy]
  const date = ledgerDate(expense.dayDate)
  const tone = CATEGORY_TONE[expense.category] ?? "ink"

  function remove() {
    if (isPending) return
    if (!confirm("Delete this expense?")) return
    startTransition(async () => {
      const result = await deleteExpense(expense.id, tripSlug)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div
      className={`grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border px-5 py-3 ${
        isPending ? "opacity-50" : ""
      }`}
    >
      <div className="text-center">
        {date ? (
          <>
            <div className="font-mono text-[18px] leading-none tracking-[-0.02em] text-foreground">
              {date.day}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {date.mon}
            </div>
          </>
        ) : (
          <div className="font-mono text-[11px] text-muted-foreground">—</div>
        )}
      </div>
      <div>
        <div className="text-[14px] tracking-[-0.005em] text-foreground">
          {expense.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <MonoBadge tone={tone}>{expense.category}</MonoBadge>
          <span className="font-mono text-[10px] text-muted-foreground">
            paid by
          </span>
          {payer ? (
            <Avatar name={payer.initial} size={16} tone={payer.tone} />
          ) : null}
          {locationChip ? (
            <span
              className={`font-mono text-[10px] ${
                locationChip.tagged ? "text-clay" : "text-muted-foreground"
              }`}
              title={locationChip.tagged ? "Tagged location" : "Location by date"}
            >
              {locationChip.name ? `@${locationChip.name}` : "unassigned"}
            </span>
          ) : null}
        </div>
        {error ? (
          <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="t-num text-[15px] text-foreground">
          €{fmt(expense.amountCents)}
        </div>
        <div className="flex items-center gap-2">
          {!expense.isSettlement ? (
            <button
              type="button"
              onClick={onEdit}
              disabled={isPending}
              aria-label="Edit expense"
              className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
            >
              ✎
            </button>
          ) : null}
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            aria-label="Delete expense"
            className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

function LedgerRowEditor({
  expense,
  members,
  tripSlug,
  locations,
  categories,
  onDone,
}: {
  expense: Expense
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  categories: ExpenseCategoryRow[]
  onDone: () => void
}) {
  const validCategory = categories.some((c) => c.name === expense.category)
  const defaultCategory =
    categories.find((c) => c.name === EXPENSE_CATEGORY_DEFAULT)?.name ??
    categories[0]?.name ??
    ""
  const [title, setTitle] = React.useState(expense.title)
  const [amount, setAmount] = React.useState(fmt(expense.amountCents))
  const [category, setCategory] = React.useState<string>(
    validCategory ? expense.category : defaultCategory,
  )
  const [paidBy, setPaidBy] = React.useState(expense.paidBy)
  const [dayDate, setDayDate] = React.useState<string | null>(expense.dayDate)
  const [locationId, setLocationId] = React.useState<string | null>(
    expense.locationId,
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit =
    title.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !canSubmit) return
    startTransition(async () => {
      const result = await updateExpense({
        expenseId: expense.id,
        tripSlug,
        title: title.trim(),
        amount,
        category,
        paidBy,
        dayDate,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone()
      }}
      className="border-t border-border bg-card px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          edit expense
        </span>
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          aria-label="Cancel"
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <ExpenseFields
        title={title}
        onTitleChange={setTitle}
        amount={amount}
        onAmountChange={setAmount}
        dayDate={dayDate}
        onDayDateChange={setDayDate}
        categories={categories}
        category={category}
        onCategoryChange={setCategory}
        tripId={expense.tripId}
        tripSlug={tripSlug}
        paidBy={paidBy}
        onPaidByChange={setPaidBy}
        members={members}
        locations={locations}
        locationId={locationId}
        onLocationChange={setLocationId}
        disabled={isPending}
      />

      {error ? (
        <div className="mt-3 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !canSubmit}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
      </div>
    </form>
  )
}
