"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { moveLocationBudget, setLocationBudget } from "@/lib/trips/actions"
import type { Expense } from "@/lib/trips/expense-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import {
  dayLocationMap,
  expensesForLocation,
  groupByMonth,
  movesForLocation,
  summarizeEnvelopes,
  type BudgetMove,
  type DayLocation,
  type Envelope,
  type EnvelopeSummary,
  type MonthGroup,
} from "@/lib/trips/location-budget-types"

import { BudgetMoveRow } from "./budget-move-row"
import { LedgerRow } from "./ledger-row"
import type { MemberToneEntry } from "./packing-tab"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

type View = "location" | "month"

/** A move endpoint: a location, or the unallocated pool (id null). */
interface MoveTarget {
  id: string | null
  name: string
}

export interface BudgetByLocationProps {
  tripId: string
  tripSlug: string
  masterBudgetCents: number
  locations: ItineraryLocation[]
  expenses: Expense[]
  itineraryDays: DayLocation[]
  members: Record<string, MemberToneEntry>
  moves: BudgetMove[]
}

export function BudgetByLocation({
  tripId,
  tripSlug,
  masterBudgetCents,
  locations,
  expenses,
  itineraryDays,
  members,
  moves,
}: BudgetByLocationProps) {
  const [view, setView] = React.useState<View>("location")
  const summary = summarizeEnvelopes(
    expenses,
    locations,
    itineraryDays,
    masterBudgetCents,
  )
  const months = groupByMonth(expenses)
  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="flex items-center justify-between">
        <Label>Budget by {view}</Label>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {view === "location" ? (
        <LocationView
          tripId={tripId}
          tripSlug={tripSlug}
          masterBudgetCents={masterBudgetCents}
          summary={summary}
          locations={locations}
          expenses={expenses}
          moves={moves}
          members={members}
          dayMap={dayMap}
          locationsById={locationsById}
        />
      ) : (
        <MonthView months={months} />
      )}
    </div>
  )
}

