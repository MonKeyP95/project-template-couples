import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Label } from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

import { NewTripForm } from "./new-trip-form"

export default async function NewTripPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/trips/new")

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] bg-background px-5 pt-10 pb-20">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>‹</span>
        <span>home</span>
      </Link>
      <Label className="mt-6">Together · New trip</Label>
      <hr className="mt-3 border-rule" />
      <NewTripForm />
    </main>
  )
}
