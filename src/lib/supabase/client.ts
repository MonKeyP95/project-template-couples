import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

let client: SupabaseClient | undefined

export function createClient() {
  if (client) return client

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )

  // Realtime must authenticate as the logged-in user. Otherwise Supabase
  // evaluates postgres_changes RLS as the anon role, fails the member SELECT
  // check, and silently drops every event (channel SUBSCRIBED, nothing arrives).
  // Push the session's access token to the realtime socket on each auth change.
  client.auth.onAuthStateChange((_event, session) => {
    client!.realtime.setAuth(session?.access_token ?? null)
  })

  return client
}
