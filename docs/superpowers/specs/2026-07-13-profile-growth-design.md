# How the couple profile grows — design

Date: 2026-07-13
Status: ready for a plan (slice 1 first)

## Goal

Make the couple profile **grow from everything the couple leaves behind in the
app**, not just from ratings. Today the learned Food/Activity summaries are fed
only by `event_ratings`, and rating is the one thing couples rarely bother to do —
so the profile mostly stays empty. This slice-set broadens the input so an
un-rated place the couple planned and went to still teaches the profile.

The complement to [profile-aware suggestions](2026-07-13-profile-aware-suggestions-design.md):
that slice made the assistant *consume* the profile; this one makes the profile
*grow*. It explicitly declared "no change to how the couple profile grows (that is
its own future slice)" — this is that slice.

## Core principle: a rating is an amplifier, not the only source

The profile is an accretion of the couple's actual footprint in the app. Every
signal counts; a rating just **turns up the volume** on one.

- A **rated** place says "we loved this" — strong signal.
- An **un-rated but planned** place they added to the itinerary still says "we did
  this" — weak-but-real signal.
- A **detail tag** (Food -> sushi, burgers) says "this is what we mean by Food" —
  weak intent signal.

Both feed the same summary; the rating is expressed as a **strength tag on a line**
(`[loved · 5]` vs `[planned]` vs `[wanted]`), not as a gate on whether the line
exists at all. This directly answers "people won't rate much": an un-rated planned
place still produces a `[planned]` line.

This sits underneath the existing "profile is a prior, not a filter" principle —
we are widening what evidence flows *into* the prior, not changing how it is used.

## The model

### Signals and their strength

Each raw signal becomes one strength-tagged line in the summary corpus:

| Signal | Source | Strength tag | Routes to |
|--------|--------|--------------|-----------|
| Rated place | `event_ratings` (`event_text`, `rating`, `note`) | `[loved · N]` / `[liked]` / `[meh]` per rating | its category |
| Itinerary event, un-rated | itinerary events (text + expense-category tag) | `[planned]` | its category |
| Category detail tag | `expense_categories.details` | `[wanted]` | its named category |
| Trip profile | `trip_profile` jsonb (idea/vibe/transport) | context header | every category run for that trip |

**Routing.** Structured signals self-route: an itinerary event and a rating already
carry a category; a detail tag lives on a named expense category. The free-text
trip profile is *not* pre-routed — it is small (a line or two), so it is fed as a
short "trip context" header into each category's summary run and Claude pulls the
food-relevant bit into Food, the getting-around bit into Transport, etc. No brittle
keyword rules to maintain.

**Category mapping (the one wrinkle).** Ratings use the binary `LearnedCategory`
(`food` | `activity`). Itinerary events and detail tags use richer *expense*
category names (`Food`, `Activities`, `Transport`, ...). Slice 1 maps expense
`Food` -> food and `Activities` -> activity; other expense categories are out of
scope until the all-categories slice.

### Two summary levels

Same summariser, two scopes:

| Level | Scope key | Answers | Surfaced on |
|-------|-----------|---------|-------------|
| **Trip summary** | `(trip, category)` | "food-wise on *this* trip, you liked…" | the trip |
| **General summary** | `(workspace, category)` | "what do *we* like, in general" | the profile |

The general summary reads signals across **all** trips, so it gets richer with each
trip taken. The trip is the natural unit where enough signal accumulates to be
meaningful — **per-location was rejected** (a location rarely clears the 3-signal
floor, so it would produce thin summaries and wasted AI calls).

### How a summary is created (unchanged pipeline, broader input)

The existing pipeline stays intact — only step 1–2 (the corpus) changes:

1. **Gather** all signals for the scope + category (not just ratings).
2. **Format** into strength-tagged lines; prepend the trip-context header.
3. **Send to Claude** with the *current* summary and the instruction: weight
   `[loved]`/rated lines more, treat `[planned]`/`[wanted]` as lighter hints,
   evolve the existing summary rather than rewrite, keep hand-edits that still
   hold, return a few markdown bullets.
4. **Store** the markdown, stamped with the signal count it was built from.
5. **Staleness** = current signal count vs the stamp; >= 20% new triggers refresh.

### When it regenerates: lazy, on view

No cron, no queue (the app has neither). A summary regenerates the first time
someone opens its surface *after enough new signal has landed*:

- **Trip summary** — on opening that trip, if stale.
- **General summary** — on opening the profile, if stale (today's `LearnedSummary`
  auto-fire `useEffect`, generalized).

## Phasing

Three provable increments. Ship slice 1 first.

### Slice 1 — broaden the corpus (first)

Feed itinerary events (`[planned]`) and Food/Activity detail tags (`[wanted]`),
strength-tagged, into the **existing** general Food/Activity summaries. Rated lines
keep their rating in the tag.

- **No new tables, no new UI.** Touches `refreshCoupleSummary`'s gather step and
  the `summarizeTaste` prompt only.
- Add the expense-category -> `LearnedCategory` mapping (Food/Activities).
- Staleness now counts *signals*, not ratings — rename the stamp's meaning
  (column can stay `rating_count_at_generation`; it now holds a signal count).
- **Proves the core thesis** ("learn from un-rated behavior") with the smallest
  possible surface.

### Slice 2 — per-trip summaries

Add the `(trip, category)` scope: storage keyed by trip, a summary surface on the
trip page, lazy regenerate on trip open. General summary unchanged.

### Slice 3 — all four categories + trip-profile routing

Extend beyond Food/Activity to Accommodation and Transport (the empty profile-page
sections). Wire the trip-profile context header into each category run. Broaden the
expense-category mapping.

## Out of scope

- Any change to how the assistant *consumes* the profile (prior-not-filter,
  the taste dial) — already shipped, untouched here.
- Proactive/data-triggered suggestions and the clarify-then-act harness — a
  separate future slice.
- Expenses as a signal — considered and deferred: money spent is a noisy taste
  proxy (a taxi fare is not a preference). Revisit only if the other signals prove
  too thin.
- Background/scheduled regeneration — lazy-on-view is sufficient.

## Open implementation questions (for the plan, not the design)

- Exact itinerary-events query shape and how to exclude events that already have a
  rating (avoid double-counting the same place as both `[planned]` and `[loved]`).
- Whether the trip-context header meaningfully improves slice-1 output or should
  wait for slice 3 (it is only listed under slice 3 above; confirm during the plan).
