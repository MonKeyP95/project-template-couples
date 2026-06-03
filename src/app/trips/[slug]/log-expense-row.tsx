"use client"

import * as React from "react"

import { logExpense } from "@/lib/trips/actions"
import {
  EXPENSE_CATEGORY_DEFAULT,
  type ExpenseCategory,
} from "@/lib/trips/expense-types"

import { ExpenseFields } from "./expense-fields"
import type { MemberToneEntry } from "./packing-tab"

export interface LogExpenseRowProps {
  tripId: string
  tripSlug: string
  currentUserId: string
  members: Record<string, MemberToneEntry>
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function LogExpenseRow({
  tripId,
  tripSlug,
  currentUserId,
  members,
}: LogExpenseRowProps) {
  const initialDay = React.useMemo(() => todayIso(), [])

  const [expanded, setExpanded] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [category, setCategory] = React.useState<ExpenseCategory>(
    EXPENSE_CATEGORY_DEFAULT,
  )
  const [paidBy, setPaidBy] = React.useState<string>(currentUserId)
  const [dayDate, setDayDate] = React.useState<string | null>(initialDay)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const titleRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) titleRef.current?.focus()
  }, [expanded])

  function collapse() {
    setExpanded(false)
    setTitle("")
    setAmount("")
    setCategory(EXPENSE_CATEGORY_DEFAULT)
    setPaidBy(currentUserId)
    setDayDate(initialDay)
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const trimmedTitle = title.trim()
    const amountNum = Number(amount)
    if (!trimmedTitle) return
    if (!Number.isFinite(amountNum) || amountNum <= 0) return

    startTransition(async () => {
      const result = await logExpense({
        tripId,
        tripSlug,
        title: trimmedTitle,
        amount,
        category,
        paidBy,
        dayDate,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setTitle("")
      setAmount("")
      setError(null)
      titleRef.current?.focus()
    })
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between border-0 border-t border-border bg-card px-5 py-4 text-left"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          + add expense
        </span>
        <span aria-hidden className="font-mono text-[14px] text-muted-foreground">
          ›
        </span>
      </button>
    )
  }

  const canSubmit =
    title.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") collapse()
      }}
      className="border-t border-border bg-card px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          add expense
        </span>
        <button
          type="button"
          onClick={collapse}
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
        titleRef={titleRef}
        amount={amount}
        onAmountChange={setAmount}
        dayDate={dayDate}
        onDayDateChange={setDayDate}
        category={category}
        onCategoryChange={setCategory}
        paidBy={paidBy}
        onPaidByChange={setPaidBy}
        members={members}
        disabled={isPending}
      />

      {error ? (
        <div className="mt-3 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={collapse}
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
          {isPending ? "…" : "add expense"}
        </button>
      </div>
    </form>
  )
}
