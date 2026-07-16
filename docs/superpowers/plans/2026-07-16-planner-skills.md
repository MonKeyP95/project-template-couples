# Planner Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each `lib/ai` planner into a "skill" — an editable behavior file (purpose prose + tool list) resolved against a shared tool registry — starting with the budget planner, then the itinerary planner.

**Architecture:** Each planner's system prompt moves out of `claude.ts` into a co-located `.ts` template-string module (`src/lib/ai/skills/*.ts`) the planner imports. A small `TOOL_REGISTRY` maps tool names to their Anthropic tool definitions; each behavior file exports a `PlannerSkill` (`{ name, prompt, toolNames }`), and the planner builds its `tools` array by resolving those names. This is a pure refactor — same model, tools, schema, and output at every step. No `run`-carrying tool abstraction yet (the current tools are a server tool + a structured-output terminal, neither has an app-side `run`; that variant lands only when a future app-executed tool exists, which is parked).

**Tech Stack:** Next.js 16 (App Router, server-only modules), TypeScript 5, `@anthropic-ai/sdk`. No new dependencies.

## Global Constraints

- **Suggest-only preserved** — no tool in this arc writes to the DB; all writes stay in the existing Server Actions after Apply. Copied from spec.
- **Zero behavior change** — same model (`claude-sonnet-4-6`), same tools, same schemas, same prompt bytes. This is a refactor; output must be identical.
- **No new deps, no migration, no UI change, no config change.**
- **Server-only** — all `src/lib/ai/skills/*` modules carry `import "server-only"`; no client component may import them.
- **No tests exist** — verify each task with `pnpm lint` then `pnpm build`; both must be clean. The AI round-trip is verified in-app afterward (logged-in session + `ANTHROPIC_API_KEY`).
- **No emojis; sparse comments; short focused files** (project style).

---

### Task 1: Budget planner prompt → editable behavior file (Slice 1)

**Files:**
- Create: `src/lib/ai/skills/budget-planner.ts`
- Modify: `src/lib/ai/claude.ts` (remove `BUDGET_FILL_SYSTEM` const at lines ~371-384; use the import at the `draftBudgetFill` call site, line ~431)

**Interfaces:**
- Produces: `export const BUDGET_PLANNER_PROMPT: string` — the budget planner's system prompt, byte-identical to the current `BUDGET_FILL_SYSTEM`.

- [ ] **Step 1: Create the behavior file with the verbatim prompt**

Move the current `BUDGET_FILL_SYSTEM` text unchanged (keep the same string concatenation so the bytes are identical — reformatting into multi-line prose is a safe follow-up edit later, since whitespace-only prompt edits are negligible).

Create `src/lib/ai/skills/budget-planner.ts`:

```ts
import "server-only"

/**
 * The budget planner's behavior. Edit this to steer how it prices a trip.
 * Kept byte-identical to the former inline BUDGET_FILL_SYSTEM (Slice 1 is a
 * no-op refactor); reword freely from here on.
 */
export const BUDGET_PLANNER_PROMPT =
  "You price the gaps in a couple's trip budget. Never ask questions or reply " +
  "conversationally — you cannot receive a reply. You MUST end by calling " +
  "submit_budget. Use the web_search tool ONLY for named or big-ticket items " +
  "(a specific hotel or hostel, flights and transfers, a named activity) to find " +
  "a real, current price; for everyday gaps (daily food, local transport, small " +
  "extras) estimate from typical costs for the destination, season, trip length " +
  "and party size. Every amount is a whole-euro figure for the whole line (whole " +
  "party, whole stay). NEVER fabricate: if you cannot find or reasonably estimate " +
  "a price, return amountEuros -1 for that line. When a web search produced the " +
  "number, set sourceUrl to that result's real URL; otherwise set sourceUrl to an " +
  "empty string. Never re-price a line the couple already decided. Price only " +
  "the lines given -- never invent new activities, trips or experiences to add; " +
  "that is the itinerary planner's job, not yours."
```

- [ ] **Step 2: Import it in `claude.ts` and delete the inline const**

In `src/lib/ai/claude.ts`, add near the other skill/type imports at the top:

```ts
import { BUDGET_PLANNER_PROMPT } from "./skills/budget-planner"
```

Delete the entire `const BUDGET_FILL_SYSTEM = "..."` block (the ~14-line concatenation).

