export interface BudgetItem {
  id: string
  category: string
  subject: string
  whenLabel: string
  amountCents: number
  locationId: string | null
  sortOrder: number
}

export interface BudgetItemRow {
  id: string
  category: string
  subject: string
  when_label: string
  amount_cents: number
  location_id: string | null
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
    sortOrder: row.sort_order,
  }
}
