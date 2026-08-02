import { Chevron, Label } from "@/components/together"
import { createWorkspace } from "@/lib/workspace/actions"
import {
  listUserWorkspaces,
  type WorkspaceSummary,
} from "@/lib/workspace/queries"

/** Switch to another workspace. A form post rather than a link, so the cookie
 * is set by the route handler and the method matches the mutation. */
function SwitchRow({
  workspace,
  next,
}: {
  workspace: WorkspaceSummary
  next: string
}) {
  return (
    <form action="/api/workspace/switch" method="post">
      <input type="hidden" name="to" value={workspace.id} />
      <input type="hidden" name="next" value={next} />
      <button
        type="submit"
        className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-sea-tint hover:text-foreground"
      >
        <span className="truncate">{workspace.name}</span>
        <Chevron />
      </button>
    </form>
  )
}

/**
 * Workspaces menu: the other workspaces to switch to, and a field to add one.
 * A native <details> so it stays a Server Component: every entry is a form
 * post, nothing hydrates.
 *
 * `openUp` is for the left rail, where this sits low enough that a downward
 * menu would cover Appearance and Sign out.
 */
export async function WorkspaceSwitcher({
  next = "/home",
  openUp = false,
}: {
  next?: string
  openUp?: boolean
}) {
  const workspaces = await listUserWorkspaces()
  if (workspaces.length === 0) return <Label>Workspaces</Label>

  const others = workspaces.filter((w) => !w.active)

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <Label>Workspaces</Label>
        <span className="text-[10px] text-muted-foreground transition-transform group-open:rotate-180">
          v
        </span>
      </summary>

      <div
        className={`absolute left-0 z-20 w-[210px] rounded-lg border border-border bg-card p-2 shadow-lg ${
          openUp ? "bottom-full mb-2" : "top-full mt-2"
        }`}
      >
        {others.map((w) => (
          <SwitchRow key={w.id} workspace={w} next={next} />
        ))}
        {others.length > 0 ? <div className="my-1.5 h-px bg-border" /> : null}

        <form action={createWorkspace} className="flex gap-1.5 p-1">
          <input
            name="name"
            required
            maxLength={40}
            placeholder="New workspace"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="rounded-md bg-sea-tint px-2.5 py-1.5 text-[13px] text-foreground"
          >
            Add
          </button>
        </form>
      </div>
    </details>
  )
}
