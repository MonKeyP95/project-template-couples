import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"

/**
 * Where a signed-in user lands: the on-the-road page when a trip is active
 * right now, else home. Mirrors the /on-the-road guard so we never send the
 * user to a page that would just bounce them back to /home.
 */
export async function defaultLanding(): Promise<string> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return "/home"
  const buckets = await listTripsForWorkspace(workspace.id)
  return buckets.now.length > 0 ? "/on-the-road" : "/home"
}
