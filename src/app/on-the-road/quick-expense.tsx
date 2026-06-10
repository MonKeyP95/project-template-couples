"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { logExpense } from "@/lib/trips/actions"
import { Label } from "@/components/together"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"

export interface QuickExpenseProps {
  tripId: string
  tripSlug: string
  today: string
  currentUserId: string
  categories: ExpenseCategoryRow[]
  spentTodayCents: number
}

export function QuickExpense({
  tripId,
  tripSlug,
  today,
  currentUserId,
  categories,
  spentTodayCents,
}: QuickExpenseProps) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [category, setCategory] = React.useState(categories[0]?.name ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit =
    name.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !canSubmit) return
    startTransition(async () => {
      const result = await logExpense({
        tripId,
        tripSlug,
        title: name.trim(),
        amount,
        category,
        paidBy: currentUserId,
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
      router.refresh()
    })
  }

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <Label>Quick expense</Label>
        <span className="t-num text-[13px] text-muted-foreground">
          €{(spentTodayCents / 100).toFixed(2)} today
        </span>
      </div>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2.5">
        <div className="flex gap-2">
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
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isPending}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending || !canSubmit}
            className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "add"}
          </button>
        </div>
        {error ? (
          <div className="font-mono text-[10px] text-clay">{error}</div>
        ) : null}
      </form>
    </section>
  )
}
