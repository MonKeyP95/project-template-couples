# PLAN.md

## Phases (collapsed and concrete)

**Phase 1 — Foundation**
Next.js 16 + TypeScript + Tailwind v4 scaffolded *(done 2026-05-25)*. Shadcn/ui installed. Supabase project created. Deployed to Vercel.

**Phase 2 — Auth + Pairing**
Sign up, log in, invite partner, shared workspace exists in the database with RLS.

**Phase 3 — First Trip**
Create a trip. Trip has members, dates, destination. Shared trip todo / packing list works for two users in real time.

**Phase 4 — Trip Depth**
Budget + expense splitting. Itinerary days. Notes. This is the first "real" version we'd use end-to-end on a trip.

**Phase 5 — AI assistant**
Itinerary drafting, restaurant suggestions, packing-list hints. One provider (Claude), one model, kept modular behind a thin interface.

**Phase 6 — Integrations (optional)**
Google Calendar, Google Maps, restaurant booking — only the ones we actually want on our own trips.

## Current Phase
**Phase 1 — Foundation**

## Sequencing rules
- Do not start Phase N+1 until Phase N has been used on a real trip (or, for Phase 1–2, until it actually works end-to-end).
- One small task at a time. Validate each increment.
- If a task in `TODO.md` grows beyond a session, split it.
- If a feature isn't being used after a trip, cut it before adding more.

## Data model principle
Model the shared surface as a **workspace (1..N members with roles)** from day one, not as a strict "couple of 2." The MVP only exposes 2-member workspaces, but the schema supports families and future expansion without a rewrite.
