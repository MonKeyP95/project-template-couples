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
  }
}
