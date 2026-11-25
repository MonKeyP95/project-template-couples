# Three full home ideas behind the pills

Step 1 of the next home slice (see `docs/TODO.md`). Steps 2 (accept without a
call) and 3 (earlier ideas list) are out of scope.

## Intent

Today one call makes a main idea card plus three short pill phrases; a pill is
only a phrase until tapped, which costs a call. Every option should be a real,
saved idea so liked ones can be revisited and compared without waiting or
paying again.

## What the user sees

- /home: the AI assistant box shows the text box and three pills, nothing open.
  No main idea card.
- Tap a pill: its saved idea opens at once (no call), the pill shows as active.
  Reload keeps the set.
- "another" on an opened idea: the next pill's idea opens (1 -> 2 -> 3 -> 1),
  no call.
- "↻ new ideas" after the pills: one call replaces all three. This is the old
  "another" on the main card, moved.
- "dismiss" closes the card; the pill stays.
- "let's do it" unchanged (opens `/trips/new` with the plan).
- A typed ask stays a one-off idea; its "another" is a fresh call for the same
  ask, as today.

## Approaches

- **One call returns all three (picked).** The model sees all three while
  writing, so it keeps them apart; input paid once.
- Three parallel calls: faster, but each is blind to the others (duplicates)
  and input is paid three times.
- One row per idea in a new table: that is step 3's table; building it now
  pulls step 3 forward.

## Design

- **Agent** `agents/trip-idea.ts`: the tool returns `ideas`, a list; each item
  has `pill` (2 to 5 words), `label` (destination), `body`, `plan` (same shape
  as today). The prompt says how many: three for the saved set, one for a typed
  ask. No more separate `options`. `maxTokens` about 6000.
- **Types**: `TripIdea` loses `options`, gains `pill`. The saved set is
  `TripIdea[]`.
- **Storage** `home_ideas`: new `ideas jsonb` column holds the set; `label`,
  `body`, `options`, `plan` are dropped. A row without `ideas` is made again
  once. Migration re-runnable; paste it at merge time (shared database).
- **Remake rule** unchanged: same fingerprint keeps the set; a change or
  "↻ new ideas" makes a new one.
- **UI** `ideas-line.tsx`: state is the set plus the open index (or a one-off
  idea). The main card and its "another" go away.

## Non-goals

- Accepting removing a pill, refilling when empty, trips leaving the
  fingerprint (step 2).
- Keeping old ideas, the "Earlier ideas" link (step 3).

## Success criteria

Verified by Claude:
1. `pnpm lint`, `tsc` and `pnpm build` pass.
2. The tool schema asks for `ideas` items with `pill`, `label`, `body`, `plan`;
   `parseOutput` returns a list.
3. `refreshHomeIdea` returns the saved set without a call when the fingerprint
   matches and `ideas` has items; otherwise it saves a new set of three.
4. The migration is safe to run twice.

Verified by the user in-app:
1. Paste the migration; open /home: after a moment three pills show, no idea
   card.
2. Tap a pill: its idea opens at once; reload, tap again: the same idea.
3. "another" opens the next pill's idea, and after the third the first.
4. "↻ new ideas": a moment, then three different pills; reload keeps them.
5. "let's do it" on any pill's idea opens the pre-filled new trip walk.
6. A typed ask gives one idea; "another" on it gives a different one.
7. Phone width: pills and "↻ new ideas" wrap, no sideways scroll.
