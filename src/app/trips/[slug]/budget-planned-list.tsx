"use client"

import * as React from "react"

import {
  addBudgetItem,
  deleteBudgetItem,
  payBudgetItem,
  unpayBudgetItem,
  updateBudgetItem,
} from "@/lib/trips/actions"
import { isBufferSubject, type BudgetItem } from "@/lib/trips/budget-item-types"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import { useMoney } from "@/components/money-context"
import { deviceToday } from "@/lib/time/today"

import { DetailLine, DetailList, NOTE_CLASS, displayName } from "./budget-detail-parts"

/** Where a new planned line goes; no category means the form shows a picker. */
export interface PlanDefaults {
  category?: string
  locationId: string | null
}

interface Props {
  items: BudgetItem[]
  plannedWhere: (item: BudgetItem) => string
  planDefaults: PlanDefaults
  tripId: string
  tripSlug: string
  categories: ExpenseCategoryRow[]
  fmt: (cents: number) => string
}

const FORM_CLASS = "my-1.5 rounded-lg bg-card px-3 py-3"
const INPUT_CLASS =
  "w-full border-0 border-b border-rule bg-transparent pb-1 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-clay focus:outline-none"
const QUIET_BUTTON =
  "border-0 bg-transparent px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
const SAVE_BUTTON =
  "rounded-full border-0 bg-sea px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"

/** Cents from an amount field, or null when it isn't a non-negative number. */
function parseCents(value: string): number | null {
  const n = Number(value)
  return value.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

/** A row's planned lines. Tap one to fix it in place; the buffer line stays
 * read-only (the drafter derives it). "+ add planned" appends a line. */
export function PlannedList({ items, plannedWhere, planDefaults, fmt, ...ctx }: Props) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [adding, setAdding] = React.useState(false)

  return (
    <DetailList title="Planned">
      {items.map((it) =>
        it.id === editingId ? (
          <PlannedLineEditor
            key={it.id}
            item={it}
            tripSlug={ctx.tripSlug}
            onDone={() => setEditingId(null)}
          />
        ) : (
          <PlannedLine
            key={it.id}
            item={it}
            where={plannedWhere(it)}
            fmt={fmt}
            onEdit={isBufferSubject(it.subject) ? null : () => setEditingId(it.id)}
          />
        ),
      )}
      {adding ? (
        <PlannedLineAdd defaults={planDefaults} onDone={() => setAdding(false)} {...ctx} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:text-foreground"
        >
          + add planned
        </button>
      )}
    </DetailList>
  )
}

function PlannedLine({
  item,
  where,
  fmt,
  onEdit,
}: {
  item: BudgetItem
  where: string
  fmt: (cents: number) => string
  onEdit: (() => void) | null
}) {
  const line = (
    <DetailLine amount={fmt(item.amountCents)}>
      {item.subject || displayName(item.category)}
      <span className="text-muted-foreground">
        {" · "}
        {where}
      </span>
      <span
        className={`ml-1.5 ${NOTE_CLASS} ${item.paidExpenseId ? "text-moss" : "text-muted-foreground"}`}
      >
        {item.paidExpenseId ? "paid" : "not yet"}
      </span>
    </DetailLine>
  )
  if (onEdit === null) return line
  return (
    <button
      type="button"
      onClick={onEdit}
      className="block w-full border-t border-border text-left first:border-t-0"
    >
      {line}
    </button>
  )
}

/** Subject and amount inputs shared by the edit and add forms. */
function PlannedFields({
  subject,
  onSubject,
  amount,
  onAmount,
  disabled,
}: {
  subject: string
  onSubject: (v: string) => void
  amount: string
  onAmount: (v: string) => void
  disabled: boolean
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
      <input
        value={subject}
        onChange={(e) => onSubject(e.target.value)}
        placeholder="What"
        aria-label="What"
        disabled={disabled}
        className={INPUT_CLASS}
      />
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
        placeholder="0"
        aria-label="Amount"
        disabled={disabled}
        className={`t-num text-right ${INPUT_CLASS}`}
      />
    </div>
  )
}

