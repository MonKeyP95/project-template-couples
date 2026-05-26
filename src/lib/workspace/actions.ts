"use server"

import { randomBytes } from "node:crypto"

import { createClient } from "@/lib/supabase/server"

export interface InviteResult {
  url?: string
  error?: string
}

export async function generateInvite(): Promise<InviteResult> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: "Not signed in" }

  // Find the user's workspace (MVP: one per user).
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) return { error: "No workspace" }
  if (membership.role !== "owner") return { error: "Only the workspace owner can invite" }

  // Reuse an existing unused, unexpired invite if one exists.
  const { data: existing } = await supabase
    .from("invites")
    .select("token")
    .eq("workspace_id", membership.workspace_id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle()

  const token = existing?.token ?? randomBytes(24).toString("base64url")

  if (!existing) {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const { error: insertError } = await supabase.from("invites").insert({
      workspace_id: membership.workspace_id,
      token,
      expires_at: expiresAt,
      created_by: userData.user.id,
    })
    if (insertError) return { error: insertError.message }
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  return { url: `${origin}/join/${token}` }
}

export async function acceptInvite(token: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("accept_invite", { p_token: token })
  if (error) return { error: error.message }
  return {}
}
