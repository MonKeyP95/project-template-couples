"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"

/**
 * Where to land after a plain sign-in: the on-the-road page when a trip is
 * active right now, else home. Mirrors the /on-the-road guard so we never
 * send the user to a page that would just bounce them back to /home.
 */
async function defaultLanding(): Promise<string> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return "/home"
  const buckets = await listTripsForWorkspace(workspace.id)
  return buckets.now.length > 0 ? "/on-the-road" : "/home"
}

export async function signUp(
  _prevState: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const displayName = String(formData.get("display_name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const inviteToken = String(formData.get("invite_token") ?? "") || null

  if (!displayName || !email || !password) {
    return { error: "All fields are required." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      },
    },
  })

  if (error) return { error: error.message }

  redirect("/home")
}

export async function signIn(
  _prevState: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const next = String(formData.get("next") ?? "/home")

  if (!email || !password) {
    return { error: "Email and password are required." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: error.message }

  // Constrain redirect to relative paths to prevent open-redirect via ?next=.
  // `//evil.com` is a protocol-relative URL — must reject paths starting with //.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/home"
  // A plain sign-in (no explicit destination) lands on the active trip's
  // on-the-road page when one is running; an explicit ?next= is respected.
  const dest = safeNext === "/home" ? await defaultLanding() : safeNext
  redirect(dest)
}

export async function updateProfile(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim()
  if (!displayName) return { error: "Display name is required." }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: "Not signed in" }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userData.user.id)

  if (error) return { error: error.message }
  redirect("/home")
}
