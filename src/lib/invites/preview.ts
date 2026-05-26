import { createClient } from "@/lib/supabase/server"

export interface InvitePreview {
  workspaceName: string
  valid: boolean
}

export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_invite_preview", { p_token: token })
  if (error || !data || data.length === 0) return null
  const row = data[0]!
  return { workspaceName: row.workspace_name, valid: row.valid }
}
