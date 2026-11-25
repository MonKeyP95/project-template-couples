"use client"

import * as React from "react"

import { Bar, CategoryIcon, categoryToneOf, type BarTone } from "@/components/together"
import { useCurrency } from "@/components/currency-context"
import { money } from "@/lib/money"
import {
  byCategoryLines,
  PRE_TRIP,
  type CategoryLine,
} from "@/lib/trips/budget-by-category-types"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import {
  homeCents,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import type { DayLocation } from "@/lib/trips/location-budget-types"
import { DetailLine, DetailList, NOTE_CLASS, displayName } from "./budget-detail-parts"
import { PlannedList, type PlanDefaults } from "./budget-planned-list"
import { LedgerRowEditor } from "./ledger-row"
import { LogExpenseRow } from "./log-expense-row"
import type { MemberToneEntry } from "./packing-tab"

const SPENT_SHOWN = 5

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
})

interface Props {
  tripId: string
  tripSlug: string
  currentPersonId: string
  expenses: Expense[]
  budgetItems: BudgetItem[]
  categories: ExpenseCategoryRow[]
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  members: Record<string, MemberToneEntry>
  tripStarted: boolean
}

/** Spent-vs-plan per category, under the Spent figure. Tap a line
 * to see, and fix, the planned items and expenses behind it. */
export function BudgetByCategory(props: Props) {
  const { currency } = useCurrency()
  const [open, setOpen] = React.useState<string | null>(null)
  const fmt = (cents: number) => money(cents, currency)
  const categoryNames = props.categories.map((c) => c.name)
  const { lines, preTripFootCents } = byCategoryLines(
    props.expenses.map((e) => ({
      category: e.category,
      isSettlement: e.isSettlement,
      amountCents: homeCents(e),
    })),
    props.budgetItems,
    categoryNames,
    props.tripStarted,
  )

  return (
    <>
      <div className="mt-1">
        {lines.map((line) => (
          <BudgetRow
            key={line.category}
            name={displayName(line.category)}
            line={line}
            tone={categoryToneOf(line.category, categoryNames)}
            icon={
              <CategoryIcon
                name={line.category}
                tone={categoryToneOf(line.category, categoryNames)}
                size={20}
              />
            }
            isOpen={open === line.category}
            onToggle={() =>
              setOpen(open === line.category ? null : line.category)
            }
            fmt={fmt}
          >
            <CategoryDetail category={line.category} fmt={fmt} {...props} />
          </BudgetRow>
        ))}
      </div>
      {preTripFootCents > 0 ? (
        <div className="mt-2 flex justify-between border-t border-dashed border-border pt-2 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          <span>+ paid before the trip</span>
          <span className="t-num">{fmt(preTripFootCents)}</span>
        </div>
      ) : null}
    </>
  )
}

/** The figures a row shows: spent against plan, its status and bar fill. */
type RowLine = Pick<CategoryLine, "status" | "pct" | "actualCents" | "plannedCents">

function StatusNote({
  line,
  fmt,
}: {
  line: RowLine
  fmt: (cents: number) => string
}) {
  if (line.status === "over") {
    return (
      <span className={`${NOTE_CLASS} text-destructive`}>
        {fmt(line.actualCents - line.plannedCents)} over
      </span>
    )
  }
  if (line.status === "unplanned") {
    return <span className={`${NOTE_CLASS} text-muted-foreground`}>no budget</span>
  }
  if (line.status === "paidAhead") {
    return <span className={`${NOTE_CLASS} text-moss`}>paid in advance</span>
  }
  return null
}

