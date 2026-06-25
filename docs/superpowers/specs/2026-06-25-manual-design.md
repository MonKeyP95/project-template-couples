# Manual — design

**Date:** 2026-06-25
**Status:** approved, ready to implement

## What

A built-in **Manual**: a single reference page that explains how Together works.
It opens from the navigation alongside Home / On the road / Checklists. The page
leads with an overview (the "main manual") and then has one short section per core
area of the trip workspace.

Presentation only — no database, no migration, no new dependencies, no
interactivity. The copy is written to match today's shipped behavior at an
orientation depth (2–4 sentences per area) so it stays accurate as features evolve.

## Why

The app has grown a lot of capability (locations with date spans, dreams, settle-up,
mini-events, drag-to-reschedule). A new user — or the partner who didn't build it —
needs a calm place to learn what each surface is for. A nav destination is the
simplest home for it and reuses the existing `Checklists` nav pattern exactly.

## Scope

**In:** an overview intro plus four sections of the **core trip workspace**:
Trips & Dreams, Itinerary, Packing, Budget & Expenses.

**Out (for now):** Home / On the road / Checklists sections, setup/account (pairing,
dark mode), the Assistant section, per-section header deep-links, search, any
interactivity.

## Design

### 1. Navigation wiring — `src/components/app-nav.tsx`

- Add `"manual"` to the `NavKey` union.
- `buildNavDestinations` appends `{ key: "manual", label: "Manual", href: "/manual" }`
  after the Checklists entry. This makes it a permanent destination on the desktop
  `LeftRail` on every page.
- Append `"manual"` to `MOBILE_NAV_ORDER` so it is reachable in the mobile prev/next
  arrow cycle (`home → trip → on-the-road → manual`).
  - Tradeoff considered: making it desktop-only like Checklists. Rejected — that
    leaves mobile with no way into a help page, which defeats the purpose. The cost
    is one extra stop in the arrow cycle, which is acceptable.

### 2. Route — `src/app/manual/page.tsx`

Mirrors `src/app/checklists/page.tsx`:

- Auth guard → `redirect("/signin?next=/manual")` when signed out.
- `getCurrentWorkspace()` → `redirect("/home")` when none.
- `listTripsForWorkspace(workspace.id)` to derive nav buckets (hero + on-the-road),
  exactly as Checklists does, so the rail/arrows render correctly.
- Same shell: `max-w-[440px] lg:flex` wrapper, `LeftRail` with `current="manual"`,
  `MobileHeaderNav` with `current="manual"`, a `Label` heading.
- No `AiSuggestion` card (reference page, not a trip surface).
- Renders one static content component.

### 3. Content — `src/app/manual/manual-content.tsx`

A server component using the existing `together` typography utilities (`t-display`
serif headings, `t-label` mono kickers, `Coord`, sand/sea tints). Each section is a
client `Section` (`src/app/manual/manual-section.tsx`, `"use client"`) with a
`more`/`less` toggle that expands a numbered step-by-step walkthrough (`Steps` /
`Step` helpers). The step content is passed as a static `details` JSX prop —
server-rendered, crosses the RSC boundary as serializable JSX. Sections open
independently (each holds its own `useState`).

Structure:

- **Overview** — what Together is for (the shared trip, both partners contributing)
  and how the app is laid out (Home, the trip workspace tabs, On the road, Checklists).
- Four section blocks, each with an anchor `id` for future deep-linking:
  - `#trips` **Trips & Dreams** — dated trips vs. dateless dreams; creating one;
    promoting a dream to a dated trip.
  - `#itinerary` **Itinerary** — locations with optional date spans, days and
    mini-events, drag-to-reschedule, empty-day slots; dreams get numbered days.
  - `#packing` **Packing** — the shared live list, categories, importing from a
    checklist.
  - `#budget` **Budget & Expenses** — planning per location, logging expenses,
    settle-up, saved contributions.

Each block is a short serif heading + 2–4 sentences of warm, plain copy.

## Verification

- `pnpm lint` and `pnpm build` clean.
- Manual appears on the desktop rail and in the mobile arrow cycle on every page.
- `/manual` renders the overview + four sections, styled consistently with the rest
  of the app, on a 390px phone viewport and desktop.
