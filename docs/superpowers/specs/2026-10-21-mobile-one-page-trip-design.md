# Mobile one-page trip + menu pill — design

**Date:** 2026-10-21
**Status:** approved direction, not implemented

## Goal

On phones, replace the four-tab trip page with one scrolling page of
collapsible boxes, and replace the mobile prev/next arrows on every page with a
bottom menu pill. Desktop stays exactly as it is, so the two layouts can be
compared on real use before one is kept.

Reference mockup (click-through, latest state):
<https://claude.ai/artifact/9WUKu5dVCpDxWoyN2DUUq3> — the trip screen at the end
of the flow. The creation flow in the same mockup is **not** this slice.

## Current state

- `src/app/trips/[slug]/page.tsx`: large sea-tint header (coord, name, country,
  idea, dates, `FlipCountdown size="lg"`), then one tab body chosen by
  `?tab=`, plus a fixed bottom tab pill (`BottomNav`, `lg:hidden`). Data loads
  are gated per tab.
- `MobileHeaderNav` (`src/components/app-nav.tsx`) renders prev/next arrows, a
  center slot (trip page: "edit trip") and sign-out. Used by home, trip,
  on-the-road, manual, profile, checklists, checklists/[slug].

## Decisions

| Decision | Choice |
|---|---|
| Scope | Mobile only. Desktop trip page and desktop nav untouched. |
| Phone vs desktop | Server-side `userAgent()` (`next/server`), `device.type === "mobile"`. One tree is rendered, never both hidden by CSS (both would mount `DndContext` and Realtime twice). |
| Page order | Header line, Trip box (headline + itinerary), Budget, Packing, Documents, Notes |
| Box | One shared component on native `<details>`/`<summary>`, light-blue card. All closed on load. |
| Trip box | Summary row = `trip_profile.idea` (fallback: trip name). Open: date range or "N days, no dates yet", then today's profile fields. Second summary row in the same box: Itinerary, "N days", opens `ItineraryTab` / `DreamItineraryTab`. |
| Budget box | Summary always visible (total, per day, left). Expands **inline** to the full `BudgetTab`. |
| Documents | Packing items in a category named "Documents", shown in their own box. No schema change. Packing box shows every other category. |
| Notes | Stays, as the last box, wrapping `NotesTab`. |
| Header line | Place on the left (location / country), `FlipCountdown size="sm"` on the right; "No dates yet" when undated. Replaces the large header on mobile. |
| Menu pill | On **every** mobile page. Items from `buildNavDestinations` in `MOBILE_NAV_ORDER` minus Manual: Home, Trip (when one exists), Road (only during an active trip), Profile. Current page highlighted. |
| Arrows | Removed from `MobileHeaderNav`; it keeps the center slot and sign-out. |
| Manual | Leaves the mobile nav; reached from a link on Profile. |
| Data | Mobile loads every section's data on each visit. Desktop keeps its per-tab gating. |

## Risks to resolve in the plan

1. **Documents split vs Realtime.** `PackingTab` owns items, categories and the
   Realtime subscription. Two instances could double-subscribe. The plan must
   check the channel naming and pick one: a category filter prop on two
   instances (if channels don't clash), or one instance that renders the
   Documents category into a separate box.
2. **`BudgetTab` and `ItineraryTab` inside a collapsed box.** Check nothing
   measures layout on mount (drag sensors, sticky elements) and breaks while
   hidden.
3. **Pages with their own bottom UI** (on-the-road dispatch, packing add bar)
   must not sit under the pill.

## Out of scope

Attachments (receipt slice comes next), the new creation flow, free-text
softer answers, dropping dreams, any desktop change.

The creation flow is its own later slice and, unlike this one, ships on
**desktop and mobile**: only the trip-page layout is mobile-only for now.

## Success criteria

**Verified by Claude**
1. `pnpm build` passes and `pnpm lint` is clean.
2. With a mobile user-agent the trip page renders the box layout and does not
   render `BottomNav` or the tab bodies; with a desktop user-agent the output is
   unchanged from today (tabs, rails, per-tab loading).
3. The mobile trip page mounts each of `ItineraryTab`/`DreamItineraryTab`,
   `BudgetTab`, `NotesTab` once, and opens one packing Realtime channel.
4. `MobileHeaderNav` no longer renders arrows; every page that used it renders
   the menu pill on mobile, with Road only when a trip is active and Trip only
   when a trip exists.
5. Items in the "Documents" category appear only in the Documents box; all
   others only in the Packing box.
6. A `docs/DECISIONS.md` row records the user-agent switch and why.

**Verified by the user in-app (phone)**
1. Trip page opens with all boxes closed: headline row, itinerary row, budget
   summary, Packing, Documents, Notes.
2. The header line shows the place and the small flip clock (or "No dates yet").
3. Opening Budget shows the full budget inline; adding an expense still works.
4. Opening Itinerary shows the days; adding and dragging an event still works.
5. Ticking a packing item on one phone shows on the partner's phone (Realtime).
6. Adding an item in the Documents box lands it in Documents, not Packing.
7. The pill shows on Home, Trip, On the road, Profile and moves between them;
   nothing is hidden under it on any page.
8. Manual is reachable from Profile.
9. Desktop trip page looks and works exactly as before.
