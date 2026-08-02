import { createClient } from "@/lib/supabase/server"
import { resolveActiveMembership } from "@/lib/workspace/active"

export interface WorkspaceMember {
  user_id: string
  role: "owner" | "member"
  display_name: string
}

export interface WorkspacePerson {
  id: string
  display_name: string
  /** null for an avatar: a traveller with no account. */
  user_id: string | null
}

export interface CurrentWorkspace {
  id: string
  name: string
  createdAt: string
  role: "owner" | "member"
  /** The workspace's home currency; the default a new trip is created with. */
  currency: string
  members: WorkspaceMember[]
  /** Everyone who can hold money on a trip: members plus avatars. */
  people: WorkspacePerson[]
  /** The signed-in user's person id. Compare ids against this, never auth uid. */
  myPersonId: string | null
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

  const { data: peopleRows } = await supabase
    .from("workspace_people")
    .select("id, display_name, user_id")
    .eq("workspace_id", membership.workspaceId)
    .order("created_at", { ascending: true })

  const people: WorkspacePerson[] = (peopleRows ?? []).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    user_id: p.user_id,
  }))

  const { data: userData } = await supabase.auth.getUser()
  const myPersonId =
    people.find((p) => p.user_id === userData.user?.id)?.id ?? null

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
    people,
    myPersonId,
  }
}

export interface WorkspaceSummary {
  id: string
  /** Everyone in it, newest first. This is what names a workspace on screen --
   * "Signe & Noam". Falls back to the stored name when it has no people yet. */
  people: string[]
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
    .select("workspace_id, workspaces(name)")
    .eq("user_id", userData.user.id)
    .order("joined_at", { ascending: true })

  if (!memberships || memberships.length === 0) return []

  const workspaceIds = memberships.map((m) => m.workspace_id)

  // Newest first, so a later-added traveller leads. Not enough on its own: the
  // people rows for workspaces that predate the table were backfilled by one
  // insert, so they all share a created_at and this ordering is a tie for them.
  const { data: peopleRows } = await supabase
    .from("workspace_people")
    .select("workspace_id, display_name, user_id")
    .in("workspace_id", workspaceIds)
    .order("created_at", { ascending: false })

  // Who created each workspace, which is the signal that survives the tie.
  const { data: ownerRows } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id")
    .in("workspace_id", workspaceIds)
    .eq("role", "owner")

  const ownerByWorkspace = new Map(
    ownerRows?.map((o) => [o.workspace_id, o.user_id]) ?? [],
  )

  type PersonRow = { display_name: string; user_id: string | null }
  const peopleByWorkspace = new Map<string, PersonRow[]>()
  for (const p of peopleRows ?? []) {
    const rows = peopleByWorkspace.get(p.workspace_id) ?? []
    rows.push(p)
    peopleByWorkspace.set(p.workspace_id, rows)
  }

  const active = await resolveActiveMembership()

  return memberships.map((m) => {
    const rows = peopleByWorkspace.get(m.workspace_id) ?? []
    const ownerId = ownerByWorkspace.get(m.workspace_id)
    // The creator trails; everyone they invited or added comes first.
    const ordered = [
      ...rows.filter((p) => p.user_id !== ownerId),
      ...rows.filter((p) => p.user_id === ownerId),
    ]

    return {
      id: m.workspace_id,
      people:
        ordered.length > 0
          ? ordered.map((p) => p.display_name)
          : [(m.workspaces as unknown as { name: string }).name],
      active: m.workspace_id === active?.workspaceId,
    }
  })
}
