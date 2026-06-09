# HeroCard schematic route panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-only, same-size panel to the right of the home hero card that shows the hero trip's locations as a schematic (non-geographic) route.

**Architecture:** A pure SVG server component (`TripRoutePanel`) renders the ordered location names along a deterministic wandering path on the existing topo texture, with a quiet `// map` fallback when a trip has no locations. The home page fetches the hero trip's locations via the existing query and renders hero + panel in a 50/50 desktop grid.

**Tech Stack:** Next.js 16 App Router (Server Components), React 19, Tailwind v4, existing `together` design components.

**Validation note:** This repo has **no test harness** (CLAUDE.md: do not invent one). Each task is validated with `pnpm lint`, `pnpm build`, and a visual check — not unit tests.

---

## File Structure

- **Create** `src/app/home/trip-route-panel.tsx` — the `TripRoutePanel` server component plus its pure helpers (`seedFromSlug`, `routePoints`, `polyline`). One responsibility: render the schematic route panel.
- **Modify** `src/app/home/page.tsx` — fetch the hero trip's locations and render the 50/50 hero+panel row.

No other files change. Reuses `slugToTone` (`@/lib/trips/slug-tone`), `TopoBg` (`@/components/together`), and `getItineraryLocations` (`@/lib/trips/location-queries`).

---

### Task 1: `TripRoutePanel` component

**Files:**
- Create: `src/app/home/trip-route-panel.tsx`

- [ ] **Step 1: Write the component file**

```tsx
import { TopoBg } from "@/components/together"
import { slugToTone } from "@/lib/trips/slug-tone"

const surface: Record<"sea" | "clay" | "moss" | "sand", string> = {
  sea: "bg-sea-tint",
  clay: "bg-clay-tint",
  moss: "bg-moss-tint",
  sand: "bg-sand-tint",
}

const VIEW_W = 320
const VIEW_H = 200
const PAD_X = 38
const PAD_Y = 46

type Pt = { x: number; y: number }

/** Small stable integer from a slug, so each trip's curve is distinct. */
function seedFromSlug(slug: string): number {
  let s = 0
  for (let i = 0; i < slug.length; i++) s = (s + slug.charCodeAt(i)) % 997
  return s
}

/**
 * Deterministic wandering points across the viewBox. Decorative layout for the
 * schematic route -- not real geography.
 */
function routePoints(n: number, seed: number): Pt[] {
  const span = VIEW_W - PAD_X * 2
  const amp = VIEW_H / 2 - PAD_Y
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const wobble = Math.sin((i + 1) * 1.7 + seed)
    return { x: PAD_X + t * span, y: VIEW_H / 2 + wobble * amp }
  })
}

function polyline(pts: Pt[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ")
}

/**
 * Desktop-only schematic route shown beside the hero card. `locations` are the
 * trip's location names in order. With zero locations it shows a quiet
 * placeholder awaiting the real interactive map (a later stage).
 */
export function TripRoutePanel({
  slug,
  locations,
}: {
  slug: string
  locations: string[]
}) {
  const tone = slugToTone(slug)
  const hasRoute = locations.length > 0
  const pts = routePoints(Math.max(locations.length, 1), seedFromSlug(slug))
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-md">
      <div className={`relative aspect-[16/10] overflow-hidden ${surface[tone]}`}>
        <TopoBg tone={tone} opacity={0.16} />
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="relative h-full w-full"
        >
          {hasRoute ? (
            <>
              <polyline
                points={polyline(pts)}
                fill="none"
                stroke="var(--moss)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={5} fill="var(--foreground)" />
                  <text
                    x={p.x}
                    y={p.y + (p.y > VIEW_H / 2 ? 16 : -10)}
                    textAnchor="middle"
                    fontFamily="monospace"
                    fontSize={9}
                    fill="var(--muted-foreground)"
                  >
                    {locations[i]}
                  </text>
                </g>
              ))}
            </>
          ) : (
            <>
              <circle cx={VIEW_W / 2} cy={VIEW_H / 2} r={6} fill="var(--clay)" />
              <text
                x={VIEW_W / 2}
                y={VIEW_H / 2 + 26}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize={10}
                letterSpacing={2}
                fill="var(--muted-foreground)"
              >
                {"// map"}
              </text>
            </>
          )}
        </svg>
      </div>
      <div className="px-4 py-3 md:px-5 md:py-3.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {hasRoute
            ? `${locations.length} stop${locations.length === 1 ? "" : "s"} · route`
            : "route"}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint the new file**

Run: `pnpm lint`
Expected: no errors. (Note the React 19 gotcha is already handled: the `// map` label is written as the JSX expression `{"// map"}`, not bare text.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds. `TripRoutePanel` is unused for now, which is fine — it compiles.

