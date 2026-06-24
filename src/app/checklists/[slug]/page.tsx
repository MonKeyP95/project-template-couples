import { notFound, redirect } from "next/navigation"

import { isDarkTheme } from "@/lib/theme"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import {
  getChecklistBySlug,
  getChecklistCategories,
  getChecklistItems,
} from "@/lib/checklists/queries"
import {
  LeftRail,
  MobileHeaderNav,
  buildNavDestinations,
} from "@/components/app-nav"

import { ChecklistDetail } from "./checklist-detail"

export default async function ChecklistDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect(`/signin?next=/checklists/${slug}`)

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const checklist = await getChecklistBySlug(workspace.id, slug)
  if (!checklist) notFound()

  const [items, categories, buckets] = await Promise.all([
    getChecklistItems(checklist.id),
    getChecklistCategories(checklist.id),
    listTripsForWorkspace(workspace.id),
  ])
  const dark = await isDarkTheme()
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
      <main className="w-full lg:min-w-0 lg:flex-1">
        <MobileHeaderNav
          destinations={navDestinations}
          current="checklists"
          className="px-5 pt-4"
        />
        <ChecklistDetail
          checklistId={checklist.id}
          slug={checklist.slug}
          name={checklist.name}
          initialItems={items}
          initialCategories={categories}
        />
      </main>
    </div>
  )
}
