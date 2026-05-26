"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

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
  redirect(safeNext)
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
