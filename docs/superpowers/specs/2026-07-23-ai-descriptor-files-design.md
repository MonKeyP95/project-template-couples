# AI Descriptor Files — Design

**Date:** 2026-07-23
**Status:** Approved, ready for implementation plan
**Builds on:** `2026-07-16-planner-skills-design.md` (the `PlannerSkill` seed this generalizes)

## Goal

Every AI in the app becomes **one editable `.ts` file** that is the control
surface for that AI: its instructions, the tools it can reach for, and the MCP
servers it can connect to. Improving an AI means opening its file and editing
the prompt, adding a tool, or wiring an MCP server — over time, growing it.
You never touch the API-call plumbing to do any of that.

This is the motivation, in the user's words: *"each AI will have a .ts file
that I can change — improve the prompt, add tools, connect to an MCP server,
build that to improve over time."*

## Why now / what's wrong today

`src/lib/ai/claude.ts` (584 lines) holds the Anthropic client **plus** six
distinct AIs with their prompts inline: `chatReply`, `summarizeTaste`,
`discover`, `draftBudgetFill`, `draftItinerary`, `generateSuggestion`.

Two of them (`draftBudgetFill`, `draftItinerary`) already follow a per-file
pattern via `skills/{budget-planner,itinerary-planner}.ts` (`PlannerSkill` =
`{name, prompt, toolNames}`). The other four have prompts buried in the big
file. Result: inconsistent, and prompts are hard to find and tune. None of the
six exposes MCP as an editable knob.

This is a **refactor of working code, not a new feature.** Behavior is
unchanged; the win is entirely the uniform, editable control surface.

## Scope

**In scope:** a descriptor shape, a shared runner, an extended registry, and
migrating all six AIs to per-file descriptors. MCP as a *declared, honored*
axis (the seam), with an empty list until a real server exists.

**Out of scope:** wiring an actual MCP server (its own later slice — needs a
real server URL and usually a credential); modernizing tool versions (e.g.
`web_search_20250305` → `_20260209`) beyond what a migration incidentally
touches; any change to the six AIs' observable behavior.

## Design

Three pieces: **descriptors** (data you edit), the **runtime** (the one shared
API call), and the **registry** (the shared tool + MCP catalog).

### 1. The descriptor — the file you edit

Each AI is one file under `src/lib/ai/agents/` exporting a typed descriptor:

```ts
// src/lib/ai/agents/budget-planner.ts
import "server-only"
import type { AgentDescriptor } from "../runtime"
import type { BudgetFillContext, BudgetFillResult } from "../budget-types"

export const budgetPlanner: AgentDescriptor<BudgetFillContext, BudgetFillResult> = {
  name: "budget-planner",
  model: "claude-opus-4-8",          // optional; omit to take the default

  system: "You price the gaps in a couple's trip budget. Never ask questions...",

  buildInput: (c) => budgetFillPrompt(c),   // typed input -> user turn (string or messages)

  tools: ["web_search", "submit_budget"],   // resolved by name from the registry

  mcpServers: [],                            // the new axis; add a server when you have one

  parseOutput: (msg) => readSubmitBudget(msg),
}
```

`AgentDescriptor<In, Out>` fields:

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Identifier; used in logs and errors |
| `model` | no | Model id; defaults to `claude-opus-4-8` |
| `effort` | no | `low`\|`medium`\|`high`\|`xhigh`\|`max` — passed to `output_config.effort` |
| `system` | yes | Instructions. `string`, or `(input) => string` for AIs whose system depends on input (e.g. `discover` keys off category) |
| `buildInput` | yes | `(input: In) => string \| MessageParam[]` — turns typed input into the user turn(s). Absorbs the AIs that assemble a prompt from structured data |
| `tools` | no | Tool names, resolved via the registry. A typo fails loudly |
| `mcpServers` | no | MCP server refs (name resolved via the registry) |
| `parseOutput` | yes | `(message) => Out` — turns the response into typed output |

The **only** file you edit to improve an AI is its descriptor. You do not touch
the runtime or the SDK call.

### 2. The runtime — one shared call, reviewed once

`src/lib/ai/runtime.ts` defines `AgentDescriptor<In, Out>` and one function:

