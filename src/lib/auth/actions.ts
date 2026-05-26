"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

export async function signUp(formData: FormData) {
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
