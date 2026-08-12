# Dispatch card actions — press an item, add it or learn more

Date: 2026-08-12
Status: spec, not implemented

## Problem

The rotating dispatch box at the top of `/on-the-road` finds real things happening
where the couple is — a meteor shower, a saint's day market, a ferry strike. Today
every card is read-only by design: title, one line, a window, a source link. The
box rotates past a find and it is gone.

So the box tells them a meteor shower peaks on Tuesday and then offers nothing to
do about it. Getting it onto Tuesday means reading the card, remembering it,
scrolling to Today or the itinerary, and retyping it.

## What we are building

Press a dispatch item. The rotation stops and two actions appear:

- **add to a date** — the item becomes an itinerary event on a chosen day and time.
- **learn more** — an expansion of the search on that one item, rendered inline,
  with a free-text box for follow-up questions.

Both live on the card itself. Nothing navigates away.

## Mode

On-the-road only. The dispatch box exists nowhere else, so there is no
planning-mode counterpart in this slice.

## Interaction

The card body becomes a press target. The source link stays a link (pressing it
opens the source, it does not expand the card).

```
┌─────────────────────────────────────┐
│ WHAT'S ON                           │
│ Perseid meteor shower               │  ← press anywhere here
│ Peak overnight, clear skies inland. │
│ TUE 12 AUG                          │
└─────────────────────────────────────┘
        ↓ pressed
┌─────────────────────────────────────┐
│ WHAT'S ON                     [×]   │
│ Perseid meteor shower               │
│ Peak overnight, clear skies inland. │
│ TUE 12 AUG · source                 │
│                                     │
│  [ add to a date ]  [ learn more ]  │
└─────────────────────────────────────┘
```

Rules:

- Expanding stops the rotation timer. The dots stay live — selecting another dot
  collapses the expanded card and moves to that one.
- `×` collapses and the timer resumes.
- All three kinds (`whats_on`, `disrupted`, `conditions`) get both actions. A ferry
  strike is worth putting on Tuesday too.
- The weather card is untouched: no press, no actions.
- Only one card is expanded at a time.

### add to a date

Reveals the same confirm row shape the discovery door uses:

- A day dropdown of the trip's itinerary days, labelled `{dow} {dom} {mon}`,
  defaulting to today.
- If the trip has no itinerary days at all, a date input defaulting to today
  instead of the dropdown. `addTodayEvent` creates the day in that case — the path
  it already handles.
- A time field (optional, free-typed, normalized on blur: `18` -> `18:00`).
- An `add` button; a `×` cancels back to the two actions.

On success the button is replaced by an `added` pill and `router.refresh()` runs,
so the Today section below picks the event up when it lands on today.

What gets written, via the existing `addTodayEvent` server action:

| field | value |
|---|---|
| `text` | `item.title` |
| `url` | `item.sourceUrl` |
| `time` | the normalized time, or empty |
| `category` | `"Activities"` for `whats_on`; omitted for `disrupted` and `conditions` |
| `dayId` / `dayDate` | from the picker |

### learn more

Calls the server action, then renders inline under the two buttons:

- A short paragraph — what it is, where, when exactly, cost, how to get there.
- Two to three links (label + url), each opening in a new tab.
- A persistent free-text input, placeholder `ask about this…`, with a send
  affordance. Submitting re-runs the same call carrying the question; the answer
  replaces the paragraph and links. The input stays for the next question.

While in flight: `learning…` on the button (or the input disabled). Errors render
as a single clay-coloured line, matching `DiscoverySection`.

The fetched detail is held in component state, so collapsing and re-expanding the
same card does not re-fetch. Nothing is persisted — a page reload starts clean.

## Data path

### 1. New tool: `propose_detail` (`src/lib/ai/registry.ts`)

```
{
  detail: string,           // 2-4 sentences, no preamble
  links: [{ label, url }]   // 0-3, real URLs from the search
}
```

`strict: true`, `additionalProperties: false`, both keys required — matching
`propose_dispatch`.

### 2. New agent: `src/lib/ai/agents/dispatch-detail.ts`

A descriptor in the same shape as `dispatch.ts`:

- `model: "claude-sonnet-4-6"`, `tools: ["web_search_short", "propose_detail"]`,
  `mcpServers: []`.
- Input `DispatchDetailQuery`: `{ place, dayDate, item: DispatchItem, question }`.
- System prompt keeps the dispatch discipline: search first, then call
  `propose_detail`; never invent a URL, a price, or a time; never ask questions
  back; keep it short.
- The prompt builder branches on one field only:
  - `question` empty → "tell them what they would want to know before deciding to
    go: what it is, where, when exactly, what it costs, how to get there."
  - `question` present → answer that question about this item.
- `parseOutput` finds the `propose_detail` tool_use block and returns
  `{ detail, links }`; returns an empty detail when the model finishes without
  proposing.

Exported as `generateDispatchDetail` and re-exported from `src/lib/ai/claude.ts`,
which stays the import seam.

`DispatchDetail` (`{ detail: string; links: { label: string; url: string }[] }`)
goes in `src/lib/trips/dispatch-types.ts` — already client-safe, no `server-only`,
so the card can import it (the `*-types.ts` split rule).

### 3. Server action: `learnAboutItem` (`src/lib/trips/dispatch-actions.ts`)

```
learnAboutItem(
  tripSlug: string,
  dayDate: string,
  itemIndex: number,
  question: string,
): Promise<{ detail?: DispatchDetail; error?: string }>
```

