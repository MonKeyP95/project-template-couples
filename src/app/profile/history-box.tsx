import { ShareTripDialog } from "@/components/share-trip-dialog"
import { getTripLearnedBlocks } from "@/lib/preferences/couple-summary-queries"
import type { LearnedCategory } from "@/lib/preferences/couple-summary-types"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getProfileBudgetData } from "@/lib/trips/budget-history-queries"
import { getTripJournal } from "@/lib/journal/journal-queries"
import { getTripShareState } from "@/lib/trips/shared-trip-queries"
import type { TripBuckets } from "@/lib/trips/list-queries"
import type { CurrentWorkspace } from "@/lib/workspace/queries"
import { BudgetHistory } from "./budget-history"
import { LearnedSummary } from "./learned-summary"
import { ProfileBox } from "./profile-box"
import { TripBudget } from "./trip-budget"
import { TripJournal } from "./trip-journal"

const CATEGORY_LABEL: Record<LearnedCategory, string> = {
  food: "Food",
  activity: "Activities",
  accommodation: "Accommodation",
  transport: "Transport",
}

/** Every started trip: what was learned, the journal, the spend, and sharing. */
export async function HistoryBox({
  workspace,
  buckets,
}: {
  workspace: CurrentWorkspace
  buckets: TripBuckets
}) {
  const aiOn = await isAiEnabled()
  const startedTrips = [...buckets.now, ...buckets.past]
  const pastTripIds = new Set(buckets.past.map((t) => t.id))
  const memberIds = workspace.members.map((m) => m.user_id)
  const memberNames = Object.fromEntries(
    workspace.members.map((m) => [m.user_id, m.display_name]),
  )
  const journals = await Promise.all(
    startedTrips.map(async (trip) => ({
      tripId: trip.id,
      record: await getTripJournal(trip.id, memberIds),
    })),
  )
  const journalByTrip = new Map(
    journals.filter((j) => !j.record.isEmpty).map((j) => [j.tripId, j.record]),
  )
  const tripBlocks = (
    await Promise.all(
      buckets.past.map(async (trip) => ({
        trip,
        blocks: await getTripLearnedBlocks(trip.id),
      })),
    )
  ).filter((tb) => tb.blocks.length > 0)

  const {
    history: budgetHistory,
    summaries: budgetSummaries,
    convertedTripCount,
  } = await getProfileBudgetData(startedTrips, workspace.currency)
  const tasteByTrip = new Map(tripBlocks.map((tb) => [tb.trip.id, tb.blocks]))
  const budgetByTrip = new Map(
    budgetSummaries
      .filter((s) => pastTripIds.has(s.tripId))
      .map((s) => [s.tripId, s]),
  )
  const byTripRows = await Promise.all(
    startedTrips
      .filter(
        (t) =>
          tasteByTrip.has(t.id) ||
          budgetByTrip.has(t.id) ||
          journalByTrip.has(t.id),
      )
      .map(async (t) => ({
        trip: t,
        blocks: tasteByTrip.get(t.id) ?? [],
        budget: budgetByTrip.get(t.id) ?? null,
        journal: journalByTrip.get(t.id) ?? null,
        share: await getTripShareState(t.id),
      })),
  )

  return (
    <ProfileBox title="History">
      {byTripRows.length > 0 ? (
        <div className="flex flex-col gap-8">
          {byTripRows.map(({ trip, blocks, budget, journal, share }) => (
            <div key={trip.id}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-serif text-lg tracking-tight">
                  {trip.name}
                </h3>
                <ShareTripDialog
                  tripId={trip.id}
                  tripSlug={trip.slug}
                  initialPublic={share.isPublic}
                  initialToken={share.shareToken}
                />
              </div>
              {blocks.map((b) => (
                <div key={b.category}>
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {CATEGORY_LABEL[b.category]}
                  </p>
                  <LearnedSummary
                    category={b.category}
                    summaryMd={b.summaryMd}
                    ratingCount={b.signalCount}
                    countAtGeneration={b.countAtGeneration}
                    aiOn={aiOn}
                    tripId={trip.id}
                  />
                </div>
              ))}
              {journal && !(pastTripIds.has(trip.id) && blocks.length > 0) ? (
                <TripJournal
                  record={journal}
                  memberNames={memberNames}
                  currency={trip.homeCurrency}
                />
              ) : null}
              {budget ? (
                <TripBudget summary={budget} currency={trip.homeCurrency} />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your trips show up here once they start.
        </p>
      )}

      <BudgetHistory
        categories={budgetHistory}
        currency={workspace.currency}
        convertedTripCount={convertedTripCount}
      />
    </ProfileBox>
  )
}
