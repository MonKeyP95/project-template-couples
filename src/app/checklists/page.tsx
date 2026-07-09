import { redirect } from "next/navigation"

import { Label } from "@/components/together"
import { isDarkTheme } from "@/lib/theme"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { listChecklists } from "@/lib/checklists/queries"
import {
  LeftRail,
  MobileHeaderNav,
  buildNavDestinations,
} from "@/components/app-nav"

import { AssistantBlock } from "@/components/assistant-block"

import { ChecklistsOverview } from "./checklists-overview"

export default async function ChecklistsPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/checklists")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const dark = await isDarkTheme()
  const [checklists, buckets] = await Promise.all([
    listChecklists(workspace.id),
    listTripsForWorkspace(workspace.id),
  ])
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
        current="checklists"
      />
      <main className="w-full px-5 pt-14 pb-16 lg:min-w-0 lg:flex-1 lg:px-12 lg:pt-12">
        <MobileHeaderNav
          destinations={navDestinations}
          current="checklists"
          className="mb-4"
        />
        <Label className="mb-4 block">Checklists</Label>
        <AssistantBlock surface="checklists" className="mb-4 block" />
        <ChecklistsOverview initial={checklists} />
      </main>
    </div>
  )
}
