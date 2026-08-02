import Link from "next/link"
import { redirect } from "next/navigation"

import { Label } from "@/components/together"
import { createClient } from "@/lib/supabase/server"

import { NewWorkspaceForm } from "./new-workspace-form"

export default async function NewWorkspacePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/workspaces/new")

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] px-5 pt-10 pb-20">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>‹</span>
        <span>home</span>
      </Link>
      <Label className="mt-6">Together · New workspace</Label>
      <hr className="mt-3 border-rule" />
      <NewWorkspaceForm />
    </main>
  )
}
