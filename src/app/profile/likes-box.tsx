import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CategorySection } from "@/components/category-section"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { BUDGET_BANDS } from "@/lib/preferences/dining-types"
import {
  saveActivities,
  saveFoodPreferences,
} from "@/lib/preferences/dining-actions"
import {
  getCoupleSummary,
  countSignals,
} from "@/lib/preferences/couple-summary-queries"
import { signalFloor } from "@/lib/preferences/couple-summary-types"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { LearnedSummary } from "./learned-summary"
import { ProfileBox } from "./profile-box"

/** What the couple likes, per category: what they typed plus what was learned. */
export async function LikesBox({ workspaceId }: { workspaceId: string }) {
  const dining = await getDiningPreferences(workspaceId)
  const aiOn = await isAiEnabled()
  const foodSummary = await getCoupleSummary(workspaceId, "food")
  const foodRatings = await countSignals(workspaceId, "food")
  const activitySummary = await getCoupleSummary(workspaceId, "activity")
  const activityRatings = await countSignals(workspaceId, "activity")
  const accommodationSummary = await getCoupleSummary(workspaceId, "accommodation")
  const accommodationSignals = await countSignals(workspaceId, "accommodation")
  const transportSummary = await getCoupleSummary(workspaceId, "transport")
  const transportSignals = await countSignals(workspaceId, "transport")

  const foodKey = [
    dining.budgetBand,
    dining.vibeTags.join(","),
    dining.dietary.join(","),
    dining.cuisines.join(","),
  ].join("|")

  return (
    <ProfileBox title="What we like">
      <p className="text-xs text-muted-foreground">
        The AI uses this to suggest places.
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
    </ProfileBox>
  )
}
