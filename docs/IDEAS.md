# IDEAS.md

Differentiating feature ideas — brainstormed, **not committed scope**. These lean into what's uniquely Together's (shared workspace, the learning taste/budget profile, two-modes, dreams → trips) rather than generic travel-app features. Promote an idea to `FEATURES.md` / `PLAN.md` only after it's brainstormed into a real design.

## On-the-road "what now?" concierge

When today falls inside a trip's dates (the existing dates-driven **on-the-road** mode), the assistant flips from planner to concierge. Instead of "help me draft an itinerary," it answers "what should we do *right now*?" — context-aware of weather, time of day, where you are in the itinerary, and closures.

- Example: "It's raining and your museum is closed — here are two indoor picks that match your taste, 8 min away."
- Builds directly on the committed two-modes principle ([[project-two-modes-planning-vs-road]]) and the taste profile.
- Same AI seam (`lib/ai/claude.ts`), different prompt/tools depending on mode.

## The trip journal that writes itself

While on the road, passively assemble a lightweight log from what *actually happened* — expenses imply meals/activities, itinerary implies places visited. Minimal manual entry.

- Post-trip, this becomes the shareable per-trip summary that already feeds the profile ([[project-trip-summary-as-shareable-unit]]).
- Closes the loop: dream → trip → journal → profile → next dream.
- Distinct from a photo-sharing feature; the point is a low-effort record derived from data the app already holds.

---

_Parked (from the same brainstorm, not chosen yet): taste reconciliation / "where we overlap", silent voting on dreams, cross-trip fair-split intelligence, couple compatibility matchmaking._
