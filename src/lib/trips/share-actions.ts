"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/** Mints (or reuses) a share token and marks the trip public. Returns the token
 * so the dialog can show the link immediately. `shared_at` is set only on the
 * first share. RLS gates that the caller is a workspace member of the trip. */
export async function shareTrip(
  tripId: string,
  tripSlug: string,
): Promise<{ error?: string; token?: string }> {
  const supabase = await createClient()

  const { data: existing, error: readError } = await supabase
    .from("trips")
    .select("share_token, shared_at")
    .eq("id", tripId)
    .maybeSingle()
  if (readError) return { error: readError.message }
  if (!existing) return { error: "Trip not found." }

  const token = existing.share_token ?? crypto.randomUUID().replace(/-/g, "")
  const sharedAt = existing.shared_at ?? new Date().toISOString()

  const { error } = await supabase
    .from("trips")
    .update({ is_public: true, share_token: token, shared_at: sharedAt })
    .eq("id", tripId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return { token }
}

/** Turns a trip's public link off. The token is kept, so re-sharing reuses the
 * same link. */
export async function unshareTrip(
  tripId: string,
  tripSlug: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trips")
    .update({ is_public: false })
    .eq("id", tripId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