/** Edits one planned line. Saving changes only the plan, never its expense. */
function PlannedLineEditor({
  item,
  tripSlug,
  onDone,
}: {
  item: BudgetItem
  tripSlug: string
  onDone: () => void
}) {
  const { moneyInput } = useMoney()
  const [subject, setSubject] = React.useState(item.subject)
  const [amount, setAmount] = React.useState(moneyInput(item.amountCents))
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const cents = parseCents(amount)
  const paid = item.paidExpenseId !== null

  function run(action: () => Promise<{ error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (res.error) setError(res.error)
      else onDone()
    })
  }

  const save = () => updateBudgetItem({ itemId: item.id, tripSlug, subject, amountCents: cents ?? 0 })

  /** Mark paid saves first, so the logged expense carries the edited amount. */
  async function saveThenPay() {
    const saved = await save()
    if (saved.error) return saved
    return payBudgetItem(item.id, tripSlug, deviceToday())
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (cents !== null) run(save)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone()
      }}
      className={FORM_CLASS}
    >
      <PlannedFields
        subject={subject}
        onSubject={setSubject}
        amount={amount}
        onAmount={setAmount}
        disabled={pending}
      />
      {error ? <div className="mt-2 font-mono text-[10px] text-clay">{error}</div> : null}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => run(paid ? () => unpayBudgetItem(item.id, tripSlug) : saveThenPay)}
          disabled={pending || cents === null}
          className={QUIET_BUTTON}
        >
          {paid ? "unpay" : "mark paid"}
        </button>
        <button
          type="button"
          onClick={() => run(() => deleteBudgetItem(item.id, tripSlug))}
          disabled={pending}
          className={`${QUIET_BUTTON} hover:text-clay`}
        >
          {paid ? "delete + its payment" : "delete"}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onDone} disabled={pending} className={QUIET_BUTTON}>
          cancel
        </button>
        <button type="submit" disabled={pending || cents === null} className={SAVE_BUTTON}>
          {pending ? "…" : "save"}
        </button>
      </div>
    </form>
  )
}

/** Adds a planned line to this row; shows a category picker when the row
 * isn't a category (a place, or Trip-wide). */
function PlannedLineAdd({
  defaults,
  tripId,
  tripSlug,
  categories,
  onDone,
}: {
  defaults: PlanDefaults
  tripId: string
  tripSlug: string
  categories: ExpenseCategoryRow[]
  onDone: () => void
}) {
  const [subject, setSubject] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [category, setCategory] = React.useState(defaults.category ?? categories[0]?.name ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const cents = parseCents(amount)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (cents === null || category === "") return
    setError(null)
    startTransition(async () => {
      const res = await addBudgetItem({
        tripId,
        tripSlug,
        category,
        locationId: defaults.locationId,
        subject,
        amountCents: cents,
      })
      if (res.error) setError(res.error)
      else onDone()
    })
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone()
      }}
      className={FORM_CLASS}
    >
      <PlannedFields
        subject={subject}
        onSubject={setSubject}
        amount={amount}
        onAmount={setAmount}
        disabled={pending}
      />
      {defaults.category === undefined ? (
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          disabled={pending}
          className={`mt-3 ${INPUT_CLASS}`}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
      {error ? <div className="mt-2 font-mono text-[10px] text-clay">{error}</div> : null}
      <div className="mt-3 flex justify-end gap-1">
        <button type="button" onClick={onDone} disabled={pending} className={QUIET_BUTTON}>
          cancel
        </button>
        <button
          type="submit"
          disabled={pending || cents === null || category === ""}
          className={SAVE_BUTTON}
        >
          {pending ? "…" : "add"}
        </button>
      </div>
    </form>
  )
}
