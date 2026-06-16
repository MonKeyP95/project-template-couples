"use client"

import * as React from "react"

import { Avatar, Label, SegBtn, TopoBg } from "@/components/together"
import {
  type BudgetSummary,
  type Expense,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
import { type SavingsContribution } from "@/lib/trips/savings-types"
import {
  type BudgetMove,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import { type ItineraryLocation } from "@/lib/trips/location-types"

import { AiSuggestion } from "@/components/ai-suggestion"

import { BudgetByLocation } from "./budget-by-location"
import { BudgetDrafter } from "./budget-drafter"
import { SavedFigure, SpentFigure } from "./budget-figures"
import { Ledger } from "./budget-ledger"
import { LogExpenseRow } from "./log-expense-row"
import type { MemberToneEntry } from "./packing-tab"
import { SettleUpButtons } from "./settle-up-card"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

type View = "budget" | "expense" | "saved" | "settle"

export interface BudgetTabProps {
  tripId: string
  tripSlug: string
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
  currentUserId: string
}

export function BudgetTab({
  tripId,
  tripSlug,
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
  currentUserId,
}: BudgetTabProps) {
  const [view, setView] = React.useState<View>("budget")
  const totalCents = summary.expenseTotalCents

  return (
    <section>
      <div className="relative overflow-hidden bg-dusk-tint px-5 pt-6 pb-4">
        <TopoBg tone="sea" opacity={0.1} />
        <div className="relative">
          <Label>Budget · {tripName}</Label>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <SegBtn tone="sea" active={view === "budget"} onClick={() => setView("budget")}>
              Budget
            </SegBtn>
            <SegBtn tone="sea" active={view === "expense"} onClick={() => setView("expense")}>
              Expense
            </SegBtn>
            <SegBtn tone="sea" active={view === "saved"} onClick={() => setView("saved")}>
              Saved
            </SegBtn>
            <SegBtn tone="sea" active={view === "settle"} onClick={() => setView("settle")}>
              Settle up
            </SegBtn>
          </div>
        </div>
      </div>

      {view === "budget" ? (
        <>
          <div className="border-b border-border px-5 pt-4 pb-4">
            <SpentFigure
              tripId={tripId}
              tripSlug={tripSlug}
              spentCents={totalCents}
              plannedBudgetCents={plannedBudgetCents}
            />
          </div>
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
          />
          <div className="px-5 pt-4">
            <AiSuggestion surface="budget" />
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
          />
          <BudgetByLocation
            tripId={tripId}
            tripSlug={tripSlug}
            masterBudgetCents={plannedBudgetCents}
            locations={locations}
            expenses={expenses}
            itineraryDays={itineraryDays}
            members={members}
            moves={moves}
            categories={expenseCategories}
          />
          <LogExpenseRow
            tripId={tripId}
            tripSlug={tripSlug}
            currentUserId={currentUserId}
            members={members}
            locations={locations}
            categories={expenseCategories}
          />
          <Ledger
            expenses={expenses}
            moves={moves}
            members={members}
            tripSlug={tripSlug}
            locations={locations}
            itineraryDays={itineraryDays}
            categories={expenseCategories}
          />
        </>
      ) : null}

      {view === "expense" ? (
        <>
          <div className="border-b border-border px-5 pt-4 pb-4">
            <div className="flex items-baseline gap-1">
              <span className="t-display text-[22px] text-muted-foreground">€</span>
              <span className="t-display t-num text-[42px] leading-none text-foreground">
                {fmt(totalCents)}
              </span>
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                spent
              </span>
            </div>
          </div>
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
          />
          <LogExpenseRow
            tripId={tripId}
            tripSlug={tripSlug}
            currentUserId={currentUserId}
            members={members}
            locations={locations}
            categories={expenseCategories}
          />
          <Ledger
            expenses={expenses}
            moves={moves}
            members={members}
            tripSlug={tripSlug}
            locations={locations}
            itineraryDays={itineraryDays}
            categories={expenseCategories}
          />
        </>
      ) : null}

      {view === "saved" ? (
        <div className="px-5 pt-4 pb-4">
          <SavedFigure
            tripId={tripId}
            tripSlug={tripSlug}
            plannedBudgetCents={plannedBudgetCents}
            savedCents={savedCents}
            contributions={savingsContributions}
            perUser={savedPerUser}
            members={members}
          />
        </div>
      ) : null}

      {view === "settle" ? (
        <>
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
            alwaysShow
          />
          <SplitBreakdown
            members={members}
            paidByUser={summary.expensePaidByUser}
            settlementsByUser={summary.settlementsByUser}
          />
          <SettlementHistory expenses={expenses} members={members} />
        </>
      ) : null}
    </section>
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
}: {
  summary: BudgetSummary
  currentUserId: string
  tripId: string
  tripSlug: string
  alwaysShow?: boolean
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

  return (
    <div className="border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SettleUpButtons owedCents={owedCents} tripId={tripId} tripSlug={tripSlug} />
        <div className="text-right">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="t-num text-[18px] text-foreground">€{fmt(owedCents)}</div>
        </div>
      </div>
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
