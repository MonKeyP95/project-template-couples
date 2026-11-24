import type { CurrentWorkspace } from "@/lib/workspace/queries"
import type { MemberToneEntry } from "./packing-tab"

/** Avatar initial, name and tone per person, keyed by person id and user id. */
export function memberToneMap(
  workspace: CurrentWorkspace,
): Record<string, MemberToneEntry> {
  const map: Record<string, MemberToneEntry> = {}
  for (const p of workspace.people) {
    const initial = (p.display_name ?? "?").trim().charAt(0).toUpperCase()
    const entry: MemberToneEntry = {
      initial,
      displayName: p.display_name,
      // The signed-in user reads as "sea"; everyone else, member or avatar, as
      // "clay". Previously keyed off the workspace owner, which says nothing
      // useful once a workspace can hold people who never sign in.
      tone: p.id === workspace.myPersonId ? "sea" : "clay",
    }
    // Keyed by BOTH ids on purpose. Subject columns (paid_by, savings user_id)
    // hold person ids; author columns (added_by, created_by) reference
    // auth.users and always will. This map is asked for both, so it answers to
    // both rather than each caller having to know which space its id is in.
    map[p.id] = entry
    if (p.user_id) map[p.user_id] = entry
  }
  return map
}