- [ ] **Step 3: Point the call site at the import**

In `draftBudgetFill`, change the `messages.create` call:

```ts
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3072,
      system: BUDGET_PLANNER_PROMPT,
      tools: BUDGET_FILL_TOOLS,
      messages,
    })
```

(Only `system:` changes — from `BUDGET_FILL_SYSTEM` to `BUDGET_PLANNER_PROMPT`.)

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors (no unused `BUDGET_FILL_SYSTEM`, import resolves).

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: build succeeds. Because `BUDGET_PLANNER_PROMPT` is byte-identical to the old constant, the prompt sent to Claude is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/skills/budget-planner.ts src/lib/ai/claude.ts
git commit -m "refactor(ai): budget planner prompt -> editable behavior file (skills slice 1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Tool registry + budget skill lists its tools (Slice 2)

**Files:**
- Create: `src/lib/ai/skills/registry.ts`
- Modify: `src/lib/ai/skills/budget-planner.ts` (wrap prompt into a `PlannerSkill`)
- Modify: `src/lib/ai/claude.ts` (move `BUDGET_FILL_TOOLS` definitions into the registry; resolve tools from the skill; drop the now-unused inline array)

**Interfaces:**
- Produces:
  - `export interface PlannerTool { name: string; definition: Anthropic.Messages.ToolUnion }`
  - `export interface PlannerSkill { name: string; prompt: string; toolNames: string[] }`
  - `export const TOOL_REGISTRY: Record<string, PlannerTool>`
  - `export function resolveTools(names: string[]): Anthropic.Messages.ToolUnion[]`
  - `export const budgetPlannerSkill: PlannerSkill` (replaces the bare `BUDGET_PLANNER_PROMPT` export)
- Consumes: `Anthropic.Messages.ToolUnion` (SDK type); the budget tool definitions currently inline in `claude.ts` (`web_search_20250305` at `max_uses: 5`, and the `submit_budget` custom tool).

- [ ] **Step 1: Create the registry with the budget planner's two tools**

Move the exact tool definitions from `claude.ts`'s `BUDGET_FILL_TOOLS` into the registry, keyed by name. `web_search` here keeps the budget planner's `max_uses: 5` (only the budget planner consumes this entry in this arc; discovery keeps its own separate inline `web_search` at `max_uses: 3`, untouched).

Create `src/lib/ai/skills/registry.ts`:

```ts
import "server-only"
import type Anthropic from "@anthropic-ai/sdk"

/** A tool a planner can use: a name (listed in a behavior file) plus the
 * Anthropic tool definition behind it. No app-side `run` yet — the current
 * tools are a server tool and a structured-output terminal; a run-carrying
 * variant arrives only with the first app-executed tool. */
export interface PlannerTool {
  name: string
  definition: Anthropic.Messages.ToolUnion
}

/** A planner as a skill: editable prompt + the tools it uses by name. */
export interface PlannerSkill {
  name: string
  prompt: string
  toolNames: string[]
}

export const TOOL_REGISTRY: Record<string, PlannerTool> = {
  web_search: {
    name: "web_search",
    definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
  },
  submit_budget: {
    name: "submit_budget",
    definition: {
      name: "submit_budget",
      description: "Return a price for each indexed line.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          fills: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                index: { type: "integer", description: "0-based index of the unpriced line." },
                amountEuros: {
                  type: "number",
                  description: "Whole-euro price for the whole line, or -1 if no reliable price.",
                },
                sourceUrl: {
                  type: "string",
                  description: "Backing web-search URL, or empty string if estimated/none.",
                },
              },
              required: ["index", "amountEuros", "sourceUrl"],
            },
          },
        },
        required: ["fills"],
      },
    },
  },
}

/** Resolve a behavior file's tool names into Anthropic tool definitions, in
 * order. Throws on an unknown name so a typo in a behavior file fails loudly. */
export function resolveTools(names: string[]): Anthropic.Messages.ToolUnion[] {
  return names.map((n) => {
    const tool = TOOL_REGISTRY[n]
    if (!tool) throw new Error(`Unknown planner tool: ${n}`)
    return tool.definition
  })
}
```

- [ ] **Step 2: Wrap the budget prompt into a `PlannerSkill`**

Replace the contents of `src/lib/ai/skills/budget-planner.ts`:

