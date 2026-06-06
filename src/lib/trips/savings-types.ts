export interface SavingsContribution {
  id: string
  tripId: string
  userId: string
  amountCents: number
  createdAt: string
}

export interface SavingsSummary {
  /** Sum of all contribution amounts, in cents. */
  totalCents: number
  /** Per-user sum of contribution amounts, in cents. */
  perUser: Record<string, number>
}

/**
 * Pure: total saved plus a per-member breakdown. `memberIds` seeds the
 * breakdown so every member appears (even at 0); contributions from users
 * not in the list still count toward the total.
 */
export function summarizeSavings(
  contributions: SavingsContribution[],
  memberIds: string[],
): SavingsSummary {
  const perUser: Record<string, number> = Object.fromEntries(
    memberIds.map((id) => [id, 0]),
  )
  let totalCents = 0
  for (const c of contributions) {
    totalCents += c.amountCents
    perUser[c.userId] = (perUser[c.userId] ?? 0) + c.amountCents
  }
  return { totalCents, perUser }
}
