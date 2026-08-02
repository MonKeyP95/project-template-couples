import { createClient } from "@/lib/supabase/server"
import { resolveActiveMembership } from "@/lib/workspace/active"

export interface WorkspaceMember {
  user_id: string
  role: "owner" | "member"
  display_name: string
}

export interface CurrentWorkspace {
  id: string
  name: string
  createdAt: string
  role: "owner" | "member"
  /** The workspace's home currency; the default a new trip is created with. */
  currency: string
  members: WorkspaceMember[]
}

export async function getCurrentWorkspace(): Promise<CurrentWorkspace | null> {
  const membership = await resolveActiveMembership()
  if (!membership) return null

  const supabase = await createClient()

  const { data: rawMembers } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", membership.workspaceId)

  if (!rawMembers || rawMembers.length === 0) return null

  // Fetch display names separately. We can't embed profiles(display_name) on
  // workspace_members because both tables reference auth.users.id independently
  // and PostgREST can't infer the join. Two flat queries + JS lookup is safer.
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in(
      "id",
      rawMembers.map((m) => m.user_id),
    )

  const nameById = new Map(
    profilesData?.map((p) => [p.id, p.display_name as string]) ?? [],
  )

  return {
    id: membership.workspaceId,
    name: membership.workspace.name,
    createdAt: membership.workspace.created_at,
    role: membership.role,
    currency: membership.workspace.currency,
    members: rawMembers.map((m) => ({
      user_id: m.user_id,
      role: m.role as "owner" | "member",
      display_name: nameById.get(m.user_id) ?? "Unknown",
    })),
  }
}

export interface WorkspaceSummary {
  id: string
  name: string
  role: "owner" | "member"
  active: boolean
}

/** Every workspace the caller belongs to, oldest first, flagged with which one
 * is currently active. Drives the switcher. */
export async function listUserWorkspaces(): Promise<WorkspaceSummary[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return []

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", userData.user.id)
    .order("joined_at", { ascending: true })

  if (!memberships || memberships.length === 0) return []

  const active = await resolveActiveMembership()

  return memberships.map((m) => ({
    id: m.workspace_id,
    name: (m.workspaces as unknown as { name: string }).name,
    role: m.role as "owner" | "member",
    active: m.workspace_id === active?.workspaceId,
  }))
}
