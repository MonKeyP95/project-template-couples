# Accommodation Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the assistant's find door discover a place to stay (area + price), adding a pick as a normal `Accommodation` itinerary event — in both planning and on-the-road modes.

**Architecture:** Reuse the existing category-parametrized discovery pipeline. Widen `DiscoveryCategory` with `"stay"`, add a `stay` branch to the seam (system + prompt) and the API route, add an area+price input branch to the shared `DiscoverySection`, and flip the two doors' `soon:` accommodation placeholders to live. No new query-type fields (area→`near`, price→`budgetBand`), no schema, no migration, no deps.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, the existing `discover` seam over Anthropic Claude with `web_search`.

## Global Constraints

- No test runner exists — validate every task with `pnpm lint` then `pnpm build`; both must pass clean. (`CLAUDE.md`)
- No migration, no new dependency, no new DB table in this slice. (spec)
- Food/activity discovery must stay byte-for-byte unchanged. (spec)
- Transport stays `soon:` — do not touch it. (spec)
- No emojis; sparse comments; short functions. (`CLAUDE.md`)
- An accommodation pick is a normal event tagged `Accommodation` — do not build lodging structure (nights/check-in/spans). (spec)
- Price band vocabulary is exactly `any | budget | mid | splurge`. (spec)
- Spec: `docs/superpowers/specs/2026-07-16-accommodation-discovery-design.md`.

---

### Task 1: Category + seam (`stay` branch in the discovery engine)

**Files:**
- Modify: `src/lib/ai/discovery-types.ts`
- Modify: `src/lib/ai/claude.ts` (`discoverySystem`, `discoveryPrompt`)

**Interfaces:**
- Produces: `DiscoveryCategory` now includes `"stay"`; `mapDiscoveryCategory("stay") === "Accommodation"`; `discoverySystem`/`discoveryPrompt` handle `"stay"`.
- Consumes: existing `DiscoveryQuery` fields `near` (area), `budgetBand` (price), `learned`, `taste`, `trip`.

- [ ] **Step 1: Widen the category union and the mapper**

In `src/lib/ai/discovery-types.ts`, change the type and rewrite the mapper to handle all three:

```ts
/** Which kind of place we are finding. Food, activity, and stay are live; the
 * door may show other categories as inactive. */
export type DiscoveryCategory = "food" | "activity" | "stay"

/** The expense category an event gets when added from the discovery door.
 * Resolved against the trip's real categories at expense time; falls back to
 * Other when the trip has no category by this name. */
export function mapDiscoveryCategory(category: DiscoveryCategory): string {
  if (category === "food") return "Food"
  if (category === "activity") return "Activities"
  return "Accommodation"
}
```

Leave `expenseCategoryToLearned` unchanged (it still returns `food`/`activity`/`null`; `"stay"` is never passed to it).

- [ ] **Step 2: Add the `stay` system prompt branch**

In `src/lib/ai/claude.ts`, `discoverySystem` — add a `stay` branch at the top, keep the existing food/activity body:

```ts
function discoverySystem(category: DiscoveryCategory): string {
  if (category === "stay") {
    return (
      "You help a couple find places to stay for a trip. Never ask the user " +
      "questions or reply conversationally — you cannot receive a reply. On every " +
      "request you MUST: (1) use the web_search tool to find real, currently-" +
      "operating places to stay in or near the destination, then (2) call " +
      "propose_places with 3 to 4 options. If their preferences are sparse, search " +
      "for well-regarded, broadly-appealing places to stay for that destination " +
      "anyway — do not ask for more detail. Every suggestion must come from a real " +
      "search result and include that result's URL as sourceUrl. Never invent a " +
      "place, a URL, or an exact price. Keep each 'why' to one sentence. When " +
      "choosing, weight the requested area and price band first, then this trip's " +
      "vibe and brief, then the couple's general tastes."
    )
  }
  const noun = category === "activity" ? "things to do" : "restaurants"
  return (
    `You help a couple find ${noun} for a trip. Never ask the user questions ` +
    "or reply conversationally — you cannot receive a reply. On every request you " +
    `MUST: (1) use the web_search tool to find real, currently-open ${noun} ` +
    "near the destination, then (2) call propose_places with 3 to 4 options. " +
    "If their preferences are sparse, search for well-regarded, broadly-appealing " +
    `${noun} for that destination anyway — do not ask for more detail. Every ` +
    "suggestion must come from a real search result and include that result's URL " +
    "as sourceUrl. Never invent a place, a URL, or an exact price. Keep each " +
    "'why' to one sentence. When choosing, weight what they are in the mood for " +
    "right now first, then this trip's vibe and brief, then the couple's general " +
    "tastes. If told they are on foot, only propose places genuinely within " +
    "walking distance of the given anchor — never somewhere that needs a car or a " +
    "long ride."
  )
}
```

