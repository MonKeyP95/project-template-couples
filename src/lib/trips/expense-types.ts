export interface Expense {
  id: string
  tripId: string
  title: string
  amountCents: number
  currency: string
  paidBy: string
  category: string
  dayDate: string | null
  locationId: string | null
  isSettlement: boolean
  createdAt: string
}

export interface BudgetSummary {
  /** Sum of non-settlement amounts. */
  expenseTotalCents: number
  /** Per-user sum of non-settlement amounts. */
  expensePaidByUser: Record<string, number>
  /** Per-user sum of settlement amounts (cash transferred to the other member). */
  settlementsByUser: Record<string, number>
  /**
   * For two-member trips: positive = `debtorUserId` owes `creditorUserId`.
   * Zero when settled. Always 0 for trips with !=2 members.
   */
  netBalanceCents: number
  creditorUserId: string | null
  debtorUserId: string | null
}

/**
 * Two-member balance: each member owes half the total expense pool. Settlements
 * by the debtor reduce their debt; settlements by the creditor would deepen it
 * (so we still net them in correctly).
 */
export function summarizeBudget(
  expenses: Expense[],
  memberIds: string[],
): BudgetSummary {
  const expensePaidByUser: Record<string, number> = Object.fromEntries(
    memberIds.map((id) => [id, 0]),
  )
  const settlementsByUser: Record<string, number> = Object.fromEntries(
    memberIds.map((id) => [id, 0]),
  )

  let expenseTotalCents = 0
  for (const e of expenses) {
    if (e.isSettlement) {
      settlementsByUser[e.paidBy] = (settlementsByUser[e.paidBy] ?? 0) + e.amountCents
    } else {
      expenseTotalCents += e.amountCents
      expensePaidByUser[e.paidBy] = (expensePaidByUser[e.paidBy] ?? 0) + e.amountCents
    }
  }

  if (memberIds.length !== 2) {
    return {
      expenseTotalCents,
      expensePaidByUser,
      settlementsByUser,
      netBalanceCents: 0,
      creditorUserId: null,
      debtorUserId: null,
    }
  }

  const [a, b] = memberIds
  const aPaid = expensePaidByUser[a] ?? 0
  const bPaid = expensePaidByUser[b] ?? 0
  const aTransfers = settlementsByUser[a] ?? 0
  const bTransfers = settlementsByUser[b] ?? 0
  // gross = (aPaid - bPaid) / 2: how much b owes a from the trip alone.
  // Add a's settlements (a paid b) and subtract b's settlements (b paid a).
  const gross = (aPaid - bPaid) / 2
  const net = Math.round(gross + aTransfers - bTransfers)

  return {
    expenseTotalCents,
    expensePaidByUser,
    settlementsByUser,
    netBalanceCents: net,
    creditorUserId: net > 0 ? a : net < 0 ? b : null,
    debtorUserId: net > 0 ? b : net < 0 ? a : null,
  }
}

/** A per-trip expense category row (see expense_categories). */
export interface ExpenseCategoryRow {
  id: string
  tripId: string
  name: string
  sortOrder: number
  details: string[]
}

/** Default set seeded into every new trip. Kept minimal; users add the rest. */
export const EXPENSE_CATEGORIES = [
  "Food",
  "Groceries",
  "Transportation",
  "Accommodation",
  "Activities",
  "Other",
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CATEGORY_DEFAULT: ExpenseCategory = "Food"