- AI-gated (`isAiEnabled`) and workspace-guarded (`getCurrentWorkspace` +
  `getTripBySlug`), exactly like `ensureDispatch` above it.
- Reads the stored dispatch row with `getDispatchForDay(trip.id, dayDate)` and
  takes `items[itemIndex]` **server-side**. The client's copy of the item is never
  trusted as prompt input.
- Re-derives `place` the same way `ensureDispatch` does: today's itinerary
  location name, else `trip.country`, else `trip.name`.
- Returns `{ error }` on a missing trip, missing row, or out-of-range index.
  Nothing is written and nothing is revalidated.

A server action rather than a route: the discovery door needed a route, this
needs less, and `dispatch-actions.ts` is already where dispatch server work lives.

### 4. Components

`src/components/dispatch-box.tsx` keeps the deck — rotation, dots, weather, the
client/SSR split. It gains `expandedIndex` state; the interval effect skips while
it is non-null, alongside the existing `paused` and `reduced` guards.

`src/components/dispatch-item-card.tsx` is new (client): the item card, its
expanded state, the add row, and the learn-more panel. Moving it out keeps the
deck file about what it is now and stops one file owning both rotation and
actions.

`DispatchBox` gains four props — `tripId`, `tripSlug`, `days`, `today` — and
passes them to each item card. `/on-the-road/page.tsx` already has all four in
scope (`trip`, `days` from `getItineraryDays`, `today` from `localToday`); `days`
is mapped down to `{ id, dayDate, label }` at the call site.

### 5. Shared helper

`normalizeTime` currently lives inside `discovery-section.tsx`. It moves to
`src/lib/trips/event-time.ts` and both files import it. The confirm row itself is
rebuilt inline in the item card (about 25 lines) rather than extracted from the
330-line `DiscoverySection` — refactoring a working component is not part of this
slice.

## Edge cases

- **AI mode off**: dispatch rows are never generated, so there are no item cards
  to press. If a row from an earlier AI-on session is on screen, `learnAboutItem`
  returns "AI mode is off." and the card shows that line. Adding to a date still
  works — it does not touch the AI.
- **Item index drift**: the stored row is immutable once written for a day, so the
  index the card renders is the index the action reads.
- **No itinerary days**: date input instead of dropdown; `addTodayEvent` creates
  the day with title "Today".
- **Deck grows while expanded**: the deck grows when `DispatchTrigger`'s
  `router.refresh()` lands the generated items. That trigger only renders when
  there is no dispatch row yet, so the only card on screen at that moment is
  weather, which cannot be expanded. `expandedIndex` is therefore always null when
  the deck grows; the existing index clamp keeps handling the rotation side.
- **Reduced motion**: rotation is already off; expanding and collapsing behave the
  same, just with no timer to stop.

## Out of scope

- Persisting the learn-more answer. It is page-lifetime state.
- A conversation thread. Each question replaces the previous answer; there is no
  history and no follow-up context beyond the item itself.
- Adding a dispatch item as an expense, a note, or a budget line.
- Any planning-mode surface for dispatch.
- Extracting the discovery confirm row into a shared component.

## Success criteria

### Verified by Claude

1. `pnpm build` passes and `pnpm lint` is clean.
2. `propose_detail` is registered in `registry.ts` and resolves through
   `resolveTools`; `dispatch-detail.ts` lists it plus `web_search_short`.
3. `generateDispatchDetail` is exported from `src/lib/ai/claude.ts` and no caller
   imports the agent module directly.
4. `learnAboutItem` reads the item from `getDispatchForDay` and never from its own
   arguments — the client passes an index, not an item.
5. `learnAboutItem` returns `{ error }` (and makes no model call) when AI mode is
   off, when there is no workspace, when the trip slug does not resolve, or when
   `itemIndex` is out of range.
6. The add path calls `addTodayEvent` with `text = item.title`,
   `url = item.sourceUrl`, and `category = "Activities"` only for `whats_on`.
7. `normalizeTime` lives in `src/lib/trips/event-time.ts`, is imported by both
   `discovery-section.tsx` and the item card, and still returns `"18:00"` for
   `"18"`, `"09:05"` for `"9:5"`, `""` for `""`, and leaves unrecognized input
   unchanged.
8. `dispatch-item-card.tsx` imports only from `*-types.ts` modules, not from
   `*-queries.ts` (the client-bundle split rule).
9. The rotation interval effect in `dispatch-box.tsx` returns early while
   `expandedIndex` is non-null.

### Verified by the user in-app

1. On `/on-the-road` with a dispatch item on screen, pressing the card expands it
   and the rotation stops — it stays on that card indefinitely.
2. `×` collapses the card and the rotation resumes.
3. Pressing the source link opens the source and does not expand the card.
4. `add to a date` shows a day dropdown defaulting to today plus a time field;
   `add` puts the item on the chosen day, and the `added` pill appears.
5. An item added to today shows up in the Today section below without a manual
   reload.
6. The added event opens the source URL from the itinerary, and a `whats_on` item
   defaults to the Activities category in the event's expense form.
7. `learn more` returns a paragraph plus links within a few seconds, rendered
   inside the card.
8. Typing a question in `ask about this…` replaces the answer with one addressing
   the question; the box stays for another question.
9. Collapsing and re-expanding the same card shows the last answer without
   re-searching.
10. All of the above works on a phone viewport: the expanded card does not
    overflow, and the box growing does not push the page around unpleasantly.
11. Weather is still just weather — pressing it does nothing.
