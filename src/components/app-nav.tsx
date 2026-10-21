import type { ReactNode } from "react"
import Link from "next/link"
import { LogOut } from "lucide-react"

import { Chevron, Coord, Label } from "@/components/together"
import { ThemeToggle } from "@/components/theme-toggle"
import { WorkspaceList } from "@/components/workspace-switcher"
import { cn } from "@/lib/utils"
import type { CurrentWorkspace } from "@/lib/workspace/queries"

export type NavKey = "home" | "on-the-road" | "checklists" | "trip" | "manual" | "profile"

/**
 * Left-to-right order for the mobile menu pill. Excludes `checklists` (desktop-only:
 * mobile consumes them via packing's Import items) and `manual`, which is linked
 * from Profile so four items fit at phone width.
 */
const MOBILE_NAV_ORDER: NavKey[] = ["home", "trip", "on-the-road", "profile"]

/** Posts to the existing /api/signout route, then redirects to the landing page. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/api/signout" method="post">
      <button
        type="submit"
        aria-label="Sign out"
        className={className}
      >
        <LogOut className="size-4" strokeWidth={1.75} />
      </button>
    </form>
  )
}

export interface NavDestination {
  key: NavKey
  label: string
  href: string
  italic?: boolean
}

/**
 * Builds the Navigate list. Home is always present; On the road only during an
 * active trip; the trip item points to the viewed/active trip when there is one.
 */
export function buildNavDestinations(opts: {
  onTheRoad: boolean
  tripSlug: string | null
}): NavDestination[] {
  const items: NavDestination[] = []
  if (opts.onTheRoad) {
    items.push({
      key: "on-the-road",
      label: "On the road",
      href: "/on-the-road",
    })
  }
  if (opts.tripSlug) {
    items.push({
      key: "trip",
      label: "Trip",
      href: `/trips/${opts.tripSlug}`,
      italic: true,
    })
  }
  items.push({ key: "home", label: "Home", href: "/home" })
  items.push({ key: "checklists", label: "Checklists", href: "/checklists" })
  items.push({ key: "manual", label: "Manual", href: "/manual" })
  items.push({ key: "profile", label: "Profile", href: "/profile" })
  return items
}

export async function LeftRail({
  workspace,
  initialDark,
  destinations,
  current,
}: {
  workspace: CurrentWorkspace
  initialDark: boolean
  destinations: NavDestination[]
  current: NavKey
}) {
  const estYear = new Date(workspace.createdAt).getFullYear()
  return (
    <aside className="hidden lg:flex lg:w-[220px] lg:flex-shrink-0 lg:flex-col lg:gap-9 lg:border-r lg:border-border lg:bg-card lg:px-6 lg:py-8">
      <div>
        <Label>Together</Label>
        <div className="t-display mt-2 text-[28px] leading-[0.95] text-foreground">
          {workspace.members.map((m, i) => (
            <span key={m.user_id}>
              {i > 0 ? (
                <span className="text-muted-foreground"> &amp; </span>
              ) : null}
              <em>{m.display_name}</em>
            </span>
          ))}
        </div>
        <Coord>workspace · est. {estYear}</Coord>
      </div>

      <div>
        <Label className="mb-2.5 block">Navigate</Label>
        <nav className="flex flex-col gap-0.5">
          {destinations.map((d) =>
            d.key === current ? (
              <div
                key={d.key}
                className="flex items-center justify-between rounded-md bg-sea-tint px-2.5 py-2 text-[13.5px] text-foreground"
              >
                <span className={d.italic ? "font-serif italic" : undefined}>
                  {d.label}
                </span>
                <Chevron />
              </div>
            ) : (
              <Link
                key={d.key}
                href={d.href}
                className="flex items-center justify-between rounded-md px-2.5 py-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-sea-tint hover:text-foreground"
              >
                <span className={d.italic ? "font-serif italic" : undefined}>
                  {d.label}
                </span>
                <Chevron />
              </Link>
            ),
          )}
        </nav>
      </div>

      <div className="mt-auto">
        <WorkspaceList />
      </div>

      <div className="flex items-center justify-between border-t border-border pt-5">
        <Label>Appearance</Label>
        <ThemeToggle initialDark={initialDark} />
      </div>

      <div className="flex items-center justify-between">
        <Label>Sign out</Label>
        <SignOutButton className="text-muted-foreground transition-colors hover:text-foreground" />
      </div>
    </aside>
  )
}

/**
 * Mobile nav: an in-header row holding `center` (the trip page's "edit trip") and
 * sign-out, plus the fixed bottom menu pill over MOBILE_NAV_ORDER. Pages leave
 * room for the pill with bottom padding.
 */
export function MobileHeaderNav({
  destinations,
  current,
  center,
  className,
}: {
  destinations: NavDestination[]
  current: NavKey
  center?: ReactNode
  className?: string
}) {
  return (
    <>
      <div className={cn("flex items-center justify-center gap-3 lg:hidden", className)}>
        {center}
        <SignOutButton className="flex items-center text-muted-foreground hover:text-foreground" />
      </div>
      <MobileNavPill destinations={destinations} current={current} />
    </>
  )
}

/** Shorter labels so four items fit the pill at phone width. */
const PILL_LABEL: Partial<Record<NavKey, string>> = { "on-the-road": "Road" }

function MobileNavPill({
  destinations,
  current,
}: {
  destinations: NavDestination[]
  current: NavKey
}) {
  const items = MOBILE_NAV_ORDER.map((key) =>
    destinations.find((d) => d.key === key),
  ).filter((d): d is NavDestination => d !== undefined)

  return (
    <div className="fixed inset-x-0 bottom-7 z-40 lg:hidden">
      <div className="mx-auto w-full max-w-[440px] px-4">
        <nav
          aria-label="Menu"
          className="flex gap-1 rounded-full border border-border bg-card/80 p-1.5 shadow-md backdrop-blur-xl"
        >
          {items.map((d) => {
            const isActive = d.key === current
            return (
              <Link
                key={d.key}
                href={d.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex-1 rounded-full py-2.5 text-center font-mono text-[10px] uppercase tracking-[0.2em] transition-colors",
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {PILL_LABEL[d.key] ?? d.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