```ts
import "server-only"
import type { PlannerSkill } from "./registry"

/**
 * The budget planner skill. Edit `prompt` to steer behavior; add/remove
 * entries in `toolNames` to change which tools it uses (names must exist in
 * TOOL_REGISTRY).
 */
export const budgetPlannerSkill: PlannerSkill = {
  name: "budget-planner",
  toolNames: ["web_search", "submit_budget"],
  prompt:
    "You price the gaps in a couple's trip budget. Never ask questions or reply " +
    "conversationally — you cannot receive a reply. You MUST end by calling " +
    "submit_budget. Use the web_search tool ONLY for named or big-ticket items " +
    "(a specific hotel or hostel, flights and transfers, a named activity) to find " +
    "a real, current price; for everyday gaps (daily food, local transport, small " +
    "extras) estimate from typical costs for the destination, season, trip length " +
    "and party size. Every amount is a whole-euro figure for the whole line (whole " +
    "party, whole stay). NEVER fabricate: if you cannot find or reasonably estimate " +
    "a price, return amountEuros -1 for that line. When a web search produced the " +
    "number, set sourceUrl to that result's real URL; otherwise set sourceUrl to an " +
    "empty string. Never re-price a line the couple already decided. Price only " +
    "the lines given -- never invent new activities, trips or experiences to add; " +
    "that is the itinerary planner's job, not yours.",
}
```

- [ ] **Step 3: Update `claude.ts` — resolve tools from the skill, drop the inline array**

Change the import:

```ts
import { budgetPlannerSkill } from "./skills/budget-planner"
import { resolveTools } from "./skills/registry"
```

Delete the entire `const BUDGET_FILL_TOOLS: Anthropic.Messages.ToolUnion[] = [ ... ]` block (the `web_search` + `submit_budget` array).

In `draftBudgetFill`, update the call:

```ts
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3072,
      system: budgetPlannerSkill.prompt,
      tools: resolveTools(budgetPlannerSkill.toolNames),
      messages,
    })
```

(`system` now reads from the skill; `tools` is resolved from `toolNames`. The resolved array is `[web_search, submit_budget]` in the same order as before, so the request is identical.)

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors, no unused symbols (`BUDGET_FILL_TOOLS` and the old `BUDGET_PLANNER_PROMPT` export are gone).

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: build succeeds. The resolved tools + prompt equal the former inline values, so behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/skills/registry.ts src/lib/ai/skills/budget-planner.ts src/lib/ai/claude.ts
git commit -m "refactor(ai): tool registry + budget skill lists its tools (skills slice 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Itinerary planner on the same skill shape (Slice 3)

**Files:**
- Create: `src/lib/ai/skills/itinerary-planner.ts`
- Modify: `src/lib/ai/skills/registry.ts` (add `propose_itinerary` to `TOOL_REGISTRY`)
- Modify: `src/lib/ai/claude.ts` (remove `ITINERARY_SYSTEM` const ~lines 543-557 and the `ITINERARY_TOOL` const ~lines 494-541; use the skill + `resolveTools` in `draftItinerary`)

**Interfaces:**
- Consumes: `PlannerSkill`, `resolveTools`, `TOOL_REGISTRY` (Task 2).
- Produces: `export const itineraryPlannerSkill: PlannerSkill`; a new `propose_itinerary` entry in `TOOL_REGISTRY`.

- [ ] **Step 1: Add `propose_itinerary` to the registry**

