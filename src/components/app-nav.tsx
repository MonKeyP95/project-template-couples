import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, LogOut } from "lucide-react"

import { Avatar, Chevron, Coord, Label } from "@/components/together"
import { ThemeToggle } from "@/components/theme-toggle"
import type { CurrentWorkspace } from "@/lib/workspace/queries"

export type NavKey = "home" | "on-the-road" | "checklists" | "trip"

/**
 * Left-to-right order for the mobile prev/next arrows. Mobile-only and
 * intentionally excludes `checklists` (a desktop-only destination — editing
 * checklists is a desktop task; mobile consumes them via packing's Import items).
 */
const MOBILE_NAV_ORDER: NavKey[] = ["home", "trip", "on-the-road"]

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
  return items
}

export function LeftRail({
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
        <Label className="mb-2.5 block">Members</Label>
        <div className="flex flex-col gap-2">
          {workspace.members.map((m, i) => (
            <div key={m.user_id} className="flex items-center gap-2.5">
              <Avatar
                name={m.display_name}
                size={24}
                tone={i === 0 ? "sea" : "clay"}
              />
              <div className="font-serif text-[13px] italic text-foreground">
                {m.display_name}
              </div>
            </div>
          ))}
        </div>
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

const arrowLabel = "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"

/**
 * Prev/next arrows over the canonical page order. The current page sits between
 * them; prev/next wrap around. With only two pages they resolve to the same
 * other page, so a single (right) arrow is shown.
 */
export function MobileTopNav({
  destinations,
  current,
}: {
  destinations: NavDestination[]
  current: NavKey
}) {
  const ordered = MOBILE_NAV_ORDER.map((key) =>
    destinations.find((d) => d.key === key),
  ).filter((d): d is NavDestination => d !== undefined)

  const i = ordered.findIndex((d) => d.key === current)

  // Current page isn't in the mobile order (e.g. /checklists on a phone, since
  // checklists is desktop-only): a single back arrow to Home. Home is always present.
  if (i === -1) {
    const home = ordered.find((d) => d.key === "home")
    return <MobileNavBar left={home ? <PrevArrow dest={home} /> : <span />} />
  }

  const n = ordered.length

  // Only Home exists (no active trip, not on the road): no neighbour to point at.
  if (n === 1) {
    return <MobileNavBar left={<span />} />
  }

  const prev = ordered[(i - 1 + n) % n]
  const next = ordered[(i + 1) % n]
  const showPrev = prev.key !== next.key

  return (
    <MobileNavBar
      left={showPrev ? <PrevArrow dest={prev} /> : <span />}
      right={<NextArrow dest={next} />}
    />
  )
}

/** Sticky mobile bar shell: a left slot, then the right slot beside sign-out. */
function MobileNavBar({
  left,
  right,
}: {
  left: ReactNode
  right?: ReactNode
}) {
  return (
    <nav className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur lg:hidden">
      {left}
      <div className="flex items-center gap-3">
        {right}
        <SignOutButton className="flex items-center text-muted-foreground hover:text-foreground" />
      </div>
    </nav>
  )
}

function PrevArrow({ dest }: { dest: NavDestination }) {
  return (
    <Link href={dest.href} className={arrowLabel}>
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      <span className={dest.italic ? "font-serif italic normal-case" : undefined}>
        {dest.label}
      </span>
    </Link>
  )
}

function NextArrow({ dest }: { dest: NavDestination }) {
  return (
    <Link href={dest.href} className={arrowLabel}>
      <span className={dest.italic ? "font-serif italic normal-case" : undefined}>
        {dest.label}
      </span>
      <ArrowRight className="size-3.5" strokeWidth={1.75} />
    </Link>
  )
}
