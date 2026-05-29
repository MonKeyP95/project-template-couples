# PLAN.md

## Phases (collapsed and concrete)

**Phase 1 — Foundation**
Next.js 16 + TypeScript + Tailwind v4 scaffolded *(done 2026-05-25)*. Shadcn/ui installed. Supabase project created. Deployed to Vercel.

**Phase 2 — Auth + Pairing**
Sign up, log in, invite partner, shared workspace exists in the database with RLS.

**Phase 3 — First Trip**
Create a trip. Trip has members, dates, destination. Shared trip todo / packing list works for two users in real time.

**Phase 3.5 — Basic CRUD (carve-out 2026-05-27)**
The minimum input surface needed to actually field-test the app on a real trip. Phase 3 shipped read + toggle but no create flows — meaning the only way to add data was the Supabase Table Editor, which isn't a real test. Three add-flows belong here, before the trip, not in Phase 4:
1. `+ add packing item` (per-category inline form).
2. `+ log expense` (modal or inline form with title / amount / category / paid_by / day).
3. `+ new trip` (name / slug / dates / country / optional lat-lng).
Once these ship, the "use it on a real trip" precondition for Phase 4 is satisfiable.

**Phase 4 — Trip Depth + Polish**
Likely candidates from the design handoff: per-trip notes, multi-trip support beyond the seeded Lombok, profile avatar uploads, richer itinerary editing. Don't pre-commit to the list — write it after the trip, based on signal.

**Phase 5 — AI assistant**
Itinerary drafting, restaurant suggestions, packing-list hints. One provider (Claude), one model, kept modular behind a thin interface.

**Phase 6 — Integrations (optional)**
Google Calendar, Google Maps, restaurant booking — only the ones we actually want on our own trips.

## Current Phase
** Phase 4 (dream-trip pipeline + edit trip) shipped 2026-05-28. Phase 4.5 (trip notes) shipped 2026-05-28. Phase 4.6 (inline itinerary editing for dated trips) shipped 2026-05-28. Slice B (itinerary for dreams) and Slice C (drag-to-reschedule) are tracked as carried in `TODO.md`, intentionally. Backlog (`TODO.md`) holds five gap-fill items from the 2026-05-28 doc audit — to be triaged against actual pain on the trip.

## Sequencing rules
- One small task at a time. Validate each increment.
- If a task in `TODO.md` grows beyond a session, split it.

## Data model principle
Model the shared surface as a **workspace (1..N members with roles)** from day one, not as a strict "couple of 2." The MVP only exposes 2-member workspaces, but the schema supports families and future expansion without a rewrite.
