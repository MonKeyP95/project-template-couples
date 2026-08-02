import { Label } from "@/components/together"
import { createWorkspace } from "@/lib/workspace/actions"
import { listUserWorkspaces } from "@/lib/workspace/queries"

/**
 * Workspace identity and switcher. A native <details> so it stays a Server
 * Component: every entry is a form post, nothing hydrates.
 */
export async function WorkspaceSwitcher({ next = "/home" }: { next?: string }) {
  const workspaces = await listUserWorkspaces()
  if (workspaces.length === 0) return <Label>Together · Workspace</Label>

  const active = workspaces.find((w) => w.active) ?? workspaces[0]
  const others = workspaces.filter((w) => w.id !== active.id)

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <Label>Together · {active.name}</Label>
        <span className="text-[10px] text-muted-foreground transition-transform group-open:rotate-180">
          v
        </span>
      </summary>

      <div className="absolute left-0 top-full z-20 mt-2 w-[240px] rounded-lg border border-border bg-card p-2 shadow-lg">
        {others.map((w) => (
          <form key={w.id} action="/api/workspace/switch" method="post">
            <input type="hidden" name="to" value={w.id} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="w-full rounded-md px-2.5 py-2 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-sea-tint hover:text-foreground"
            >
              {w.name}
            </button>
          </form>
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
