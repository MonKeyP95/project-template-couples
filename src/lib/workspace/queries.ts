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
    .single()

  if (!membership) return null

  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, role, profiles(display_name)")
    .eq("workspace_id", membership.workspace_id)

  return {
    id: membership.workspace_id,
    // Supabase typed result for nested table is unknown without codegen; cast carefully.
    name: (membership.workspaces as unknown as { name: string }).name,
    role: membership.role as "owner" | "member",
    members:
      members?.map((m) => ({
        user_id: m.user_id,
        role: m.role as "owner" | "member",
        display_name: (m.profiles as unknown as { display_name: string }).display_name,
      })) ?? [],
  }
}
