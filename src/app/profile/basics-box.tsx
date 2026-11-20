import Link from "next/link"

import { updateProfile } from "@/lib/auth/actions"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { setWorkspaceHome } from "@/lib/workspace/actions"
import { currencyOptions } from "@/lib/fx/currency-list"
import type { CurrentWorkspace } from "@/lib/workspace/queries"
import { ProfileBox } from "./profile-box"

/** The plain facts: your name and account, and the couple's home country and
 * currency. */
export async function BasicsBox({ workspace }: { workspace: CurrentWorkspace }) {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, created_at")
    .eq("id", userData.user!.id)
    .single()

  return (
    <ProfileBox title="Basics">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <form action={updateProfile as any} className="flex flex-col gap-3">
        <Input
          name="display_name"
          aria-label="Display name"
          placeholder="Display name"
          defaultValue={profile?.display_name}
          required
        />
        <Button type="submit" size="lg" className="mt-1">
          Save
        </Button>
      </form>

      <dl className="mt-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{userData.user!.email}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Member since</dt>
          <dd>
            {profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString("en-GB")
              : "—"}
          </dd>
        </div>
        <div className="flex justify-between lg:hidden">
          <dt className="text-muted-foreground">Help</dt>
          <dd>
            <Link href="/manual" className="underline underline-offset-4">
              Manual
            </Link>
          </dd>
        </div>
      </dl>

      <form
        key={`${workspace.homeCountry}|${workspace.currency}`}
        action={setWorkspaceHome}
        className="mt-6 border-t border-border pt-5"
      >
        <label className="block text-xs text-muted-foreground">
          Home country
          <Input
            name="home_country"
            defaultValue={workspace.homeCountry}
            maxLength={60}
            placeholder="e.g. Denmark"
            className="mt-1"
          />
        </label>
        <label className="mt-4 block text-xs text-muted-foreground">
          Home currency
          <select
            name="currency"
            defaultValue={workspace.currency}
            className="mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          >
            {currencyOptions().map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          New trips start in this currency. Trips you have already recorded
          keep theirs.
        </p>
        <Button type="submit" size="lg" className="mt-3">
          Save home
        </Button>
      </form>
    </ProfileBox>
  )
}
