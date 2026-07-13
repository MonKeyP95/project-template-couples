# Profile-growth slice 3 — Accommodation & Transport learn from real expenses — design

Date: 2026-07-13
Status: ready for a plan
Refines: `2026-07-13-profile-growth-design.md` (slice 3 section). **Supersedes** that
section's "wire the trip-profile context header into each category run" framing —
see the reframe below.

## Goal

Extend the learned couple profile beyond Food/Activity to its two empty sections,
**Accommodation** and **Transport**, so `/profile` grows a "what we stay in / how we
get around" summary — both the general couple summary and the per-trip "By trip"
blocks (slice 2). These two categories learn from a **new signal source: the real
expenses** logged in the trip's Accommodation and Transportation budget categories.

## The reframe (decided with the user)

The parent spec framed slice 3 as "four categories + trip-profile context-header
routing." That is dropped. The trip profile (idea / transport chips / vibe) is
**guidance for the assistant** when it searches — and is already consumed there
(`buildAssistantContext`, discovery). It is **not** fed into the learned-summary runs.

Instead, the honest source for "what kind of accommodation/transport we actually
use" is the **real record**: the expenses the couple logged. An Accommodation
expense titled "Riad Dar Anika" or a Transportation expense titled "Rental car" /
"Night train to Fez" *is* the answer. Intent lives in the profile; the record lives
in the budget. These two categories learn from the record.

## Signal sources per category

| Category | Sources | Change |
|---|---|---|
| Food | rated + planned + wanted | unchanged |
| Activity | rated + planned + wanted | unchanged |
| **Accommodation** | **`used`** — titles of Accommodation-category expenses | new |
| **Transport** | **`used`** — titles of Transportation-category expenses | new |

- The new `used` signal reads the expense **title only, never the amount**. This is
  exactly the "money spent is a noisy taste proxy — a taxi fare is not a preference"
  concern the parent spec used to defer expenses; reading the descriptive title
  ("what we booked"), not the amount, sidesteps it. This is the parent spec's own
  stated escape hatch ("revisit only if the other signals prove too thin") — these two
  categories have no rated/planned source at all, so it is the justified place to use it.
- **Settlement rows are skipped** (`is_settlement = false`).
- Food and Activity deliberately gain **no** expense source. They already have rich
  signals, and food expenses are the noisy case the parent spec warned about. The new
  source is scoped to the two categories that need it.
- Detail tags on Accommodation/Transport are **not** counted (decided: expenses only).
  Those tags stay pure assistant-guidance; the learned summary is a record of what was
  actually used, not intent.

## The model

### Categories

`LearnedCategory` grows from `"food" | "activity"` to
`"food" | "activity" | "accommodation" | "transport"`.

### The `used` signal kind

`TasteSignal["kind"]` grows to `"rated" | "planned" | "wanted" | "used"`. A `used`
signal carries the expense title as `text` and no rating/note. It represents "a place
or mode we actually booked and paid for" — real behavior, weighted by the summariser
like a solid signal (below a `[loved]` rating, above a `[wanted]` intent tag).

### Category-name mapping

The expense-category *name* -> `LearnedCategory` map is extended to the full four:
`Food -> food`, `Activities -> activity`, `Accommodation -> accommodation`,
`Transportation -> transport` (the current 2-way `expenseCategoryToLearned` in
`discovery-types.ts` returns `null` for the latter two). The plan decides whether to
widen that helper's return type to `LearnedCategory` or add a learned-domain map in
`couple-summary-types.ts` (leaning the latter, to avoid a `discovery-types ->
couple-summary-types` dependency; `DiscoveryCategory` legitimately stays 2-valued
because discovery only *finds* food/activity places).

### Gather

Two new server-only helpers in `couple-summary-queries.ts`:

- `gatherSpentSignals(workspaceId, category)` — reads `expenses` joined to the
  workspace's trips, filtered to `category` in {Accommodation, Transportation} by the
  name map, `is_settlement = false`; each row -> `{ text: title, kind: "used" }`.
- `gatherTripSpentSignals(tripId, category)` — the same, filtered by `trip_id`.

`gatherTasteSignals` / `gatherTripTasteSignals` call the spent gather **only for
accommodation/transport** (food/activity keep their exact current three-source
gather). `countSignals` / `countTripSignals` are unchanged (they count whatever the
gather returns), so the display floor and staleness work for all four categories with
no further change.

### Render

- **General couple profile** (`/profile`): the two "empty" `CategorySection`s for
  Accommodation and Transport are replaced with the same `LearnedSummary` block Food
  and Activities use, gated by `countSignals(...) >= RATING_FLOOR`. The page adds
  `getCoupleSummary` + `countSignals` reads for `"accommodation"` and `"transport"`.
- **Per-trip "By trip" blocks**: `getTripLearnedBlocks` iterates all four categories
  instead of `["food", "activity"]`. The block's category label map (currently the
  inline `b.category === "food" ? "Food" : "Activities"`) is extended to name all four.
  Everything else in that render path is already category-generic.

### Actions

`refreshCoupleSummary` / `refreshTripSummary` / `saveCoupleSummary` /
`saveTripSummary` already take a `LearnedCategory` and upsert by `(scope, category)`.
Widening the type is the only change; no new action.

### Summariser prompt

`summarizeTaste` (`claude.ts`) learns the `used` kind: format a `used` signal as a
`[used]`-tagged line and instruct Claude to read it as "a place/mode the couple
actually booked on a trip — real behavior; describe the pattern (kind of stay, way of
getting around), not the specific booking." Weight it as a solid behavioral signal.
The noun the prompt summarises must vary by category (a "place to stay" /
"way of getting around", not "food"); confirm the existing per-category noun handling
covers the two new categories in the plan.

## Two modes

A `used` signal is a record of what happened, so Accommodation/Transport naturally
fill **during and after** a trip (when expenses are logged), not during pure planning.
This matches slice 2's "started or finished" gate on per-trip blocks — no mode toggle,
and no "summary of a trip we haven't taken." During planning the blocks simply stay
below the floor and don't render, which is correct.

## Floor and expected fill

Floor stays `RATING_FLOOR` (3 signals). Transport usually clears it within a trip
(fares, a rental, a train). Accommodation is often thinner per trip (1-2 bookings) but
the **general** couple summary aggregates expenses across all trips, so it fills as the
couple travels. Honest: thin early, richer over time — same shape as Food/Activity.

## Out of scope

- Expense **amounts** as a tier/band signal (deferred; titles only).
- Accommodation-type **chips** on the trip profile (rejected: reuse the budget record
  rather than build a parallel structured field).
- Food/Activity gaining an expense source (their existing signals are enough; food
  expenses are the noisy case).
- The trip-profile context-header routing from the parent spec (dropped; the profile is
  assistant-guidance, already consumed in discovery).
- Any change to how the assistant *consumes* the profile (prior-not-filter, taste dial).
- The rollup / summary-of-summaries and the retrieval harness (named north stars,
  slice 2 doc).

## Open questions for the plan (not the design)

- Exact `expenses` -> trips join shape for the workspace-scoped gather (mirror
  `gatherPlannedSignals`' `trips!inner(workspace_id)` pattern).
- Where the 4-way name map lives (helper widen vs new learned-domain map).
- Confirm `summarizeTaste`'s per-category noun/prompt already branches cleanly for two
  new categories, or add the branch.
- Confirm the per-trip label map is the only food/activity-hardcoded spot left in the
  render path.