```ts
export async function runAgent<In, Out>(
  descriptor: AgentDescriptor<In, Out>,
  input: In,
): Promise<Out>
```

`runAgent`:
- resolves `tools` and `mcpServers` through the registry,
- chooses `client.beta.messages.create` when MCP or a beta-only tool is present
  (MCP requires beta `mcp-client-2025-11-20`), otherwise the plain call,
- applies `model` (default `claude-opus-4-8`), optional `effort`, `system`,
  and the `buildInput` result,
- returns `descriptor.parseOutput(message)`.

This is the single place that knows the SDK. A change to how we call the API
(default model, a new beta header, error handling) is one edit here, not six.

### 3. The registry — shared tool + MCP catalog

`src/lib/ai/registry.ts` (already exists for tools) is extended:
- keeps the tool catalog (`web_search`, `submit_budget`, `propose_itinerary`,
  and any added), each resolving a name to an Anthropic tool definition;
- gains an MCP catalog: a name resolves to an `mcp_servers` entry
  (`{type:"url", name, url}`) plus its matching `mcp_toolset` tool entry, since
  the API requires both halves together.

Unknown tool or MCP names throw, so a typo in a descriptor fails loudly.

### Layout

```
src/lib/ai/
  runtime.ts             # AgentDescriptor + runAgent            (new)
  registry.ts            # tools + mcp catalog                   (exists, extended)
  agents/
    chat.ts              # the six AIs, one descriptor each      (new)
    summarize-taste.ts
    discover.ts
    budget-planner.ts    # from skills/budget-planner.ts
    itinerary-planner.ts # from skills/itinerary-planner.ts
    suggestion.ts
  claude.ts              # shrinks to shared client + runtime helpers
  *-actions.ts           # unchanged entry points; each calls runAgent(<descriptor>, input)
```

The existing `*-actions.ts` server actions stay the client-facing entry points.
Descriptors are `server-only`; client components keep reaching them through the
actions, so the `*-types.ts` client/server split is preserved.

## The six AIs against the shape

| AI | Notes for migration |
|---|---|
| `budget-planner` | Already `PlannerSkill`; add `buildInput`/`parseOutput`. Lowest-risk first migration |
| `itinerary-planner` | Same; structured terminal tool `propose_itinerary` |
| `discover` | `system` is a function of category; uses `web_search` + structured terminal |
| `chat` | Multi-turn: `buildInput` returns `MessageParam[]` from trip context + history |
| `summarize-taste` | `buildInput` assembles the prompt from signals (the current helper moves into the file) |
| `suggestion` | Simplest; raw prompt in, structured `Suggestion` out |

All six fit one shape; the static ones carry no machinery they don't need, and
the prompt-assembling ones use `buildInput`/`system`-as-function.

## Rollout — incremental, build-green between each

1. Add `runtime.ts`; extend `registry.ts` with the MCP catalog. Build green.
2. Migrate **one** AI first: `budget-planner` (already closest). Verify its
   behavior is unchanged in-app.
3. Convert the other five one at a time, deleting each one's inline code from
   `claude.ts` as it lands. Build green after each.
4. `claude.ts` ends as shared client + runtime helpers only.
5. MCP stays declared-but-empty until a real server exists — the field is
   honored, no dead code runs.

## Risks / honest caveats

- **MCP is a beta API** (`mcp-client-2025-11-20`) and needs both a
  `mcp_servers` entry and a matching `mcp_toolset` tool, plus a real server URL
  and usually a credential. We build the seam now; connecting a live server is
  a separate later slice.
- **Behavior must not change.** This is a shape refactor. Each migrated AI is
  validated to produce the same behavior before moving on (per the trace-the-
  write-path discipline — follow client -> action -> `runAgent` -> SDK).
- **Don't over-build the runtime.** `runAgent` is built against the six real
  AIs, not hypothetical ones. No provider abstraction, no plugin system.

## Decision to record (docs/DECISIONS.md)

"Each AI is a per-file descriptor (`agents/*.ts`) run by one shared
`runAgent`; instructions, tools, and MCP servers are editable per-AI data.
Generalizes the `PlannerSkill` pattern to all six AIs."