- [ ] **Step 3: Add the `stay` prompt branch**

In `discoveryPrompt`, add a `stay` branch before the `activity` branch (it reuses the already-computed `learnedLine`, `dialLine`, `tripLines`; it deliberately omits the `moment` craving/walkable lines):

```ts
  if (query.category === "stay") {
    const areaLine = query.near ? `Preferred area: ${query.near}.` : ""
    const priceLine =
      query.budgetBand && query.budgetBand !== "any"
        ? `Price band: ${query.budgetBand}.`
        : ""
    return [
      `Find places to stay in ${query.destination}.`,
      areaLine,
      priceLine,
      learnedLine,
      dialLine,
      ...(tripLines.length ? ["This trip —", ...tripLines] : []),
    ]
      .filter(Boolean)
      .join(" ")
  }
```

- [ ] **Step 4: Lint + build**

Run: `pnpm lint`
Expected: clean (no new warnings).

Run: `pnpm build`
Expected: passes. (Nothing passes `"stay"` yet, so behavior is unchanged; this proves the types line up.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/discovery-types.ts src/lib/ai/claude.ts
git commit -m "feat(discovery): add stay category branch to the discovery seam"
```

---

### Task 2: API route accepts `stay` (area→near, price→budgetBand, learned→accommodation)

**Files:**
- Modify: `src/app/api/ai/discover/route.ts`

**Interfaces:**
- Consumes: `DiscoveryCategory` including `"stay"` (Task 1); `getCoupleSummary(workspaceId, category: LearnedCategory)`; `LearnedCategory` from `@/lib/preferences/couple-summary-types`.
- Produces: the route builds a valid `DiscoveryQuery` for a `stay` request — `near` = body area, `budgetBand` = body price band, learned summary from the `accommodation` couple summary.

- [ ] **Step 1: Add `price` to the body type and accept `stay`**

In `src/app/api/ai/discover/route.ts`, add `price?: string` to the body cast and extend the category parse:

```ts
    const body = (await request.json()) as {
      category?: string
      destination?: string
      when?: string
      tripId?: string
      craving?: string
      near?: string
      walkable?: boolean
      price?: string
    }
```

```ts
    const category: DiscoveryCategory =
      body.category === "activity"
        ? "activity"
        : body.category === "stay"
          ? "stay"
          : "food"
```

- [ ] **Step 2: Map the learned category and the price band**

Import `LearnedCategory` and derive both the summary category and `budgetBand` for stay:

```ts
import type { LearnedCategory } from "@/lib/preferences/couple-summary-types"
```

Replace the summary fetch and the `budgetBand` line:

```ts
    const learnedCategory: LearnedCategory =
      category === "stay" ? "accommodation" : category
    const summary = await getCoupleSummary(workspace.id, learnedCategory)
```

```ts
      budgetBand:
        category === "stay"
          ? String(body.price ?? "any").trim()
          : prefs.budgetBand,
```

(Leave `near: String(body.near ?? "").trim()` as-is — it now carries the area for stay; `craving`/`walkable` default empty/false for a stay request.)

- [ ] **Step 3: Lint + build**

Run: `pnpm lint`
Expected: clean.

Run: `pnpm build`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/discover/route.ts
git commit -m "feat(discovery): route accepts stay (area, price band, accommodation summary)"
```

---

### Task 3: `DiscoverySection` area+price inputs for `stay`

**Files:**
- Modify: `src/components/discovery-section.tsx`

**Interfaces:**
- Consumes: `DiscoveryCategory` including `"stay"` (Task 1); the route's `price` body field (Task 2).
- Produces: for `category === "stay"` the search shows area + price band inputs and sends `price` in the request; food/activity inputs unchanged.

- [ ] **Step 1: Add price state**

Near the other `useState` calls in `DiscoverySection`, add:

```ts
  const [price, setPrice] = React.useState("any")
```

- [ ] **Step 2: Send `price` in the discover request**

In `find()`, add `price` to the POST body (harmless for food/activity — the route ignores it there):

```ts
        body: JSON.stringify({
          category,
          destination,
          when,
          tripId,
          craving: craving.trim(),
          near: near.trim(),
          walkable,
          price,
        }),
```

- [ ] **Step 3: Branch the input row on category**

Replace the three-input block (the craving + near + walkable inputs inside the `suggestions === null` branch) with a category branch. For `stay`: area (into `near`) + price band buttons. Otherwise: the existing inputs unchanged.

```tsx
          {category === "stay" ? (
            <>
              <input
                type="text"
                value={near}
                onChange={(e) => setNear(e.target.value)}
                placeholder="which area? (optional)"
                className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
              />
              <div className="flex gap-1.5">
                {(["any", "budget", "mid", "splurge"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setPrice(b)}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
                      price === b
                        ? "border-transparent bg-foreground text-background"
                        : "border-rule text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <input
                type="text"
                value={craving}
                onChange={(e) => setCraving(e.target.value)}
                placeholder="what do you feel like? (optional)"
                className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
              />
              <input
                type="text"
                value={near}
                onChange={(e) => setNear(e.target.value)}
                placeholder="near…"
                className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
              />
              <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={walkable}
                  onChange={(e) => setWalkable(e.target.checked)}
                />
                walking distance
              </label>
            </>
          )}
```

Leave the `find` button below this block unchanged.

- [ ] **Step 4: Lint + build**

Run: `pnpm lint`
Expected: clean.

Run: `pnpm build`
Expected: passes. (Still only food/activity reach this component; stay renders once the doors are wired in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/components/discovery-section.tsx
git commit -m "feat(discovery): area+price inputs for the stay category"
```

---

### Task 4: Flip the two doors' accommodation placeholders live

**Files:**
- Modify: `src/app/trips/[slug]/find-a-place-planning.tsx`
- Modify: `src/app/on-the-road/find-a-place.tsx`

**Interfaces:**
- Consumes: `DiscoverySection` with `category="stay"` (Tasks 1–3).
- Produces: both doors show a live **Accommodation** category; transport stays `soon:`.

- [ ] **Step 1: Planning door — replace the stay placeholder**

In `src/app/trips/[slug]/find-a-place-planning.tsx`, replace `{ key: "stay", title: "Accommodation", soon: true }` with a live section (mirrors the food/activity entries; area starts blank since the place is already the anchor):

```tsx
    {
      key: "stay",
      title: "Accommodation",
      content: needsPlace ? (
        prompt
      ) : (
        <DiscoverySection
          key={`${keyBase}-stay`}
          category="stay"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={place}
          when=""
          defaultNear=""
          defaultWalkable={false}
          addTarget={{
            kind: "select",
            days: dayOptions,
            locationId: location?.id ?? null,
            newDayTitle: location?.name,
            defaultDate: location?.startDate ?? undefined,
          }}
          buildEventText={(s) => `Stay · ${s.name}`}
          ctaLabel={cta}
        />
      ),
    },
```

Leave `{ key: "transport", title: "Transport", soon: true }` unchanged.

- [ ] **Step 2: On-the-road door — replace the stay placeholder**

In `src/app/on-the-road/find-a-place.tsx`, replace `{ key: "stay", title: "Accommodation", soon: true }` with:

```tsx
    {
      key: "stay",
      title: "Accommodation",
      content: (
        <DiscoverySection
          category="stay"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={destination}
          when=""
          defaultNear=""
          defaultWalkable={false}
          addTarget={{ kind: "fixed", dayDate, dayId }}
          buildEventText={(s) => `Stay · ${s.name}`}
          ctaLabel="add to today"
        />
      ),
    },
```

Leave transport unchanged. Update the file's top comment ("Accommodation and Transport are placeholders.") to note only Transport is a placeholder now.

- [ ] **Step 3: Lint + build**

Run: `pnpm lint`
Expected: clean.

Run: `pnpm build`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/find-a-place-planning.tsx src/app/on-the-road/find-a-place.tsx
git commit -m "feat(discovery): flip accommodation door live in both modes"
```

- [ ] **Step 5: In-app verify (assistant on, logged-in session)**

With the assistant enabled, on a trip with an itinerary location:
1. Open the find door → **Accommodation** is live (not greyed/`soon`).
2. It shows **area + price** inputs (no craving / no walking-distance checkbox).
3. Press `find` → a cited shortlist of real places to stay, biased by area + price band.
4. Add a pick → an event `Stay · {name}` tagged `Accommodation` appears on the chosen day (planning) / today (on the road), with a working source link.
5. Confirm **Food** and **Activities** still search and add exactly as before, and **Transport** still reads `soon`.

---

## Self-Review

**Spec coverage:**
- Category + seam `stay` branch → Task 1. ✓
- Query wiring (area→near, price→budgetBand, stay→accommodation summary, accept "stay") → Task 2. ✓
- `DiscoverySection` area+price input branch → Task 3. ✓
- Both doors flipped live, transport stays soon → Task 4. ✓
- Commit path / budget / learning reuse → no code change needed (event tagged `Accommodation`); verified in Task 4 Step 5. ✓
- Acceptance criteria → Task 4 Step 5 in-app verify. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `DiscoveryCategory` gains `"stay"` (Task 1) and is consumed as `"stay"` in Tasks 2–4; `mapDiscoveryCategory("stay")` = `"Accommodation"`; `LearnedCategory` `"accommodation"` matches `couple-summary-types.ts:5`; `price` body field produced in Task 3, consumed in Task 2; `budgetBand`/`near` reused, no new `DiscoveryQuery` fields. ✓
