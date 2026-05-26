import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { InitialsAvatar } from "@/components/initials-avatar"
import { InviteCard } from "@/components/invite-card"

export default async function HomePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/home")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userData.user.id)
    .single()

  const workspace = await getCurrentWorkspace()
  const youOnly = workspace?.members.length === 1

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10 sm:py-10">
      <header className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/80">
          Together
        </span>
        <form action="/api/signout" method="post">
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-16 sm:mt-20">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Hello,{" "}
          <span className="italic text-primary">
            {profile?.display_name ?? "friend"}
          </span>
          .
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{workspace?.name}</p>

        {workspace ? (
          <div className="mt-8 flex items-center gap-3">
            {workspace.members.map((m) => (
              <InitialsAvatar key={m.user_id} name={m.display_name} size="md" />
            ))}
            <span className="text-sm text-muted-foreground">
              {workspace.members.map((m) => m.display_name).join(" · ")}
            </span>
          </div>
        ) : null}

        {youOnly ? (
          <div className="mt-10">
            <InviteCard />
          </div>
        ) : null}

        <div className="mt-16 max-w-md">
          <p className="text-sm text-muted-foreground">
            Your trips will live here. Phase 3 brings the trip-creation flow.
          </p>
        </div>
      </section>
    </main>
  )
}
