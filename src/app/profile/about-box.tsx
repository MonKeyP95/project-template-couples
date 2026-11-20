import { Button } from "@/components/ui/button"
import { setWorkspaceDescription } from "@/lib/workspace/actions"
import type { CurrentWorkspace } from "@/lib/workspace/queries"
import { InviteTraveller } from "./invite-traveller"
import { ProfileBox } from "./profile-box"

/** Who the couple is: their own description, the people, and inviting more. */
export function AboutBox({ workspace }: { workspace: CurrentWorkspace }) {
  return (
    <ProfileBox
      title="About us"
      status={
        workspace.description
          ? { label: "done", done: true }
          : { label: "empty", done: false }
      }
    >
      <p className="text-sm">
        {workspace.people.map((p) => p.display_name).join(" & ")}
      </p>

      <form
        key={workspace.description}
        action={setWorkspaceDescription}
        className="mt-4"
      >
        <textarea
          name="description"
          aria-label="About us"
          defaultValue={workspace.description}
          maxLength={300}
          rows={3}
          placeholder="A few words about the two of you as travellers."
          className="block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Up to 300 characters. Either of you can edit it, and the AI reads it
          as background.
        </p>
        <Button type="submit" size="lg" className="mt-3">
          Save
        </Button>
      </form>

      <InviteTraveller
        people={workspace.people
          .filter((p) => p.user_id === null)
          .map((p) => ({ id: p.id, display_name: p.display_name }))}
      />
    </ProfileBox>
  )
}
