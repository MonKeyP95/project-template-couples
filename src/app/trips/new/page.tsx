import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Label } from "@/components/together"
import { MobileHeaderNav, buildNavDestinations } from "@/components/app-nav"
import { createClient } from "@/lib/supabase/server"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import type { IdeaPlan } from "@/lib/trips/idea-route"

import { NewTripForm } from "./new-trip-form"

export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; idea?: string }>
}) {
  const { note = "", idea } = await searchParams
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/trips/new")

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  const buckets = await listTripsForWorkspace(workspace.id)
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const navDestinations = buildNavDestinations({
    onTheRoad: buckets.now.length > 0,
    tripSlug: hero?.slug ?? null,
  })

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] px-5 pt-10 pb-28">
      <MobileHeaderNav destinations={navDestinations} current="home" />
      <Link
        href="/home"
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>‹</span>
        <span>home</span>
      </Link>
      <Label className="mt-6">Together · New trip</Label>
      <hr className="mt-3 border-rule" />
      <NewTripForm
        currency={workspace.currency}
        initialNote={note}
        initialPlan={readPlan(idea)}
      />
    </main>
  )
}

/** The accepted home idea's plan from the URL; null when absent or not a plan. */
function readPlan(raw: string | undefined): IdeaPlan | null {
  if (!raw) return null
  try {
    const plan = JSON.parse(raw)
    return plan && Array.isArray(plan.stops) ? plan : null
  } catch {
    return null
  }
}
