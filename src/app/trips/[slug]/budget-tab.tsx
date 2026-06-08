import { Avatar, Label, TopoBg } from "@/components/together"
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

import { BudgetByLocation } from "./budget-by-location"
import { BudgetFigures } from "./budget-figures"
import { Ledger } from "./budget-ledger"
import { LogExpenseRow } from "./log-expense-row"
import type { MemberToneEntry } from "./packing-tab"
import { SettleUpCard } from "./settle-up-card"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

export interface BudgetTabProps {
  tripId: string
  tripSlug: string
  tripName: string
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
  const totalCents = summary.expenseTotalCents
  const isSettled = summary.netBalanceCents === 0
  const creditor = summary.creditorUserId ? members[summary.creditorUserId] : null
  const debtor = summary.debtorUserId ? members[summary.debtorUserId] : null

  return (
    <section>
      <BudgetHeader
        tripId={tripId}
        tripSlug={tripSlug}
        tripName={tripName}
        spentCents={totalCents}
        plannedBudgetCents={plannedBudgetCents}
        savedCents={savedCents}
        savingsContributions={savingsContributions}
        savedPerUser={savedPerUser}
        members={members}
      />
      <LogExpenseRow
        tripId={tripId}
        tripSlug={tripSlug}
        currentUserId={currentUserId}
        members={members}
        locations={locations}
        categories={expenseCategories}
      />
      <SettleUpCard
        isSettled={isSettled}
        netBalanceCents={summary.netBalanceCents}
        creditor={creditor}
        debtor={debtor}
        tripId={tripId}
        tripSlug={tripSlug}
      />
      <SplitBreakdown members={members} paidByUser={summary.expensePaidByUser} />
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
      <Ledger
        expenses={expenses}
        moves={moves}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
        itineraryDays={itineraryDays}
        categories={expenseCategories}
      />
    </section>
  )
}

function BudgetHeader({
  tripId,
  tripSlug,
  tripName,
  spentCents,
  plannedBudgetCents,
  savedCents,
  savingsContributions,
  savedPerUser,
  members,
}: {
  tripId: string
  tripSlug: string
  tripName: string
  spentCents: number
  plannedBudgetCents: number
  savedCents: number
  savingsContributions: SavingsContribution[]
  savedPerUser: Record<string, number>
  members: Record<string, MemberToneEntry>
}) {
  return (
    <div className="relative overflow-hidden bg-dusk-tint px-5 pt-6 pb-4">
      <TopoBg tone="sea" opacity={0.1} />
      <div className="relative">
        <Label>Budget · {tripName}</Label>
        <BudgetFigures
          tripId={tripId}
          tripSlug={tripSlug}
          spentCents={spentCents}
          plannedBudgetCents={plannedBudgetCents}
          savedCents={savedCents}
          contributions={savingsContributions}
          perUser={savedPerUser}
          members={members}
        />
      </div>
    </div>
  )
}

function SplitBreakdown({
  members,
  paidByUser,
}: {
  members: Record<string, MemberToneEntry>
  paidByUser: Record<string, number>
}) {
  const entries = Object.entries(members)
  if (entries.length !== 2) return null
  return (
    <div className="px-5 pb-3">
      <div className="grid grid-cols-2 gap-2.5">
        {entries.map(([userId, member]) => (
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
          </div>
        ))}
      </div>
    </div>
  )
}


