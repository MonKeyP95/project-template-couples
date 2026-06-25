import { createClient } from "@/lib/supabase/server"

import { jsonToSharedTrip, type SharedTrip } from "@/lib/trips/shared-trip-types"

/** Public projection of a shared trip, or null when the token is unknown or the
 * trip is not currently public. Works for anonymous visitors: the underlying
 * `shared_trip` RPC is granted to anon and runs security-definer. */
export async function getSharedTrip(token: string): Promise<SharedTrip | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("shared_trip", { p_token: token })
  return jsonToSharedTrip(data)
}

/** Current share state for the owner-side dialog. */
export async function getTripShareState(
  tripId: string,
): Promise<{ isPublic: boolean; shareToken: string | null }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select("is_public, share_token")
    .eq("id", tripId)
    .maybeSingle()
  return {
    isPublic: data?.is_public ?? false,
    shareToken: data?.share_token ?? null,
  }
}
