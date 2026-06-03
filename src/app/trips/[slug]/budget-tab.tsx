import { Avatar, Label, TopoBg } from "@/components/together"
import { type BudgetSummary, type Expense } from "@/lib/trips/expense-types"

import { BudgetFigures } from "./budget-figures"
import { LedgerRow } from "./ledger-row"
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
  summary: BudgetSummary
  members: Record<string, MemberToneEntry>
  plannedBudgetCents: number
  savedCents: number
  currentUserId: string
}

export function BudgetTab({
  tripId,
  tripSlug,
  tripName,
  expenses,
  summary,
  members,
  plannedBudgetCents,
  savedCents,
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
      <LogExpenseRow
        tripId={tripId}
        tripSlug={tripSlug}
        currentUserId={currentUserId}
        members={members}
      />
      <Ledger expenses={expenses} members={members} tripSlug={tripSlug} />
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
}: {
  tripId: string
  tripSlug: string
  tripName: string
  spentCents: number
  plannedBudgetCents: number
  savedCents: number
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

function Ledger({
  expenses,
  members,
  tripSlug,
}: {
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
}) {
  return (
    <div className="border-t border-border bg-background">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-1.5">
        <Label>Ledger · {expenses.length}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          most recent
        </span>
      </div>
      <div>
        {expenses.map((e) => (
          <LedgerRow
            key={e.id}
            expense={e}
            members={members}
            tripSlug={tripSlug}
          />
        ))}
      </div>
    </div>
  )
}

