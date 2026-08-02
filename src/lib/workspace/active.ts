import { cookies } from "next/headers"

import { createClient } from "@/lib/supabase/server"

export const ACTIVE_WORKSPACE_COOKIE = "active_workspace"

/** A year, matching the timezone and theme cookies. */
export const ACTIVE_WORKSPACE_COOKIE_MAX_AGE = 31536000

export interface ActiveMembership {
  workspaceId: string
  role: "owner" | "member"
  workspace: { name: string; created_at: string; currency: string }
}

/**
 * The workspace the app is currently looking at: the one named by the cookie
 * when the caller is a member of it, otherwise their first membership. Every
 * workspace-scoped read and write resolves through here, so a page and the
 * form on it can never disagree about which workspace they mean.
 */
export async function resolveActiveMembership(): Promise<ActiveMembership | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, created_at, currency)")
    .eq("user_id", userData.user.id)
    .order("joined_at", { ascending: true })

  if (!memberships || memberships.length === 0) return null

  const activeId = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value
  const row =
    memberships.find((m) => m.workspace_id === activeId) ?? memberships[0]

  return {
    workspaceId: row.workspace_id,
    role: row.role as "owner" | "member",
    workspace: row.workspaces as unknown as ActiveMembership["workspace"],
  }
}