/** One tappable spent-vs-plan row; `children` is its detail, shown when open. */
export function BudgetRow({
  name,
  line,
  tone = "sea",
  icon,
  isOpen,
  onToggle,
  fmt,
  children,
}: {
  name: string
  line: RowLine
  /** Fill unless over plan, which is always red. */
  tone?: BarTone
  /** Shown before the name, e.g. the category icon. */
  icon?: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  fmt: (cents: number) => string
  children: React.ReactNode
}) {
  const warn = line.status === "over"
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="grid w-full grid-cols-[10px_minmax(0,7rem)_1fr_auto] items-center gap-x-2.5 py-1.5 text-left"
      >
        <span
          className={`text-[8px] text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
        >
          {"▶"}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="truncate text-[13px] text-foreground">{name}</span>
        </span>
        <Bar pct={line.pct} tone={warn ? "red" : tone} />
        <span className="t-num whitespace-nowrap text-right font-mono text-[11px] text-foreground">
          {fmt(line.actualCents)}
          {line.plannedCents === 0 ? null : (
            <span className="text-muted-foreground"> / {fmt(line.plannedCents)}</span>
          )}
        </span>
        <span className="col-start-3 col-end-5">
          <StatusNote line={line} fmt={fmt} />
        </span>
      </button>
      {isOpen ? children : null}
    </div>
  )
}

function CategoryDetail({
  category,
  fmt,
  expenses,
  budgetItems,
  tripId,
  tripSlug,
  currentPersonId,
  locations,
  itineraryDays,
  categories,
  members,
}: Props & { category: string; fmt: (cents: number) => string }) {
  const placeName = new Map(locations.map((l) => [l.id, l.name]))
  return (
    <RowDetail
      planned={budgetItems.filter((it) => it.category === category)}
      spent={expenses.filter((e) => e.category === category)}
      plannedWhere={(it) =>
        it.locationId ? (placeName.get(it.locationId) ?? "") : "Trip-wide"
      }
      planDefaults={{ category, locationId: null }}
      addDefaults={category === PRE_TRIP ? null : { category }}
      tripId={tripId}
      currentPersonId={currentPersonId}
      tripSlug={tripSlug}
      locations={locations}
      itineraryDays={itineraryDays}
      categories={categories}
      members={members}
      fmt={fmt}
    />
  )
}

/** A row's opened detail: its planned lines (paid or not yet) and its latest
 * spending. `plannedWhere` is the grey note after each planned line. */
export function RowDetail({
  planned,
  spent,
  plannedWhere,
  planDefaults,
  addDefaults,
  tripId,
  currentPersonId,
  itineraryDays,
  ...rest
}: {
  planned: BudgetItem[]
  spent: Expense[]
  plannedWhere: (item: BudgetItem) => string
  /** Where a planned line added from this row goes. */
  planDefaults: PlanDefaults
  /** What a new expense from this row starts with; null hides "+ add expense". */
  addDefaults: { category?: string; locationId?: string | null } | null
  tripId: string
  currentPersonId: string
  /** Trip days, for dividing a new expense. */
  itineraryDays: DayLocation[]
} & SpentListProps) {
  const { fmt, tripSlug, locations, categories, members } = rest
  const [adding, setAdding] = React.useState(false)
  const latest = spent
    .filter((e) => !e.isSettlement)
    .sort((a, b) =>
      (b.dayDate ?? b.createdAt).localeCompare(a.dayDate ?? a.createdAt),
    )

  return (
    <div className="mb-2 ml-5 flex flex-col gap-3 rounded-lg bg-sea-tint px-3 py-2.5">
      <PlannedList
        items={planned}
        plannedWhere={plannedWhere}
        planDefaults={planDefaults}
        tripId={tripId}
        tripSlug={tripSlug}
        categories={categories}
        fmt={fmt}
      />
      {latest.length > 0 ? <SpentList expenses={latest} {...rest} /> : null}
      {addDefaults === null ? null : adding ? (
        <LogExpenseRow
          tripId={tripId}
          tripSlug={tripSlug}
          currentPersonId={currentPersonId}
          members={members}
          locations={locations}
          itineraryDays={itineraryDays}
          categories={categories}
          initialCategory={addDefaults.category}
          initialLocationId={addDefaults.locationId}
          onClose={() => setAdding(false)}
          className="rounded-lg bg-card px-3 py-3"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:text-foreground"
        >
          + add expense
        </button>
      )}
    </div>
  )
}

interface SpentListProps {
  tripSlug: string
  locations: ItineraryLocation[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  fmt: (cents: number) => string
}

/** Spent lines, newest first. Tapping one opens the ledger's editor in its
 * place, so a review can fix amounts, categories and places where it reads. */
function SpentList({
  expenses,
  members,
  fmt,
  ...editor
}: SpentListProps & { expenses: Expense[] }) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [showAll, setShowAll] = React.useState(false)
  const shown = showAll ? expenses : expenses.slice(0, SPENT_SHOWN)

  return (
    <DetailList title="Spent">
      {shown.map((e) =>
        e.id === editingId ? (
          <LedgerRowEditor
            key={e.id}
            expense={e}
            members={members}
            onDone={() => setEditingId(null)}
            className="my-1.5 rounded-lg bg-card px-3 py-3"
            {...editor}
          />
        ) : (
          <button
            key={e.id}
            type="button"
            onClick={() => setEditingId(e.id)}
            className="block w-full border-t border-border text-left first:border-t-0"
          >
            <DetailLine amount={fmt(homeCents(e))}>
              {e.title}
              <span className="text-muted-foreground">
                {" · "}
                {SHORT_DATE.format(new Date(e.dayDate ?? e.createdAt))}
                {" · "}
                {members[e.paidBy]?.displayName ?? "Someone"}
              </span>
            </DetailLine>
          </button>
        ),
      )}
      {!showAll && expenses.length > SPENT_SHOWN ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-border pt-1.5 text-left text-[12px] text-muted-foreground hover:text-foreground"
        >
          show all {expenses.length}
        </button>
      ) : null}
    </DetailList>
  )
}

