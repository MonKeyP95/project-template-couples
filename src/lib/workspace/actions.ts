"use server"

import { randomBytes } from "node:crypto"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { currencyOptions } from "@/lib/fx/currency-list"
import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
  resolveActiveMembership,
} from "@/lib/workspace/active"

/** Invite links leave this machine, so they always point at the deployed app —
 * never at whatever origin generated them. Local dev and prod share one Supabase
 * project, so a token minted locally is valid there. */
const PUBLIC_SITE_URL = "https://project-template-couples.vercel.app"

export interface InviteResult {
  url?: string
  error?: string
}

/** Server Actions can set cookies, unlike Server Components, so creating or
 * joining a workspace drops you straight into it. */
async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const store = await cookies()
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
    sameSite: "lax",
  })
}

/** Creates a workspace, makes the caller its owner, and switches to it.
 * Wired straight to `<form action={...}>`, so it throws rather than returning
 * an error shape. */
export async function createWorkspace(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) throw new Error("Name required")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: name,
  })
  if (error) throw new Error(error.message)

  await setActiveWorkspace(data as string)
  redirect("/home")
}

export async function generateInvite(): Promise<InviteResult> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: "Not signed in" }

  const membership = await resolveActiveMembership()
  if (!membership) return { error: "No workspace" }
  if (membership.role !== "owner") {
    return { error: "Only the workspace owner can invite" }
  }

  // Reuse an existing unused, unexpired invite if one exists.
  const { data: existing } = await supabase
    .from("invites")
    .select("token")
    .eq("workspace_id", membership.workspaceId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle()

  const token = existing?.token ?? randomBytes(24).toString("base64url")

  if (!existing) {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const { error: insertError } = await supabase.from("invites").insert({
      workspace_id: membership.workspaceId,
      token,
      expires_at: expiresAt,
      created_by: userData.user.id,
    })
    if (insertError) return { error: insertError.message }
  }

  return { url: `${PUBLIC_SITE_URL}/join/${token}` }
}

/**
 * Sets the workspace's home currency. Existing trips keep the currency they
 * were created with -- only the next trip inherits this.
 *
 * Wired straight to `<form action={...}>`, so it throws rather than returning
 * an error shape.
 */
export async function setWorkspaceCurrency(formData: FormData): Promise<void> {
  const currency = String(formData.get("currency") ?? "")
  if (!currencyOptions().some((o) => o.code === currency)) {
    throw new Error("Unknown currency")
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) throw new Error("Not signed in")

  const membership = await resolveActiveMembership()
  if (!membership) throw new Error("No workspace")

  const { error } = await supabase
    .from("workspaces")
    .update({ currency })
    .eq("id", membership.workspaceId)
  if (error) throw new Error(error.message)

  revalidatePath("/profile")
}

export async function acceptInvite(token: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("accept_invite", {
    p_token: token,
  })
  if (error) return { error: error.message }
  // The RPC returns the joined workspace's id. Without this the invitee lands
  // back in whichever workspace they already had.
  if (data) await setActiveWorkspace(data as string)
  return {}
}
