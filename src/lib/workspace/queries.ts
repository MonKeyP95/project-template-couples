import { createClient } from "@/lib/supabase/server"

export interface WorkspaceMember {
  user_id: string
  role: "owner" | "member"
  display_name: string
}

export interface CurrentWorkspace {
  id: string
  name: string
  role: "owner" | "member"
  members: WorkspaceMember[]
}

export async function getCurrentWorkspace(): Promise<CurrentWorkspace | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) return null

  const { data: rawMembers } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", membership.workspace_id)

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
    id: membership.workspace_id,
    // Supabase typed result for nested table is unknown without codegen; cast carefully.
    name: (membership.workspaces as unknown as { name: string }).name,
    role: membership.role as "owner" | "member",
    members: rawMembers.map((m) => ({
      user_id: m.user_id,
      role: m.role as "owner" | "member",
      display_name: nameById.get(m.user_id) ?? "Unknown",
    })),
  }
}
