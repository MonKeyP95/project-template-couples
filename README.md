# Together

**Plan trips and life together — for couples and families.**

A shared space for couples and families to plan trips: itineraries, budget, packing lists, restaurant ideas, and dream destinations. Calm, collaborative, mobile-first.

---

## Why this exists
Cozi is a family calendar. Wanderlog is solo-friendly trip planning. TripIt aggregates reservations. None of them are built around **the shared trip** — both partners contributing, splitting expenses inside the trip, and drafting itineraries together with an AI assistant that knows both people's preferences.

This is also a personal learning project that will be used in real life by me and my partner.

## MVP scope (deliberately tiny)

1. Auth + couple/family pairing
2. Create a trip (name, dates, destination, members)
3. Shared trip todo / packing list

Everything else (budget, itinerary days, AI assistant, integrations, dream board) is post-MVP. See `docs/FEATURES.md`.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript**
- **Tailwind CSS** + **Shadcn/ui**
- **Supabase** (Postgres + Auth + RLS) — using `supabase-js` directly for MVP
- **Anthropic Claude** for AI features
- **Vercel** for deployment

## Documentation
- [VISION](docs/VISION.md) — purpose, target users, "why us"
- [FEATURES](docs/FEATURES.md) — MVP vs. later
- [PLAN](docs/PLAN.md) — phased roadmap
- [DESIGN](docs/DESIGN.md) — visual language
- [TECH](docs/TECH.md) — stack and rationale
- [DECISIONS](docs/DECISIONS.md) — non-obvious choices and why
- [TODO](docs/TODO.md) — current task list

## Development approach
- One small task at a time. Validate each increment.
- Root cause before fix. No speculative patches.
- Don't over-engineer — this is a learning project, not a product to scale.
