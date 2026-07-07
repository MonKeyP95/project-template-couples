import { redirect } from "next/navigation"

import { updateProfile } from "@/lib/auth/actions"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AiToggle } from "@/components/ai-mode"
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
import { saveDiningPreferences } from "@/lib/preferences/dining-actions"

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
  const buckets = await listTripsForWorkspace(workspace.id)
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const navDestinations = buildNavDestinations({
    onTheRoad: buckets.now.length > 0,
    tripSlug: hero?.slug ?? null,
  })

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

          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <span className="text-sm text-muted-foreground">
              AI assistant (off by default)
            </span>
            <AiToggle />
          </div>

          <form
            key={[
              dining.budgetBand,
              dining.vibeTags.join(","),
              dining.dietary.join(","),
              dining.cuisines.join(","),
              dining.activities.join(","),
            ].join("|")}
            action={saveDiningPreferences}
            className="mt-4 border-t border-border pt-6"
          >
            <p className="text-sm text-muted-foreground">
              What we like (used by the AI to suggest places)
            </p>
            <label className="mt-4 block text-xs text-muted-foreground">
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
            <Input
              name="activities"
              placeholder="Activities you love (e.g. surf, hike, museums)"
              defaultValue={dining.activities.join(", ")}
              className="mt-3"
            />
            <Button type="submit" variant="outline" size="sm" className="mt-4">
              Save preferences
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
