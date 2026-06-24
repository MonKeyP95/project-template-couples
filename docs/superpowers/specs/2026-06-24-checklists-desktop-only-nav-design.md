# Checklists nav — desktop only

**Date:** 2026-06-24
**Status:** Approved, ready for implementation
**Scope:** `MobileTopNav` in `src/components/app-nav.tsx` only. Amends
`2026-06-24-mobile-arrow-nav-design.md`. Desktop `LeftRail`, `buildNavDestinations`,
and the `/checklists` routes are untouched.

## Problem

Editing/creating checklists is a desktop setup task; on mobile you mostly *consume* them,
which already works through the packing tab's **Import items -> From a checklist** flow.
So Checklists should remain a destination on the desktop `LeftRail` but drop out of the
mobile prev/next arrow nav.

## What changes

The mobile arrow order excludes `checklists`. Rename the existing `NAV_ORDER` constant to
`MOBILE_NAV_ORDER` (it has always been mobile-only; the rename makes the desktop/mobile
divergence explicit) and drop `checklists`:

```ts
const MOBILE_NAV_ORDER: NavKey[] = ["home", "trip", "on-the-road"]
```

`home` is always present in `buildNavDestinations`, so the mobile ordered list has length
>= 1. Removing `checklists` introduces two cases the old design never hit; both are handled
in `MobileTopNav`:

### Current page not in the mobile order

When `current === "checklists"` (e.g. the `/checklists` page opened on a phone by direct
URL or a synced desktop session), the current key is absent from `MOBILE_NAV_ORDER`, so the
current index is `-1`. Render a single **`<- Home`** arrow on the left (Home is always
present) plus the sign-out, so the user can get back. No right arrow.

### Single-page mobile nav

When the ordered list has exactly one entry (only `home` — no active trip, not on the
road), showing an arrow that points to the page you are already on is meaningless. Render
the bar with **no arrows** — just the sign-out icon, right-aligned.

### Otherwise (2+ pages, current present)

Unchanged from the shipped arrow-nav design: `prev`/`next` over the ordered list with
wrap-around; the two-page case shows a single right arrow.

## Implementation

All in `MobileTopNav` (`src/components/app-nav.tsx`):

- Rename `NAV_ORDER` -> `MOBILE_NAV_ORDER`, value `["home", "trip", "on-the-road"]`.
- After computing `ordered` and `i = ordered.findIndex(...)`:
  - `if (i === -1)` -> return the bar with a single left `<- Home` arrow + sign-out.
  - `else if (ordered.length === 1)` -> return the bar with just the sign-out (no arrows).
  - else -> existing two-arrow layout.
- The left/empty/right flex structure (`justify-between`, `<span />` placeholder for the
  absent side) and label styling are reused across all three branches.

`LeftRail`, `buildNavDestinations`, `NavDestination`, `SignOutButton`, and every page that
renders `MobileTopNav` are unchanged. Checklists pages keep passing `current="checklists"`.

## Out of scope

- Removing or relocating the `/checklists` routes (they stay, reachable by URL on mobile).
- Any change to desktop `LeftRail`.
- The deferred "where checklist editing lives" product discussion beyond "stays on the
  existing /checklists page, desktop-nav only."
