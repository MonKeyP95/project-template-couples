import { buildProfileBlock } from "./profile-context"
import { getTasteLevel } from "./taste-level"
import { TASTE_DIRECTIVE, type TasteLevel } from "./taste-types"

/** The shared "everything we know" context every assistant sub consumes: the
 * profile block plus the taste dial. Each sub's harness picks the fields it
 * needs. Suggest-only: reads, never writes. */
export interface AssistantContext {
  profileBlock: string
  taste: TasteLevel
  tasteDirective: string
}

export async function buildAssistantContext(
  workspaceId: string,
  tripId?: string,
): Promise<AssistantContext> {
  const profileBlock = await buildProfileBlock(workspaceId, tripId)
  const taste = await getTasteLevel()
  return { profileBlock, taste, tasteDirective: TASTE_DIRECTIVE[taste] }
}
