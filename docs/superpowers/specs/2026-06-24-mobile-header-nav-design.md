# Mobile nav in the page header

**Date:** 2026-06-24
**Status:** Approved, ready for implementation
**Scope:** `src/components/app-nav.tsx` + the four page files that render the mobile nav
(`trips/[slug]/page.tsx`, `home/page.tsx`, `on-the-road/page.tsx`, `checklists/page.tsx`).
Amends `2026-06-24-mobile-arrow-nav-design.md` and `2026-06-24-checklists-desktop-only-nav-design.md`.
Desktop `LeftRail` and `buildNavDestinations` are untouched.

## Problem

On mobile, the trip page stacks two overlapping rows: the sticky `MobileTopNav` arrow bar
and the trip header's own `[<- back] [Trip 02 of 03] [// edit trip]` row (the back link
duplicates the bar's `<- Home`). The user wants the prev/next arrows to live *inside* each
page's header (trip-style), and the separate sticky bar retired.

## What changes

### `MobileTopNav` -> `MobileHeaderNav` (non-sticky, centerable)

Replace the sticky bar with a plain row meant to sit inside a page header. Same arrow logic
as today (`MOBILE_NAV_ORDER = home -> trip -> on-the-road`, wrap-around prev/next; current
not in order -> lone `<- Home`; single-page -> no arrows). New: an optional `center` slot
and a `className` for per-page spacing.

```tsx
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
})
```

Layout: `<div className={cn("flex items-center justify-between lg:hidden", className)}>`
with three slots — left (prev arrow or an empty `<span />` spacer), optional center, and a
right group (`flex items-center gap-3`) holding the next arrow (when present) followed by
the existing `SignOutButton` icon. Sign-out stays in this row on every page, exactly where
it sits today. `arrowLabel`, `PrevArrow`, `NextArrow` are reused; the old sticky
`MobileNavBar` shell is removed. Add `cn` + `ReactNode` imports.

### Per-page wiring (all mobile-only; desktop headers unchanged)

- **Trip** (`trips/[slug]/page.tsx`): remove the standalone `<MobileTopNav>` (line ~212).
  In `TripHeaderView`, replace the mobile row (`lg:hidden` block with `<- back`,
  `Trip 02 of 03`, `// edit trip`) with `<MobileHeaderNav destinations current="trip"
  center={<editTripLink/>} className="mb-6" />`. "02 of 03" is dropped; the existing
  `// edit trip` Link becomes the center slot. `TripHeaderView` gains `destinations`
  (passed from the page where `navDestinations` already exists). The desktop row
  (`hidden lg:flex`, still showing `Trip 02 of 03` + edit) is untouched.
- **Home** (`home/page.tsx`): replace `<MobileTopNav .../>` with `<MobileHeaderNav
  destinations current="home" className="mb-6" />` placed at the top of `<main>` (above the
  existing `md:hidden` Together-Workspace header). `LeftRail` stays as the desktop sibling.
- **On the road** (`on-the-road/page.tsx`): replace `<MobileTopNav .../>` with
  `<MobileHeaderNav destinations current="on-the-road" className="mb-4" />` at the top of
  the content column (above the `On the road - {name}` label).
- **Checklists** (`checklists/page.tsx`): replace `<MobileTopNav .../>` with
  `<MobileHeaderNav destinations current="checklists" className="mb-4" />` at the top of
  `<main>` (above the `Checklists` label). Renders the lone `<- Home` arrow per the
  desktop-only rule.

In every page the `<LeftRail>` desktop sibling and the `navDestinations` it already builds
stay; only the mobile element changes from the sticky bar to the in-header row.

## Consequences

- The mobile nav no longer sticks to the top — it scrolls with the header. Intended (the
  user wants it in the header space).
- The trip page loses its duplicate `<- back` link and the `Trip 02 of 03` indicator on
  mobile (the desktop header keeps the count).
- Sign-out remains reachable on every mobile page (in the new row).

## Out of scope

- Desktop `LeftRail` and the desktop trip header.
- Removing `/profile` or adding a mobile profile link.
- Any data/query change.