In `src/lib/ai/skills/registry.ts`, add to `TOOL_REGISTRY` (move the exact definition from `claude.ts`'s `ITINERARY_TOOL`):

```ts
  propose_itinerary: {
    name: "propose_itinerary",
    definition: {
      name: "propose_itinerary",
      description: "Return the drafted itinerary events.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          events: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                category: {
                  type: "string",
                  enum: ["Accommodation", "Transportation", "Activities", "Food", "Other"],
                  description: "Which kind of event this is.",
                },
                place: {
                  type: "string",
                  description: "The exact itinerary place name given for this event, or empty.",
                },
                text: {
                  type: "string",
                  description: "Short label for the event, e.g. 'Surf lesson' or 'Dinner - seafood'.",
                },
                date: {
                  type: "string",
                  description: "YYYY-MM-DD within the trip dates. Empty if you can't place it.",
                },
                time: {
                  type: "string",
                  description: "HH:MM 24h, or empty.",
                },
              },
              required: ["category", "place", "text", "date", "time"],
            },
          },
          question: {
            type: "string",
            description:
              "Empty when you proposed events. When the input is too thin to ground on, leave events empty and put ONE short clarifying question here.",
          },
        },
        required: ["events", "question"],
      },
    },
  },
```

- [ ] **Step 2: Create the itinerary behavior file**

Create `src/lib/ai/skills/itinerary-planner.ts` (prompt kept byte-identical to the former `ITINERARY_SYSTEM`):

```ts
import "server-only"
import type { PlannerSkill } from "./registry"

/**
 * The itinerary planner skill. Edit `prompt` to steer behavior; add/remove
 * entries in `toolNames` to change its tools (names must exist in TOOL_REGISTRY).
 */
export const itineraryPlannerSkill: PlannerSkill = {
  name: "itinerary-planner",
  toolNames: ["propose_itinerary"],
  prompt:
    "You draft a trip itinerary for a couple or family by calling propose_itinerary. " +
    "Be SPARSE: propose only a few genuinely grounded items per category (roughly one " +
    "or two), and leave a category empty if you have nothing concrete. Do not pad with " +
    "generic filler like 'explore the old town'. Leave room for the user to fill the rest. " +
    "GROUNDING: stay strictly on the specific place names given; never leap from a country " +
    "to a city the user did not name; never invent a place or date from the trip's name. " +
    "Set place to one of the exact place names given (or empty). Set date to a real " +
    "YYYY-MM-DD within range, or empty if you cannot place it. Keep each event a short " +
    "label, not a paragraph. Weight the couple's taste and vibe as a lens, never a checklist. " +
    "Do not invent prices or booking details. " +
    "If what you were given is too thin or ambiguous to ground on — no usable place, or a " +
    "place name you cannot confidently locate or understand — do NOT guess: return an empty " +
    "events array and put ONE short, specific clarifying question in question (name what you " +
    "need, e.g. which town or region). Otherwise return your events and leave question empty.",
}
```

- [ ] **Step 3: Update `claude.ts` — use the itinerary skill**

Add imports:

```ts
import { itineraryPlannerSkill } from "./skills/itinerary-planner"
```

(`resolveTools` is already imported from Task 2.)

Delete the `const ITINERARY_TOOL: Anthropic.Messages.ToolUnion = { ... }` block and the `const ITINERARY_SYSTEM = "..."` block.

In `draftItinerary`, update the call (keep `tool_choice` exactly as-is):

```ts
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: itineraryPlannerSkill.prompt,
    tools: resolveTools(itineraryPlannerSkill.toolNames),
    tool_choice: { type: "tool", name: "propose_itinerary" },
    messages: [{ role: "user", content: itineraryPrompt(context) }],
  })
```

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors; `ITINERARY_TOOL` and `ITINERARY_SYSTEM` are fully removed with no dangling references.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: build succeeds. Resolved tool + prompt equal the former inline values.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/skills/registry.ts src/lib/ai/skills/itinerary-planner.ts src/lib/ai/claude.ts
git commit -m "refactor(ai): itinerary planner on the skill shape (skills slice 3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## After the plan (manual, not a task)

- **In-app AI round-trip** (needs a logged-in session + `ANTHROPIC_API_KEY`): open a dated trip, run **Plan a budget** → Generate and confirm real line prices come back; run **Plan your itinerary** → Generate and confirm grounded events. Output should be indistinguishable from before this refactor.
- **Update `docs/TODO.md`** with the shipped slices, and add a `docs/DECISIONS.md` row for the `.ts`-template-over-runtime-`.md` choice.

## Out of scope (parked, per spec)

- A `run`-carrying `PlannerTool` for app-executed tools, and whether such a tool *acts* (writes) vs. *proposes into the review screen* — default stays suggest-only.
- A unified `PlannerSkill.run` replacing the two different loop bodies (budget's bounded `pause_turn` web-search loop vs. itinerary's single forced-tool call). Each planner keeps its own loop; only prompt + tools are sourced from the skill.
- Converting `discover`, `generateSuggestion`, `summarizeTaste`, or `chatReply` to skills. (`discover` keeps its own `web_search` at `max_uses: 3`.)
- A runtime-read `.md` behavior file (later upgrade), and any `## Tools` markdown parsing.