- [ ] **Step 4: Commit**

```bash
git add src/app/home/trip-route-panel.tsx
git commit -m "feat(home): add schematic TripRoutePanel component"
```

---

### Task 2: Render the panel beside the hero

**Files:**
- Modify: `src/app/home/page.tsx`

- [ ] **Step 1: Add the imports**

In `src/app/home/page.tsx`, alongside the existing `./trip-cards` import (`CompactRow, DreamTile, HeroCard, TripCard`), add the new imports:

```tsx
import { getItineraryLocations } from "@/lib/trips/location-queries"

import { CompactRow, DreamTile, HeroCard, TripCard } from "./trip-cards"
import { TripRoutePanel } from "./trip-route-panel"
```

(Keep the existing `./trip-cards` import line; just add the `getItineraryLocations` import with the other `@/lib` imports and the `TripRoutePanel` import next to `./trip-cards`.)

- [ ] **Step 2: Fetch the hero trip's location names**

Immediately after the `hero` constant is computed:

```tsx
const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
```

add:

```tsx
const heroLocations = hero
  ? (await getItineraryLocations(hero.id)).map((l) => l.name)
  : []
```

- [ ] **Step 3: Render hero + panel in a 50/50 grid**

Replace this block:

```tsx
              <div className="md:grid md:grid-cols-2 md:gap-5 lg:grid-cols-3">
                <HeroCard trip={hero} />
              </div>
```

with:

```tsx
              <div className="md:grid md:grid-cols-2 md:gap-5">
                <HeroCard trip={hero} />
                <div className="hidden md:block">
                  <TripRoutePanel slug={hero.slug} locations={heroLocations} />
                </div>
              </div>
```

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Visual check**

Run: `pnpm dev`, open http://localhost:3000/home on a desktop-width viewport.
Expected:
- A panel sits to the right of the hero card, the same height/footprint.
- If the hero trip has locations, a moss route line threads labeled pins; the footer reads `N STOPS · ROUTE`.
- If it has none, a single clay pin with a `// map` label; footer reads `ROUTE`.
- At a phone width (≤768px) the panel is hidden and the hero looks exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/app/home/page.tsx
git commit -m "feat(home): show schematic route panel beside the hero"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Update TODO and DECISIONS**

Add a line to `docs/TODO.md` recording the schematic route panel as done.

Append a row to `docs/DECISIONS.md` capturing: the hero-adjacent route panel is **schematic, not geographic**, because `itinerary_locations` has no coordinates; a real interactive map (per-location lat/lng + geocoding) is a deferred later stage.

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record HeroCard schematic route panel"
```

---

## Self-Review

- **Spec coverage:** placement/50-50 grid (Task 2 Step 3), desktop-only `hidden md:block` (Task 2 Step 3), `TripRoutePanel` server component + `routePoints` seeded by slug (Task 1), schematic route from real names (Task 1), zero-location fallback (Task 1), data via `getItineraryLocations` (Task 2 Step 2), deferred-map reminder recorded (Task 3). All covered.
- **Placeholders:** none — full code in every code step.
- **Type consistency:** `routePoints(n, seed)`, `seedFromSlug(slug)`, `polyline(pts)`, and `TripRoutePanel({ slug, locations })` are used consistently across tasks; `getItineraryLocations` returns objects with `.name`, matching `location-queries.ts`.
