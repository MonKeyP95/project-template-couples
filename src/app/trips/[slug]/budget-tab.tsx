import {
  Avatar,
  Bar,
  Chevron,
  Label,
  MonoBadge,
  type MonoBadgeTone,
  TopoBg,
} from "@/components/together"
import { settleUp } from "@/lib/trips/actions"
import type { BudgetSummary, Expense } from "@/lib/trips/expense-types"

import type { MemberToneEntry } from "./packing-tab"

const CATEGORY_TONE: Record<string, MonoBadgeTone> = {
  Surf: "sea",
  Dive: "sea",
  Trek: "moss",
  Food: "clay",
  Transit: "ink",
  Settlement: "ink",
}

const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

function ledgerDate(
  date: string | null,
): { mon: string; day: string } | null {
  if (!date) return null
  const d = new Date(`${date}T00:00:00Z`)
  return {
    mon: MONTH_SHORT.format(d).toUpperCase(),
    day: String(d.getUTCDate()),
  }
}

export interface BudgetTabProps {
  tripId: string
  tripSlug: string
  tripName: string
  expenses: Expense[]
  summary: BudgetSummary
  members: Record<string, MemberToneEntry>
  plannedBudgetCents: number
}

export function BudgetTab({
  tripId,
  tripSlug,
  tripName,
  expenses,
  summary,
  members,
  plannedBudgetCents,
}: BudgetTabProps) {
  const totalCents = summary.expenseTotalCents
  const leftCents = Math.max(0, plannedBudgetCents - totalCents)
  const pct =
    plannedBudgetCents === 0
      ? 0
      : Math.min(100, Math.round((totalCents / plannedBudgetCents) * 100))
  const isSettled = summary.netBalanceCents === 0
  const creditor = summary.creditorUserId ? members[summary.creditorUserId] : null
  const debtor = summary.debtorUserId ? members[summary.debtorUserId] : null

  return (
    <section>
      <BudgetHeader
        tripName={tripName}
        totalCents={totalCents}
        plannedBudgetCents={plannedBudgetCents}
        leftCents={leftCents}
        pct={pct}
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
      <Ledger expenses={expenses} members={members} />
      <LogExpenseCta />
    </section>
  )
}

function BudgetHeader({
  tripName,
  totalCents,
  plannedBudgetCents,
  leftCents,
  pct,
}: {
  tripName: string
  totalCents: number
  plannedBudgetCents: number
  leftCents: number
  pct: number
}) {
  return (
    <div className="relative overflow-hidden bg-dusk-tint px-5 pt-6 pb-4">
      <TopoBg tone="sea" opacity={0.1} />
      <div className="relative">
        <Label>Budget · {tripName}</Label>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="t-display text-[22px] text-muted-foreground">€</span>
          <span className="t-display t-num text-[42px] leading-none text-foreground">
            {fmt(totalCents)}
          </span>
          <span className="t-display text-[22px] text-muted-foreground">
            {" "}/ €{fmt(plannedBudgetCents)}
          </span>
        </div>
        <div className="mt-3">
          <Bar pct={pct} tone="sea" />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          <span>{pct}% of planned</span>
          <span>€{fmt(leftCents)} left</span>
        </div>
      </div>
    </div>
  )
}

function SettleUpCard({
  isSettled,
  netBalanceCents,
  creditor,
  debtor,
  tripId,
  tripSlug,
}: {
  isSettled: boolean
  netBalanceCents: number
  creditor: MemberToneEntry | null
  debtor: MemberToneEntry | null
  tripId: string
  tripSlug: string
}) {
  const canSettle = !isSettled && creditor && debtor
  return (
    <div className="px-5 py-3.5">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5">
        <div>
          <Label className="mb-1">Settle-up</Label>
          {canSettle ? (
            <div className="text-[14px] leading-snug text-foreground">
              <span className="font-serif italic">{debtor.displayName}</span>{" "}
              owes{" "}
              <span className="font-serif italic">{creditor.displayName}</span>
              <span className="t-num ml-1.5 text-foreground">
                €{fmt(Math.abs(netBalanceCents))}
              </span>
            </div>
          ) : (
            <div className="font-serif text-[14px] italic text-moss">
              All square.
            </div>
          )}
        </div>
        {canSettle ? (
          <form action={settleUp.bind(null, tripId, tripSlug)}>
            <button
              type="submit"
              className="rounded-full border-0 bg-foreground px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
            >
              settle
            </button>
          </form>
        ) : null}
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
}: {
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
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
          <LedgerRow key={e.id} expense={e} members={members} />
        ))}
      </div>
    </div>
  )
}

function LedgerRow({
  expense,
  members,
}: {
  expense: Expense
  members: Record<string, MemberToneEntry>
}) {
  const payer = members[expense.paidBy]
  const date = ledgerDate(expense.dayDate)
  const tone = CATEGORY_TONE[expense.category] ?? "ink"
  return (
    <div className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border px-5 py-3">
      <div className="text-center">
        {date ? (
          <>
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {date.mon}
            </div>
            <div className="font-mono text-[18px] leading-none tracking-[-0.02em] text-foreground">
              {date.day}
            </div>
          </>
        ) : (
          <div className="font-mono text-[11px] text-muted-foreground">—</div>
        )}
      </div>
      <div>
        <div className="text-[14px] tracking-[-0.005em] text-foreground">
          {expense.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <MonoBadge tone={tone}>{expense.category}</MonoBadge>
          <span className="font-mono text-[10px] text-muted-foreground">
            paid by
          </span>
          {payer ? (
            <Avatar name={payer.initial} size={16} tone={payer.tone} />
          ) : null}
        </div>
      </div>
      <div className="t-num text-[15px] text-foreground">
        €{fmt(expense.amountCents)}
      </div>
    </div>
  )
}

function LogExpenseCta() {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between border-0 border-t border-border bg-card px-5 py-4 text-left"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        + log expense
      </span>
      <Chevron dir="right" />
    </button>
  )
}
