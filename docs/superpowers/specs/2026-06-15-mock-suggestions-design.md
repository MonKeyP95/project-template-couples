# Mock AI suggestions (everywhere else)

Date: 2026-06-15
Status: approved (design)

## Goal

Bring the moss-bordered `SuggestionCard` — already used as a static placeholder
in Packing and Itinerary — to the rest of the app, driven by a mock seam. Each
surface shows one canned, plausible suggestion in the existing style; the user
can dismiss it. Built mock-first: no API, no cost. When a real model lands later,
only the seam changes.

Part of Phase 5. No Anthropic SDK, no API route, no tables.

## Scope

In scope:
- A pure seam `suggestionFor(surface, context?)` returning a canned suggestion.
- A client wrapper `<AiSuggestion surface=… />` that renders `SuggestionCard`,
  with a working dismiss (hides for the session) and an inert apply.
- One backward-compatible addition to `SuggestionCard`: optional `onApply` /
  `onDismiss` callbacks.
- Placements on: Budget view, the trip page (trip-level, above tabs), Notes,
  Home, On the road, Checklists overview.

Explicitly deferred:
- The real model (provider/key/route/cost) and trip-aware `context`.
- A working apply (it stays an inert placeholder, like today's cards).
- Persisted / shared dismissal (dismissal is session-only, per device).
- Migrating the existing Packing & Itinerary static cards onto the seam (left
  as-is to keep scope tight; can unify later).

Note: there is no "trip overview" tab (tabs are Budget / Packing / Itinerary /
Notes). The "trip" surface is a trip-level suggestion rendered at the top of the
trip page, visible on every tab.

## The seam

`src/lib/ai/suggestions.ts`:

```ts
export type SurfaceKey =
  | "budget"
  | "trip"
  | "notes"
  | "home"
  | "road"
  | "checklists"

export interface Suggestion {
  /** Card label, e.g. "/ suggested". */
  label: string
  /** One-line suggestion body. */
  body: string
}

/**
 * Mock: a deterministic, plausible suggestion per surface (same spirit as the
 * existing Packing/Itinerary cards). Returns null when there's nothing to
 * suggest. `context` is reserved for the real model and ignored by the mock.
 * Real later: make this async and generate from the LLM client; the render is
 * unchanged.
 */
export function suggestionFor(
  surface: SurfaceKey,
  context?: string,
): Suggestion | null
```

Mock content (deterministic, no network) — one per surface, e.g.:
- `budget`: "/ suggested" — "Lombok street food is cheap — you could trim the
  food estimate and pad activities."
- `trip`: "/ assistant" — "Rinjani trek permits sell out in peak season — worth
  booking early."
- `notes`: "/ suggested" — "Jot the dive shop's number and your guesthouse
  check-in time so they're handy on the road."
- `home`: "/ assistant" — "Your next trip is coming up — a good moment to start
  the packing list together."
- `road`: "/ assistant" — "Log expenses as you go today so the settle-up stays
  honest."
- `checklists`: "/ suggested" — "Reuse a past list as a starting point instead
  of building from scratch."

(Exact strings live in the module; they are placeholders, easy to swap.)

## Components

### `SuggestionCard` change (backward-compatible)

Add optional `onApply?: () => void` and `onDismiss?: () => void` to
`SuggestionCardProps`. When provided, the matching button calls the handler;
when absent, the button renders exactly as today (inert). No existing call site
passes them, so Packing/Itinerary are unaffected.

### `src/components/ai-suggestion.tsx` (new, client)

```tsx
"use client"
export function AiSuggestion({ surface }: { surface: SurfaceKey }): JSX.Element | null
```
- Computes `suggestionFor(surface)` once.
- Holds `dismissed` state (default false).
- Returns `null` if there's no suggestion or it's been dismissed.
- Otherwise renders `SuggestionCard` with `label`, the `body` as children,
  `dismissLabel="dismiss"`, and `onDismiss={() => setDismissed(true)}`. Apply is
  omitted (so it stays inert / not shown), matching "apply inert".

This is an app component (it imports from `lib/ai`), kept out of the
design-system `together` library.

## Placements

Drop `<AiSuggestion surface="…" />` into each surface's existing layout, styled
to sit where a card naturally goes (matching the existing card placements):

- `budget` — in `budget-tab.tsx`, the `"budget"` view (near the planner).
- `trip` — in `trips/[slug]/page.tsx`, just below the trip hero / above the tab
  content, so it shows on every tab. (Client island in the server page.)
- `notes` — in `notes-tab.tsx`.
- `home` — on the Home page.
- `road` — on the On-the-road page.
- `checklists` — on the Checklists overview page.

## Data flow

```
Surface (tab/page)
  -> AiSuggestion surface=… (client)
       suggestionFor(surface): pure -> Suggestion | null
       dismissed? -> render nothing
       else -> SuggestionCard (dismiss hides; apply inert)
```

No server action, no API route, no DB.

## Error handling

`suggestionFor` (mock) cannot fail; it returns a `Suggestion` or `null`. The
wrapper renders nothing on `null`. No async, no failure path in this slice.

## Testing

No test framework in this repo; do not invent one. Verification is `pnpm lint` +
`pnpm build` passing, plus a manual check: each surface shows its suggestion
card in the right place; clicking dismiss hides it; it returns on reload; the
existing Packing/Itinerary cards are unchanged.

## Files

- New: `src/lib/ai/suggestions.ts`
- New: `src/components/ai-suggestion.tsx`
- Edit: `src/components/together/suggestion-card.tsx` (optional callbacks)
- Edit: `src/app/trips/[slug]/budget-tab.tsx`, `src/app/trips/[slug]/page.tsx`,
  `src/app/trips/[slug]/notes-tab.tsx`, the Home page, the On-the-road page, the
  Checklists overview page (add `<AiSuggestion>`).
- Edit: `docs/TODO.md`, `docs/DECISIONS.md`.
