import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import {
  LeftRail,
  MobileHeaderNav,
  buildNavDestinations,
} from "@/components/app-nav"
import { isDarkTheme } from "@/lib/theme"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { AboutBox } from "./about-box"
import { LikesBox } from "./likes-box"
import { HistoryBox } from "./history-box"
import { BasicsBox } from "./basics-box"

/** The couple profile: four boxes. One column on the phone; on desktop About,
 * Likes and Basics stack on the left and History has the right column. */
export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/profile")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const dark = await isDarkTheme()
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
      <main className="w-full px-5 pt-14 pb-28 lg:min-w-0 lg:flex-1 lg:px-12 lg:pt-12 lg:pb-16">
        <MobileHeaderNav
          destinations={navDestinations}
          current="profile"
          className="mb-4"
        />
        <div className="mx-auto w-full max-w-sm lg:max-w-5xl">
          <h1 className="font-serif text-4xl tracking-tight">Couple profile</h1>

          <div className="mt-8 grid gap-5 lg:grid-cols-2 lg:items-start">
            <div className="flex flex-col gap-5">
              <AboutBox workspace={workspace} />
              <LikesBox workspaceId={workspace.id} />
              <BasicsBox workspace={workspace} />
            </div>
            <div className="flex flex-col gap-5">
              <HistoryBox workspace={workspace} buckets={buckets} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
