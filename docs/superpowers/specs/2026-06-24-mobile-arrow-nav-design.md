# Mobile arrow nav — design

**Date:** 2026-06-24
**Status:** Approved, ready for implementation
**Scope:** `MobileTopNav` in `src/components/app-nav.tsx` only. Desktop `LeftRail` is untouched.

## Problem

The mobile top bar (`MobileTopNav`) renders every nav destination as a row of equal
pill chips (Home, Trip, On the road, Checklists), highlighting the current one. The user
wants a lighter prev/next pattern: a left arrow naming the previous page and a right arrow
naming the next page, so from the Trip page you see `<- Home` on the left and
`On the road ->` on the right.

## What it does

Replace the pill row with two arrows derived from a fixed page order. The current page sits
conceptually between them; the left arrow is the previous page, the right arrow is the next
page, wrapping at the ends so every page is reachable by tapping through.

### Page order

A single canonical left-to-right order, independent of `buildNavDestinations`' list order
(which also feeds desktop):

```
home -> trip -> on-the-road -> checklists
```

Only destinations that currently exist participate (e.g. `trip` and `on-the-road` are
absent when there is no active trip / not on the road). The arrows operate on the existing
destinations filtered into this order.

### Arrow selection

Given the ordered, present destinations and the current key at index `i` (length `n`):

- **prev** = `ordered[(i - 1 + n) % n]`
- **next** = `ordered[(i + 1) % n]`

Wrap-around means the first page's prev is the last page and vice versa.

**Two-page case:** when only two destinations exist (minimum is always Home + Checklists),
`prev` and `next` resolve to the *same* other page. Show a single arrow (rendered as the
`next`/right arrow) and leave the left side empty, rather than two identical arrows.

### Layout

A single sticky bar, same chrome as today (`sticky top-0 z-20 border-b bg-card/95
backdrop-blur lg:hidden`). Flex row, `justify-between`:

- **Left:** prev arrow — a `Link` styled `<- {prev.label}` (lucide `ArrowLeft`, then label).
  Rendered only when `prev` differs from `next` (i.e. 3+ pages).
- **Right group** (`flex items-center gap-2`, pushed right): next arrow `Link`
  `{next.label} ->` (label, then lucide `ArrowRight`), followed by the existing
  `SignOutButton` icon.

Labels keep the current type treatment: `font-mono text-[10px] uppercase
tracking-[0.18em] text-muted-foreground`, with `hover:text-foreground`. The `trip`
destination keeps its serif-italic label treatment (it carries `italic: true`). Sign-out
stays in this bar — it is mobile's only sign-out path.

The current page is intentionally **not** labeled in the bar; the page's own heading already
states where you are, and dropping it keeps the two-arrow layout clean.

## Implementation

All in `src/components/app-nav.tsx`:

- Add a module-level canonical order constant:
  `const NAV_ORDER: NavKey[] = ["home", "trip", "on-the-road", "checklists"]`.
- In `MobileTopNav`, sort the incoming `destinations` by `NAV_ORDER`, find the current
  index, compute `prev`/`next` with wrap, and render the two-arrow layout above.
- Import `ArrowLeft`, `ArrowRight` from `lucide-react` (already importing `LogOut`).
- `buildNavDestinations`, `LeftRail`, `NavDestination`, and `SignOutButton` are unchanged.

## Out of scope

- Any change to desktop `LeftRail` or to `buildNavDestinations` ordering.
- A center "you are here" label.
- The checklists -> packing-pill consolidation (separate, later design).
