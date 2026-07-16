export interface BudgetItem {
  id: string
  category: string
  subject: string
  whenLabel: string
  amountCents: number
  locationId: string | null
  whenStart: string | null
  whenEnd: string | null
  sortOrder: number
  /** Expense logged when this cost was marked paid; null while unpaid. */
  paidExpenseId: string | null
  /** The assistant supplied this amount (an estimate, not the couple's figure). */
  estimated: boolean
  /** A real web-search result backing the amount; null when none. */
  sourceUrl: string | null
  /** The assistant couldn't price this; amountCents stays 0, shown as "no reliable price". */
  priceUnknown: boolean
  /** How the amount multiplies: "once" | "times" | "daily". */
  freq: string
  /** The multiplier for "times"; 1 otherwise. */
  count: number
}

export interface BudgetItemRow {
  id: string
  category: string
  subject: string
  when_label: string
  amount_cents: number
  location_id: string | null
  when_start: string | null
  when_end: string | null
  sort_order: number
  paid_expense_id: string | null
  estimated: boolean
  source_url: string | null
  price_unknown: boolean
  freq: string
  count: number
}

export function rowToBudgetItem(row: BudgetItemRow): BudgetItem {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    whenLabel: row.when_label,
    amountCents: row.amount_cents,
    locationId: row.location_id,
    whenStart: row.when_start,
    whenEnd: row.when_end,
    sortOrder: row.sort_order,
    paidExpenseId: row.paid_expense_id,
    estimated: row.estimated,
    sourceUrl: row.source_url,
    priceUnknown: row.price_unknown,
    freq: row.freq,
    count: row.count,
  }
}
