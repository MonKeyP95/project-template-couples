import Link from "next/link"

import { Avatar, Chevron, Label } from "@/components/together"
import {
  listUserWorkspaces,
  type WorkspaceSummary,
} from "@/lib/workspace/queries"

const rowClass =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors"

/** Overlapping initials, alternating tones -- the PairAvatar idiom for N people. */
function AvatarStack({ people }: { people: string[] }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center">
      {people.slice(0, 3).map((name, i) => (
        <Avatar
          key={i}
          name={name}
          size={22}
          tone={i % 2 === 0 ? "sea" : "clay"}
          className={i > 0 ? "-ml-1.5" : undefined}
        />
      ))}
    </span>
  )
}

/** First names only -- the row is narrow and surnames buy nothing here. */
function WorkspaceName({ people }: { people: string[] }) {
  return (
    <span className="truncate font-serif text-[13px] italic">
      {people.map((name) => name.trim().split(/\s+/)[0]).join(" & ")}
    </span>
  )
}

/** Open another workspace. A form post rather than a link, so the cookie is set
 * by the route handler and the method matches the mutation. */
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
        className={`${rowClass} text-muted-foreground hover:bg-sea-tint hover:text-foreground`}
      >
        <AvatarStack people={workspace.people} />
        <WorkspaceName people={workspace.people} />
        <span className="ml-auto">
          <Chevron />
        </span>
      </button>
    </form>
  )
}

function NewWorkspaceLink() {
  return (
    <Link
      href="/workspaces/new"
      className="flex items-center justify-between rounded-md px-2 py-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-sea-tint hover:text-foreground"
    >
      <span>New workspace</span>
      <Chevron />
    </Link>
  )
}

/**
 * Every workspace you belong to, always visible: the one you are in is
 * highlighted, the others are pressable and open on press. For the left rail,
 * which has the room for it. Server Component -- each row is a form post.
 */
export async function WorkspaceList({ next = "/home" }: { next?: string }) {
  const workspaces = await listUserWorkspaces()

  return (
    <div>
      <Label className="mb-2.5 block">Workspaces</Label>
      <div className="flex flex-col gap-0.5">
        {workspaces.map((w) =>
          w.active ? (
            <div
              key={w.id}
              className={`${rowClass} bg-sea-tint text-foreground`}
            >
              <AvatarStack people={w.people} />
              <WorkspaceName people={w.people} />
            </div>
          ) : (
            <SwitchRow key={w.id} workspace={w} next={next} />
          ),
        )}
        <NewWorkspaceLink />
      </div>
    </div>
  )
}

/**
 * The same list as a native <details> popover, for the mobile home header where
 * a flat list would not fit. Holds the other workspaces only -- the one you are
 * in is the page you are looking at.
 */
export async function WorkspaceSwitcher({
  next = "/home",
}: {
  next?: string
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

      <div className="absolute left-0 top-full z-20 mt-2 w-[230px] rounded-lg border border-border bg-card p-2 shadow-lg">
        {others.map((w) => (
          <SwitchRow key={w.id} workspace={w} next={next} />
        ))}
        {others.length > 0 ? <div className="my-1.5 h-px bg-border" /> : null}
        <NewWorkspaceLink />
      </div>
    </details>
  )
}
