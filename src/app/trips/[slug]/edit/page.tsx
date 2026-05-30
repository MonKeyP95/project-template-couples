import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Label } from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { getTripBySlug } from "@/lib/trips/queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

import { EditTripForm } from "./edit-trip-form"

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect(`/signin?next=/trips/${slug}/edit`)

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  const trip = await getTripBySlug(workspace.id, slug)
  if (!trip) notFound()

  const { count } = await supabase
    .from("dream_itinerary_days")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", trip.id)
  const dreamDayCount = count ?? 0

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] bg-background px-5 pt-10 pb-20">
      <Link
        href={`/trips/${slug}`}
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>‹</span>
        <span>back to trip</span>
      </Link>
      <Label className="mt-6">Together · Edit trip</Label>
      <hr className="mt-3 border-rule" />
      <EditTripForm
        tripId={trip.id}
        dreamDayCount={dreamDayCount}
        initial={{
          name: trip.name,
          slug: trip.slug,
          isDream: trip.startDate === null,
          startDate: trip.startDate,
          endDate: trip.endDate,
          fuzzyWhen: trip.fuzzyWhen,
          country: trip.country,
          lat: trip.lat,
          lng: trip.lng,
        }}
      />
    </main>
  )
}
