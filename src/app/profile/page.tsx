import { redirect } from "next/navigation"

import { updateProfile } from "@/lib/auth/actions"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  LeftRail,
  MobileHeaderNav,
  buildNavDestinations,
} from "@/components/app-nav"
import { isDarkTheme } from "@/lib/theme"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { BUDGET_BANDS } from "@/lib/preferences/dining-types"
import {
  saveActivities,
  saveFoodPreferences,
} from "@/lib/preferences/dining-actions"
import {
  getCoupleSummary,
  countSignals,
  getTripLearnedBlocks,
} from "@/lib/preferences/couple-summary-queries"
import { signalFloor, type LearnedCategory } from "@/lib/preferences/couple-summary-types"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { LearnedSummary } from "./learned-summary"
import { CategorySection } from "@/components/category-section"
import { getProfileBudgetData } from "@/lib/trips/budget-history-queries"
import { BudgetHistory } from "./budget-history"
import { TripBudget } from "./trip-budget"
import { getTripJournal } from "@/lib/journal/journal-queries"
import { TripJournal } from "./trip-journal"

const CATEGORY_LABEL: Record<LearnedCategory, string> = {
  food: "Food",
  activity: "Activities",
  accommodation: "Accommodation",
  transport: "Transport",
}

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/profile")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, created_at")
    .eq("id", userData.user.id)
    .single()

  const dark = await isDarkTheme()
  const dining = await getDiningPreferences(workspace.id)
  const aiOn = await isAiEnabled()
  const foodSummary = await getCoupleSummary(workspace.id, "food")
  const foodRatings = await countSignals(workspace.id, "food")
  const activitySummary = await getCoupleSummary(workspace.id, "activity")
  const activityRatings = await countSignals(workspace.id, "activity")
  const accommodationSummary = await getCoupleSummary(workspace.id, "accommodation")
  const accommodationSignals = await countSignals(workspace.id, "accommodation")
  const transportSummary = await getCoupleSummary(workspace.id, "transport")
  const transportSignals = await countSignals(workspace.id, "transport")
  const buckets = await listTripsForWorkspace(workspace.id)
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const navDestinations = buildNavDestinations({
    onTheRoad: buckets.now.length > 0,
    tripSlug: hero?.slug ?? null,
  })

  const startedTrips = [...buckets.now, ...buckets.past]
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
      startedTrips.map(async (trip) => ({
        trip,
        blocks: await getTripLearnedBlocks(trip.id),
      })),
    )
  ).filter((tb) => tb.blocks.length > 0)

  const { history: budgetHistory, summaries: budgetSummaries } =
    await getProfileBudgetData(startedTrips)
  const tasteByTrip = new Map(tripBlocks.map((tb) => [tb.trip.id, tb.blocks]))
  const budgetByTrip = new Map(budgetSummaries.map((s) => [s.tripId, s]))
  const byTripRows = startedTrips
    .filter(
      (t) =>
        tasteByTrip.has(t.id) ||
        budgetByTrip.has(t.id) ||
        journalByTrip.has(t.id),
    )
    .map((t) => ({
      trip: t,
      blocks: tasteByTrip.get(t.id) ?? [],
      budget: budgetByTrip.get(t.id) ?? null,
      journal: journalByTrip.get(t.id) ?? null,
    }))

  const foodKey = [
    dining.budgetBand,
    dining.vibeTags.join(","),
    dining.dietary.join(","),
    dining.cuisines.join(","),
  ].join("|")

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-[440px] lg:flex lg:max-w-none lg:items-stretch">
      <LeftRail
        workspace={workspace}
        initialDark={dark}
        destinations={navDestinations}
        current="profile"
      />
      <main className="w-full px-5 pt-14 pb-16 lg:min-w-0 lg:flex-1 lg:px-12 lg:pt-12">
        <MobileHeaderNav
          destinations={navDestinations}
          current="profile"
          className="mb-4"
        />
        <div className="mx-auto w-full max-w-sm">
          <h1 className="font-serif text-4xl tracking-tight">Couple profile</h1>

          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <form action={updateProfile as any} className="mt-8 flex flex-col gap-3">
            <Input
              name="display_name"
              placeholder="Display name"
              defaultValue={profile?.display_name}
              required
            />
            <Button type="submit" size="lg" className="mt-2">
              Save
            </Button>
          </form>

          <dl className="mt-10 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{userData.user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Member since</dt>
              <dd>
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString("en-GB")
                  : "—"}
              </dd>
            </div>
          </dl>

          <p className="mt-8 border-t border-border pt-8 text-sm text-muted-foreground">
            What we like (used by the AI to suggest places)
          </p>
          <div className="mt-4 flex flex-col gap-5">
            <CategorySection title="Food" defaultOpen>
              <form key={foodKey} action={saveFoodPreferences}>
                <label className="block text-xs text-muted-foreground">
                  Budget
                  <select
                    name="budget_band"
                    defaultValue={dining.budgetBand}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                  >
                    {BUDGET_BANDS.map((band) => (
                      <option key={band} value={band}>
                        {band}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  name="vibe_tags"
                  placeholder="Vibe (e.g. quiet, walkable, lively)"
                  defaultValue={dining.vibeTags.join(", ")}
                  className="mt-3"
                />
                <Input
                  name="dietary"
                  placeholder="Dietary (e.g. vegetarian, gluten-free)"
                  defaultValue={dining.dietary.join(", ")}
                  className="mt-3"
                />
                <Input
                  name="cuisines"
                  placeholder="Cuisines you love (e.g. seafood, Thai)"
                  defaultValue={dining.cuisines.join(", ")}
                  className="mt-3"
                />
                <Button type="submit" variant="outline" size="sm" className="mt-4">
                  Save food
                </Button>
              </form>
              {foodRatings >= signalFloor("food") ? (
                <LearnedSummary
                  category="food"
                  summaryMd={foodSummary.summaryMd}
                  ratingCount={foodRatings}
                  countAtGeneration={foodSummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : null}
            </CategorySection>

            <CategorySection title="Activities">
              <form key={dining.activities.join(",")} action={saveActivities}>
                <Input
                  name="activities"
                  placeholder="Activities you love (e.g. surf, hike, museums)"
                  defaultValue={dining.activities.join(", ")}
                />
                <Button type="submit" variant="outline" size="sm" className="mt-4">
                  Save activities
                </Button>
              </form>
              {activityRatings >= signalFloor("activity") ? (
                <LearnedSummary
                  category="activity"
                  summaryMd={activitySummary.summaryMd}
                  ratingCount={activityRatings}
                  countAtGeneration={activitySummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : null}
            </CategorySection>

            <CategorySection
              title="Accommodation"
              hint={accommodationSignals >= signalFloor("accommodation") ? undefined : "empty"}
            >
              {accommodationSignals >= signalFloor("accommodation") ? (
                <LearnedSummary
                  category="accommodation"
                  summaryMd={accommodationSummary.summaryMd}
                  ratingCount={accommodationSignals}
                  countAtGeneration={accommodationSummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing here yet — this grows from what you book to stay in on
                  your trips.
                </p>
              )}
            </CategorySection>

            <CategorySection
              title="Transport"
              hint={transportSignals >= signalFloor("transport") ? undefined : "empty"}
            >
              {transportSignals >= signalFloor("transport") ? (
                <LearnedSummary
                  category="transport"
                  summaryMd={transportSummary.summaryMd}
                  ratingCount={transportSignals}
                  countAtGeneration={transportSummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing here yet — this grows from how you get around on your
                  trips.
                </p>
              )}
            </CategorySection>
          </div>

          {byTripRows.length > 0 ? (
            <div className="mt-10 border-t border-border pt-8">
              <p className="text-sm text-muted-foreground">By trip</p>
              <div className="mt-4 flex flex-col gap-8">
                {byTripRows.map(({ trip, blocks, budget, journal }) => (
                  <div key={trip.id}>
                    <h3 className="font-serif text-lg tracking-tight">
                      {trip.name}
                    </h3>
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
                    {journal ? (
                      <TripJournal record={journal} memberNames={memberNames} />
                    ) : null}
                    {budget ? <TripBudget summary={budget} /> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <BudgetHistory categories={budgetHistory} />
        </div>
      </main>
    </div>
  )
}
