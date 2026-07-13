import { getCoupleSummary } from "@/lib/preferences/couple-summary-queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripExpenseCategories } from "@/lib/trips/expense-queries"
import { getTripProfile } from "@/lib/trips/queries"

/** A compact "who this couple is" block for suggestion prompts. Reads the trip
 * profile + trip category detail tags (trip-scoped) and the couple's dining taste
 * + learned summaries (workspace-scoped). Every piece is omitted when empty, so a
 * bare trip yields a short string and a profile-less workspace yields "".
 * Suggest-only: reads, never writes. */
export async function buildProfileBlock(
  workspaceId: string,
  tripId?: string,
): Promise<string> {
  const parts: string[] = []

  if (tripId) {
    const profile = await getTripProfile(tripId)
    if (profile.idea.trim()) parts.push(`Trip idea: ${profile.idea.trim()}.`)
    if (profile.vibe.length) parts.push(`Trip vibe: ${profile.vibe.join(", ")}.`)
    if (profile.transport.length)
      parts.push(`Getting around: ${profile.transport.join(", ")}.`)

    const cats = await getTripExpenseCategories(tripId)
    const detailed = cats
      .filter((c) => c.details.length)
      .map((c) => `${c.name} (${c.details.join(", ")})`)
    if (detailed.length) parts.push(`Category notes: ${detailed.join("; ")}.`)
  }

  const dining = await getDiningPreferences(workspaceId)
  if (dining.budgetBand !== "any")
    parts.push(`Dining budget: ${dining.budgetBand}.`)
  if (dining.cuisines.length)
    parts.push(`Cuisines they like: ${dining.cuisines.join(", ")}.`)
  if (dining.dietary.length) parts.push(`Dietary: ${dining.dietary.join(", ")}.`)
  if (dining.activities.length)
    parts.push(`Activities they love: ${dining.activities.join(", ")}.`)

  const food = await getCoupleSummary(workspaceId, "food")
  if (food.summaryMd.trim())
    parts.push(`Learned about their food taste: ${food.summaryMd.trim()}`)
  const activity = await getCoupleSummary(workspaceId, "activity")
  if (activity.summaryMd.trim())
    parts.push(`Learned about their activity taste: ${activity.summaryMd.trim()}`)

  return parts.join(" ")
}
