"use client"

import * as React from "react"

import { logExpense } from "@/lib/trips/actions"
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DEFAULT,
  type ExpenseCategory,
} from "@/lib/trips/expense-types"

import type { MemberToneEntry } from "./packing-tab"

export interface LogExpenseRowProps {
  tripId: string
  tripSlug: string
  startDate: string | null
  endDate: string | null
  currentUserId: string
  members: Record<string, MemberToneEntry>
}

interface DayOption {
  value: string
  label: string
}

const SHORT_MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function enumerateDays(
  startDate: string | null,
  endDate: string | null,
): DayOption[] {
  if (!startDate || !endDate) return []
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  if (end < start) return []
  const days: DayOption[] = []
  for (
    let d = new Date(start);
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
    const dd = String(d.getUTCDate()).padStart(2, "0")
    days.push({
      value: `${yyyy}-${mm}-${dd}`,
      label: SHORT_MONTH_DAY.format(d),
    })
  }
  return days
}

function defaultDay(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return null
  const todayIso = new Date().toISOString().slice(0, 10)
  if (todayIso >= startDate && todayIso <= endDate) return todayIso
  return startDate
}

export function LogExpenseRow({
  tripId,
  tripSlug,
  startDate,
  endDate,
  currentUserId,
  members,
}: LogExpenseRowProps) {
  const dayOptions = React.useMemo(
    () => enumerateDays(startDate, endDate),
    [startDate, endDate],
  )
  const initialDay = React.useMemo(
    () => defaultDay(startDate, endDate),
    [startDate, endDate],
  )

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
          + log expense
        </span>
        <span aria-hidden className="font-mono text-[14px] text-muted-foreground">
          ›
        </span>
      </button>
    )
  }

  const memberEntries = Object.entries(members)
  const usePillToggle = memberEntries.length === 2
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
          log expense
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

      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add an expense…"
        disabled={isPending}
        className="w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Amount
          </span>
          <div className="mt-1 flex items-baseline gap-1.5 border-b border-rule pb-1 focus-within:border-clay">
            <span className="font-mono text-[14px] text-muted-foreground">€</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={isPending}
              className="t-num w-full border-0 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
          </div>
        </label>

        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Day
          </span>
          <select
            value={dayDate ?? ""}
            onChange={(e) =>
              setDayDate(e.target.value === "" ? null : e.target.value)
            }
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          >
            <option value="">— no day</option>
            {dayOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Category
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <div className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Paid by
          </span>
          {usePillToggle ? (
            <div className="mt-1 inline-flex rounded-full border border-border bg-background p-0.5">
              {memberEntries.map(([userId, m]) => {
                const active = userId === paidBy
                return (
                  <button
                    key={userId}
                    type="button"
                    onClick={() => setPaidBy(userId)}
                    disabled={isPending}
                    aria-pressed={active}
                    className={`rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                      active
                        ? m.tone === "sea"
                          ? "bg-sea text-background"
                          : "bg-clay text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.initial}
                  </button>
                )
              })}
            </div>
          ) : (
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              disabled={isPending}
              className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            >
              {memberEntries.map(([userId, m]) => (
                <option key={userId} value={userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

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
