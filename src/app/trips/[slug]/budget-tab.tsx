"use client"

import * as React from "react"

import { Avatar, Label, TopoBg } from "@/components/together"
import {
  type BudgetSummary,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import { type SavingsContribution } from "@/lib/trips/savings-types"
import {
  dayLocationMap,
  expenseLocationId,
  type BudgetMove,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import { type ItineraryLocation } from "@/lib/trips/location-types"

import { AssistantBlock } from "@/components/assistant-block"

import { BudgetByCategory } from "./budget-by-category"
import { BudgetDrafter } from "./budget-drafter"
import { BudgetScopeEditor } from "./budget-scope-editor"
import { PlanningPlaceDoor } from "./find-a-place-planning"
import { PreTripChecklist } from "./pre-trip-checklist"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import { SavedFigure, SpentFigure } from "./budget-figures"
import { Ledger } from "./budget-ledger"
import { LogExpenseRow } from "./log-expense-row"
import type { MemberToneEntry } from "./packing-tab"
import { SettleUpButtons } from "./settle-up-card"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** A key that changes when a scope's item set changes. The guided drafter's
 * Apply (saveBudgetItems) replaces every row with a fresh id, so this remounts
 * the editor and re-seeds it from the new items; inline amount edits keep ids
 * and don't remount, so they stay smooth. */
function scopeKey(prefix: string, items: BudgetItem[]): string {
  return `${prefix}:${items.map((i) => i.id).join(",")}`
}

export interface BudgetTabProps {
  tripId: string
  tripSlug: string
  destination: string
  tripName: string
  tripDays: number
  expenses: Expense[]
  expenseCategories: ExpenseCategoryRow[]
  summary: BudgetSummary
  members: Record<string, MemberToneEntry>
  plannedBudgetCents: number
  savedCents: number
  savingsContributions: SavingsContribution[]
  savedPerUser: Record<string, number>
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  moves: BudgetMove[]
  budgetItems: BudgetItem[]
  itinerarySeeds: Record<string, string[]>
  bufferRec: { pct: number; reason: string }
  currentUserId: string
}

export function BudgetTab({
  tripId,
  tripSlug,
  destination,
  tripName,
  tripDays,
  expenses,
  expenseCategories,
  summary,
  members,
  plannedBudgetCents,
  savedCents,
  savingsContributions,
  savedPerUser,
  locations,
  itineraryDays,
  moves,
  budgetItems,
  itinerarySeeds,
  bufferRec,
  currentUserId,
}: BudgetTabProps) {
  const [settleOpen, setSettleOpen] = React.useState(false)
  const totalCents = summary.expenseTotalCents

  return (
    <section>
      <div className="relative overflow-hidden bg-dusk-tint px-5 pt-6 pb-4">
        <TopoBg tone="sea" opacity={0.1} />
        <div className="relative">
          <Label>Budget · {tripName}</Label>
        </div>
      </div>

      {/* Saved bar */}
      <div className="mx-5 my-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 pt-4 pb-4">
          <SavedFigure
            tripId={tripId}
            tripSlug={tripSlug}
            plannedBudgetCents={plannedBudgetCents}
            savedCents={savedCents}
            contributions={savingsContributions}
            perUser={savedPerUser}
            members={members}
            currentUserId={currentUserId}
          />
        </div>
      </div>

      {/* Spent bar + add expense */}
      <div className="mx-5 my-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 pt-4 pb-4">
          <SpentFigure
            tripId={tripId}
            tripSlug={tripSlug}
            spentCents={totalCents}
            plannedBudgetCents={plannedBudgetCents}
          />
        </div>
        <LogExpenseRow
          tripId={tripId}
          tripSlug={tripSlug}
          currentUserId={currentUserId}
          members={members}
          locations={locations}
          categories={expenseCategories}
        />
        <BudgetByCategory
          expenses={expenses}
          budgetItems={budgetItems}
          categories={expenseCategories}
          members={members}
          tripSlug={tripSlug}
          locations={locations}
          itineraryDays={itineraryDays}
        />
      </div>

      {/* Before you go */}
      <div className="mx-5 my-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 pt-4 pb-1">
          <Label>Before you go</Label>
        </div>
        <PreTripChecklist
          key={scopeKey(
            "pretrip",
            budgetItems.filter((i) => i.category === "Pre-trip"),
          )}
          tripId={tripId}
          tripSlug={tripSlug}
          budgetItems={budgetItems}
        />
      </div>

      {/* Plan a budget */}
      <div className="mx-5 my-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 pt-4 pb-1">
          <Label>Plan a budget</Label>
        </div>
        <BudgetDrafter
          tripId={tripId}
          tripSlug={tripSlug}
          tripName={tripName}
          tripDays={tripDays}
          plannedBudgetCents={plannedBudgetCents}
          locations={locations}
          itineraryDays={itineraryDays}
          memberCount={Object.keys(members).length}
          initialItems={budgetItems}
          itinerarySeeds={itinerarySeeds}
          bufferRec={bufferRec}
        />
        <PlannedBudget
          tripId={tripId}
          tripSlug={tripSlug}
          tripName={tripName}
          locations={locations}
          budgetItems={budgetItems}
          expenses={expenses}
          itineraryDays={itineraryDays}
          categories={expenseCategories}
        />
      </div>

      <CompactSettle
        summary={summary}
        currentUserId={currentUserId}
        tripId={tripId}
        tripSlug={tripSlug}
        alwaysShow
        open={settleOpen}
        onToggle={() => setSettleOpen((v) => !v)}
      >
        <SplitBreakdown
          members={members}
          paidByUser={summary.expensePaidByUser}
          settlementsByUser={summary.settlementsByUser}
        />
        <SettlementHistory expenses={expenses} members={members} />
      </CompactSettle>
      <div className="px-5 pt-4">
        <AssistantBlock
          surface="budget"
          tripSlug={tripSlug}
          door={
            <PlanningPlaceDoor
              tripId={tripId}
              tripSlug={tripSlug}
              destination={destination}
            />
          }
        />
      </div>
      <Ledger
        expenses={expenses}
        moves={moves}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
        itineraryDays={itineraryDays}
        categories={expenseCategories}
        contributions={savingsContributions}
      />
    </section>
  )
}

/** Always-visible planned-budget detail: one scope editor per location plus a
 * trip-wide bucket, or a single trip-name editor when no locations exist.
 * Reuses the itinerary's editors, so budget detail is editable with AI off. */
function PlannedBudget({
  tripId,
  tripSlug,
  tripName,
  locations,
  budgetItems,
  expenses,
  itineraryDays,
  categories,
}: {
  tripId: string
  tripSlug: string
  tripName: string
  locations: ItineraryLocation[]
  budgetItems: BudgetItem[]
  expenses: Expense[]
  itineraryDays: DayLocation[]
  categories: ExpenseCategoryRow[]
}) {
  const byLoc = new Map<string, BudgetItem[]>()
  for (const it of budgetItems) {
    if (!it.locationId) continue
    const arr = byLoc.get(it.locationId)
    if (arr) arr.push(it)
    else byLoc.set(it.locationId, [it])
  }
  const tripWide = budgetItems.filter(
    (it) => !it.locationId && it.category !== "Pre-trip",
  )
  const plannedTotalCents = budgetItems.reduce((s, it) => s + it.amountCents, 0)

  // Actual spend grouped by category, for the expenses attributed to one scope
  // (a location, or the unassigned/trip-wide bucket when locationId is null).
  const dayMap = dayLocationMap(itineraryDays)
  function spentForScope(locId: string | null): Record<string, number> {
    const out: Record<string, number> = {}
    for (const e of expenses) {
      if (e.isSettlement) continue
      if (expenseLocationId(e, dayMap) !== locId) continue
      out[e.category] = (out[e.category] ?? 0) + e.amountCents
    }
    return out
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-5">
      {locations.map((loc) => (
        <BudgetScopeEditor
          key={scopeKey(loc.id, byLoc.get(loc.id) ?? [])}
          tripId={tripId}
          tripSlug={tripSlug}
          locationId={loc.id}
          items={byLoc.get(loc.id) ?? []}
          withDates={false}
          defaultCategory="Accommodation"
          label={loc.name}
          categories={categories}
          spentByCategory={spentForScope(loc.id)}
        />
      ))}
      {locations.length === 0 ? (
        <BudgetScopeEditor
          key={scopeKey("trip", tripWide)}
          tripId={tripId}
          tripSlug={tripSlug}
          locationId={null}
          items={tripWide}
          withDates={false}
          defaultCategory="Accommodation"
          label={tripName}
          categories={categories}
          spentByCategory={spentForScope(null)}
        />
      ) : (
        <BudgetScopeEditor
          key={scopeKey("trip", tripWide)}
          tripId={tripId}
          tripSlug={tripSlug}
          locationId={null}
          items={tripWide}
          withDates
          defaultCategory="Other"
          label="Trip-wide"
          categories={categories}
          spentByCategory={spentForScope(null)}
        />
      )}
      <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Planned total
        </span>
        <span className="t-num font-mono text-[14px] text-foreground">
          €{fmt(plannedTotalCents)}
        </span>
      </div>
    </div>
  )
}

function SplitBreakdown({
  members,
  paidByUser,
  settlementsByUser,
}: {
  members: Record<string, MemberToneEntry>
  paidByUser: Record<string, number>
  settlementsByUser: Record<string, number>
}) {
  const entries = Object.entries(members)
  if (entries.length !== 2) return null
  return (
    <div className="px-5 pb-3 pt-3">
      <div className="grid grid-cols-2 gap-2.5">
        {entries.map(([userId, member]) => {
          const otherId = entries.find(([id]) => id !== userId)?.[0] ?? ""
          const sent = settlementsByUser[userId] ?? 0
          const received = settlementsByUser[otherId] ?? 0
          return (
            <div
              key={userId}
              className="rounded-lg border border-border bg-card px-3.5 py-3"
            >
              <div className="flex items-center gap-2">
                <Avatar name={member.initial} size={18} tone={member.tone} />
                <span className="font-serif text-[14px] italic text-foreground">
                  {member.displayName}
                </span>
              </div>
              <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                paid
              </div>
              <div className="t-num mt-0.5 text-[22px] text-foreground">
                €{fmt(paidByUser[userId] ?? 0)}
              </div>
              {sent > 0 ? (
                <div className="mt-2 flex items-baseline justify-between border-t border-rule pt-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-moss">
                    settled
                  </span>
                  <span className="t-num text-[13px] text-foreground">
                    €{fmt(sent)}
                  </span>
                </div>
              ) : null}
              {received > 0 ? (
                <div className="mt-2 flex items-baseline justify-between border-t border-rule pt-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    received
                  </span>
                  <span className="t-num text-[13px] text-foreground">
                    €{fmt(received)}
                  </span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompactSettle({
  summary,
  currentUserId,
  tripId,
  tripSlug,
  alwaysShow = false,
  open,
  onToggle,
  children,
}: {
  summary: BudgetSummary
  currentUserId: string
  tripId: string
  tripSlug: string
  alwaysShow?: boolean
  open?: boolean
  onToggle?: () => void
  children?: React.ReactNode
}) {
  const owedCents = Math.abs(summary.netBalanceCents)
  const isSquare = owedCents === 0
  if (isSquare && !alwaysShow) return null

  const youPay = summary.debtorUserId === currentUserId
  const youGet = summary.creditorUserId === currentUserId
  const label = isSquare
    ? "all square"
    : youPay
      ? "you pay"
      : youGet
        ? "you're owed"
        : "owed"
  const collapsible = onToggle != null

  return (
    <div className="border-y border-border">
      <div className="px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <SettleUpButtons owedCents={owedCents} tripId={tripId} tripSlug={tripSlug} />
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </div>
              <div className="t-num text-[18px] text-foreground">€{fmt(owedCents)}</div>
            </div>
            {collapsible ? (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-label="Toggle settle details"
                className="border-0 bg-transparent font-mono text-[14px] leading-none text-muted-foreground hover:text-foreground"
              >
                {open ? "⌄" : "›"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {collapsible && open ? children : null}
    </div>
  )
}

const HISTORY_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
})

function SettlementHistory({
  expenses,
  members,
}: {
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
}) {
  const settlements = expenses
    .filter((e) => e.isSettlement)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="px-5 pb-5 pt-1">
      <Label>Settlement history</Label>
      {settlements.length === 0 ? (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          No settlements yet
        </div>
      ) : (
        <div className="mt-2">
          {settlements.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 border-t border-border py-2.5"
            >
              <div className="flex items-center gap-2">
                <Avatar
                  name={members[s.paidBy]?.initial ?? "?"}
                  size={16}
                  tone={members[s.paidBy]?.tone ?? "sea"}
                />
                <span className="text-[13px] text-foreground">
                  {members[s.paidBy]?.displayName ?? "Someone"} paid
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {HISTORY_DATE.format(new Date(s.createdAt))}
                </span>
                <span className="t-num text-[14px] text-foreground">
                  €{fmt(s.amountCents)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