function ViewToggle({
  view,
  onChange,
}: {
  view: View
  onChange: (v: View) => void
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-background p-0.5">
      {(["location", "month"] as View[]).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ${
            view === v
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function LocationView({
  tripId,
  tripSlug,
  masterBudgetCents,
  summary,
  locations,
  expenses,
  moves,
  members,
  dayMap,
  locationsById,
}: {
  tripId: string
  tripSlug: string
  masterBudgetCents: number
  summary: EnvelopeSummary
  locations: ItineraryLocation[]
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  dayMap: Record<string, string>
  locationsById: Record<string, string>
}) {
  if (locations.length === 0) {
    return (
      <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {summary.unassignedSpentCents > 0
          ? `Unassigned · €${fmt(summary.unassignedSpentCents)}`
          : "Add locations in the itinerary to budget by place"}
      </div>
    )
  }

  const overAllocated = summary.unallocatedCents < 0
  const targets: MoveTarget[] = [
    { id: null, name: "Unallocated" },
    ...summary.envelopes.map((e) => ({ id: e.locationId, name: e.name })),
  ]

  return (
    <div className="mt-2">
      <div className="flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
        <span>
          Allocated €{fmt(summary.allocatedCents)} of €{fmt(masterBudgetCents)}
        </span>
        <span className={overAllocated ? "text-clay" : ""}>
          {overAllocated
            ? `€${fmt(-summary.unallocatedCents)} over`
            : `€${fmt(summary.unallocatedCents)} unallocated`}
        </span>
      </div>

      {summary.envelopes.map((e) => (
        <EnvelopeRow
          key={e.locationId ?? "none"}
          tripId={tripId}
          tripSlug={tripSlug}
          envelope={e}
          targets={targets}
          expenses={expenses}
          moves={moves}
          members={members}
          locations={locations}
          dayMap={dayMap}
          locationsById={locationsById}
        />
      ))}

      {summary.unassignedSpentCents > 0 ? (
        <UnassignedRow
          tripSlug={tripSlug}
          spentCents={summary.unassignedSpentCents}
          expenses={expenses}
          members={members}
          locations={locations}
          dayMap={dayMap}
        />
      ) : null}
    </div>
  )
}

function EnvelopeRow({
  tripId,
  tripSlug,
  envelope,
  targets,
  expenses,
  moves,
  members,
  locations,
  dayMap,
  locationsById,
}: {
  tripId: string
  tripSlug: string
  envelope: Envelope
  targets: MoveTarget[]
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  dayMap: Record<string, string>
  locationsById: Record<string, string>
}) {
  const [moving, setMoving] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const locationId = envelope.locationId as string
  const hasTarget = envelope.budgetCents !== null
  const target = envelope.budgetCents ?? 0
  const leftover = target - envelope.spentCents
  const over = leftover < 0
  const pct =
    hasTarget && target > 0
      ? Math.min(100, Math.round((envelope.spentCents / target) * 100))
      : 0

  return (
    <div className="border-t border-border py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between border-0 bg-transparent p-0 text-left"
      >
        <span className="font-serif text-[14px] italic text-foreground">
          {envelope.name}
        </span>
        <span className="t-num text-[13px] text-foreground">
          €{fmt(envelope.spentCents)}
          {hasTarget ? (
            <span className="text-muted-foreground"> / €{fmt(target)}</span>
          ) : null}
        </span>
      </button>

      {hasTarget ? (
        <>
          <div className="mt-2">
            <Bar pct={pct} tone={over ? "clay" : "sea"} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>{pct}% of budget</span>
            <span className={over ? "text-clay" : ""}>
              {over ? `€${fmt(-leftover)} over` : `€${fmt(leftover)} left`}
            </span>
          </div>
        </>
      ) : null}

      <div className="mt-1.5 flex items-center gap-3">
        <TargetEditor
          tripSlug={tripSlug}
          locationId={locationId}
          budgetCents={envelope.budgetCents}
        />
        {hasTarget && leftover !== 0 ? (
          <button
            type="button"
            onClick={() => setMoving((v) => !v)}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            {over ? "cover" : "move"}
          </button>
        ) : null}
      </div>

      {moving ? (
        <MoveForm
          tripId={tripId}
          tripSlug={tripSlug}
          envelope={envelope}
          leftover={leftover}
          targets={targets.filter((t) => t.id !== locationId)}
          onDone={() => setMoving(false)}
        />
      ) : null}

      {expanded ? (
        <LocationActivity
          tripSlug={tripSlug}
          locationId={locationId}
          expenses={expenses}
          moves={moves}
          members={members}
          locations={locations}
          dayMap={dayMap}
          locationsById={locationsById}
        />
      ) : null}
    </div>
  )
}

function LocationActivity({
  tripSlug,
  locationId,
  expenses,
  moves,
  members,
  locations,
  dayMap,
  locationsById,
}: {
  tripSlug: string
  locationId: string | null
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  dayMap: Record<string, string>
  locationsById: Record<string, string>
}) {
  const locExpenses = expensesForLocation(expenses, dayMap, locationId)
  const locMoves = locationId ? movesForLocation(moves, locationId) : []
  const items = [
    ...locExpenses.map((e) => ({ kind: "expense" as const, at: e.createdAt, expense: e })),
    ...locMoves.map(({ move }) => ({ kind: "move" as const, at: move.createdAt, move })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  if (items.length === 0) {
    return (
      <div className="mt-1 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        No activity yet
      </div>
    )
  }

  return (
    <div className="mt-1 border-t border-rule">
      {items.map((item) =>
        item.kind === "expense" ? (
          <LedgerRow
            key={`e-${item.expense.id}`}
            expense={item.expense}
            members={members}
            tripSlug={tripSlug}
            locations={locations}
          />
        ) : (
          <BudgetMoveRow
            key={`m-${item.move.id}`}
            move={item.move}
            locationsById={locationsById}
            perspectiveLocationId={locationId ?? undefined}
          />
        ),
      )}
    </div>
  )
}

function UnassignedRow({
  tripSlug,
  spentCents,
  expenses,
  members,
  locations,
  dayMap,
}: {
  tripSlug: string
  spentCents: number
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  dayMap: Record<string, string>
}) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <div className="border-t border-border py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between border-0 bg-transparent p-0 text-left"
      >
        <span className="font-serif text-[14px] italic text-muted-foreground">
          Unassigned
        </span>
        <span className="t-num text-[13px] text-foreground">
          €{fmt(spentCents)}
        </span>
      </button>
      {expanded ? (
        <LocationActivity
          tripSlug={tripSlug}
          locationId={null}
          expenses={expenses}
          moves={[]}
          members={members}
          locations={locations}
          dayMap={dayMap}
          locationsById={{}}
        />
      ) : null}
    </div>
  )
}

function TargetEditor({
  tripSlug,
  locationId,
  budgetCents,
}: {
  tripSlug: string
  locationId: string
  budgetCents: number | null
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function open() {
    setValue(budgetCents ? (budgetCents / 100).toFixed(0) : "")
    setError(null)
    setEditing(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const trimmed = value.trim()
    const cents = trimmed === "" ? null : Math.round(Number(trimmed) * 100)
    if (cents !== null && (!Number.isFinite(cents) || cents <= 0)) {
      setError("Enter a valid amount.")
      return
    }
    startTransition(async () => {
      const result = await setLocationBudget({
        locationId,
        tripSlug,
        budgetCents: cents,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setEditing(false)
    })
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        {budgetCents !== null ? "edit budget" : "+ set budget"}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[12px] text-muted-foreground">€</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isPending}
        placeholder="0"
        className="t-num w-20 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full border-0 bg-foreground px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
      >
        {isPending ? "…" : "save"}
      </button>
      {error ? (
        <span className="font-mono text-[9px] text-clay">{error}</span>
      ) : null}
    </form>
  )
}

function MoveForm({
  tripId,
  tripSlug,
  envelope,
  leftover,
  targets,
  onDone,
}: {
  tripId: string
  tripSlug: string
  envelope: Envelope
  leftover: number
  targets: MoveTarget[]
  onDone: () => void
}) {
  const over = leftover < 0
  const locationId = envelope.locationId as string
  const [amount, setAmount] = React.useState(
    (Math.abs(leftover) / 100).toFixed(0),
  )
  const [otherId, setOtherId] = React.useState<string>(
    targets[0]?.id ?? "",
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid amount.")
      return
    }
    // Leftover: debit this location, credit the picked one.
    // Over (cover): debit the picked one, credit this location.
    const other = otherId === "" ? null : otherId
    const fromLocationId = over ? other : locationId
    const toLocationId = over ? locationId : other
    startTransition(async () => {
      const result = await moveLocationBudget({
        tripId,
        tripSlug,
        fromLocationId,
        toLocationId,
        amountCents: cents,
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
      className="mt-2 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {over ? `Cover ${envelope.name} from` : `Move from ${envelope.name} to`}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-muted-foreground">€</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isPending}
          className="t-num w-20 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
        />
        <select
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          disabled={isPending}
          className="border-0 border-b border-border bg-transparent py-0.5 text-[13px] text-foreground focus:outline-none"
        >
          {targets.map((t) => (
            <option key={t.id ?? "pool"} value={t.id ?? ""}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full border-0 bg-foreground px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : over ? "cover" : "move"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          aria-label="Cancel"
          className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[9px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}

function MonthView({ months }: { months: MonthGroup[] }) {
  if (months.length === 0) {
    return (
      <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        No expenses yet
      </div>
    )
  }
  return (
    <div className="mt-2">
      {months.map((m) => (
        <div
          key={m.key}
          className="flex items-baseline justify-between border-t border-border py-3"
        >
          <span className="font-serif text-[14px] italic text-foreground">
            {m.label}
          </span>
          <span className="t-num text-[13px] text-foreground">
            €{fmt(m.spentCents)}
          </span>
        </div>
      ))}
    </div>
  )
}
