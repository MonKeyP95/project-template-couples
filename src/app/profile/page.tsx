import Link from "next/link"
import { redirect } from "next/navigation"

import { updateProfile } from "@/lib/auth/actions"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"
import { AiToggle } from "@/components/ai-mode"
import { isDarkTheme } from "@/lib/theme"

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/profile")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, created_at")
    .eq("id", userData.user.id)
    .single()

  const dark = await isDarkTheme()

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl tracking-tight">Your profile</h1>

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
          <span className="text-sm text-muted-foreground">Appearance</span>
          <ThemeToggle initialDark={dark} />
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-6">
          <span className="text-sm text-muted-foreground">
            AI assistant (off by default)
          </span>
          <AiToggle />
        </div>

        <Link
          href="/home"
          className="mt-10 inline-block font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
