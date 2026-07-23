# AI Descriptor Files — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. This plan is being executed inline in the same session. No unit-test framework exists in this repo (`docs/TECH.md`); the validation gate is `pnpm build` + `pnpm lint` plus behavior-preservation reasoning (trace client -> action -> `runAgent` -> SDK).

**Goal:** Turn each of the six AIs into one editable `agents/*.ts` file (instructions + tools + MCP as data), run by a single shared `runAgent`, with zero change to observable behavior.

**Architecture:** A per-AI `AgentDescriptor` (data) + one `runAgent` (the sole SDK call) + an extended tool/MCP `registry`. `claude.ts` shrinks to a re-export seam so every existing caller keeps importing from `@/lib/ai/claude` unchanged.

**Tech Stack:** Next.js 16, TypeScript 5, `@anthropic-ai/sdk`, server-only modules.

## Global Constraints

- **Behavior-preserving refactor.** Same models, prompts, tools, `max_tokens`, `tool_choice`, and pause_turn loops as today. Correcting the spec: models are **NOT** `opus-4-8` — each descriptor keeps its current model: `claude-sonnet-4-6` for all except **chat**, which keeps `claude-sonnet-5`.
- **Server-only.** Every new file starts with `import "server-only"`.
- **No emojis; sparse comments; short files** (CLAUDE.md).
- **MCP seam built but unexercised.** `mcpServers` is honored by `runAgent` (beta `mcp-client-2025-11-20`) but every descriptor ships `mcpServers: []` — no live server until a later slice.
- **Preserve exact `max_uses`:** budget web_search = 5; discovery web_search = 3 (two registry entries).

---

### Task 1: Shared client

**Files:**
- Create: `src/lib/ai/client.ts`

**Produces:** `anthropic` (an `Anthropic` instance) for `runtime.ts` and `pingClaude`.

- [ ] **Step 1:** Create `client.ts`:

```ts
import "server-only"
import Anthropic from "@anthropic-ai/sdk"

/** The single Anthropic client. Server-only — the key never reaches the
 * browser. (CLAUDE.md: "AI provider is one file"; this is that seam's client.) */
export const anthropic = new Anthropic()
```

---

### Task 2: Registry (tools + MCP catalog)

**Files:**
- Create: `src/lib/ai/registry.ts`

**Interfaces / Produces:**
- `resolveTools(names: string[]): Anthropic.Messages.ToolUnion[]`
- `resolveMcpServers(names: string[]): Anthropic.Beta.BetaRequestMCPServerURLDefinition[]`
- `resolveMcpToolsets(names: string[]): Anthropic.Beta.BetaToolUnion[]`
- Tool keys: `web_search` (max_uses 5), `web_search_short` (max_uses 3), `submit_budget`, `propose_itinerary`, `propose_places`, `propose_suggestion`.

- [ ] **Step 1:** Create `registry.ts` with a `TOOL_REGISTRY: Record<string, Anthropic.Messages.ToolUnion>` holding all six tool defs (copy `submit_budget`/`propose_itinerary` verbatim from `skills/registry.ts`; copy `propose_places` from `claude.ts` DISCOVERY_TOOLS; copy `propose_suggestion` from `claude.ts` SUGGESTION_TOOL; `web_search` = `{type:"web_search_20250305", name:"web_search", max_uses:5}`; `web_search_short` = same with `max_uses:3`).
- [ ] **Step 2:** `resolveTools(names)` maps each name -> def, throwing `Unknown tool: <name>` on a miss (verbatim behavior from `skills/registry.ts`).
- [ ] **Step 3:** Add `const MCP_REGISTRY: Record<string, { url: string }> = {}` (empty) plus `resolveMcpServers` / `resolveMcpToolsets` that map names -> `{type:"url", name, url}` and `{type:"mcp_toolset", mcp_server_name:name}`, throwing on unknown name.

---

### Task 3: Runtime (`AgentDescriptor` + `runAgent`)

**Files:**
- Create: `src/lib/ai/runtime.ts`

**Consumes:** `anthropic` (Task 1); `resolveTools`/`resolveMcpServers`/`resolveMcpToolsets` (Task 2).
**Produces:** `AgentDescriptor<In, Out>` type; `runAgent(descriptor, input): Promise<Out>`.

- [ ] **Step 1:** Define `AgentDescriptor<In, Out>` with fields: `name: string`, `model: string`, `maxTokens: number`, `system?: string | ((input: In) => string)`, `buildInput: (input: In) => string | Anthropic.MessageParam[]`, `tools?: string[]`, `toolChoice?: Anthropic.Messages.ToolChoice`, `mcpServers?: string[]`, `maxTurns?: number` (pause_turn cap, default 1), `parseOutput: (message: Anthropic.Message, input: In) => Out`.
- [ ] **Step 2:** Implement `runAgent`: build `messages` from `buildInput` (wrap a string as one user turn); resolve `system`, `tools`, `toolChoice`; loop up to `maxTurns` calling `anthropic.messages.create`, `continue` on `stop_reason === "pause_turn"` (push assistant content), else break; `return descriptor.parseOutput(response, input)`. When `mcpServers` is non-empty, branch to `anthropic.beta.messages.create` with `betas:["mcp-client-2025-11-20"]`, `mcp_servers`, and MCP toolset entries appended to tools; cast the beta message to `Anthropic.Message` for `parseOutput` (the seam; unexercised while lists are empty).

---

### Task 4: The six agent descriptors

**Files:**
- Create: `src/lib/ai/agents/chat.ts`, `summarize-taste.ts`, `discover.ts`, `budget-planner.ts`, `itinerary-planner.ts`, `suggestion.ts`

**Consumes:** `runAgent`, `AgentDescriptor` (Task 3). Each file exports its public function (same name + signature as today) as a thin wrapper over `runAgent`, plus (for budget/itinerary) its context/result types.

Migration mapping (copy prompts/tools/parse verbatim from `claude.ts`):

| File | model | maxTokens | system | tools / choice | maxTurns | buildInput | parseOutput |
|---|---|---|---|---|---|---|---|
| `chat.ts` | sonnet-5 | 1024 | `chatSystem(tripContext)` fn | none | 1 | messages.map | join text |
| `summarize-taste.ts` | sonnet-4-6 | 512 | none | none | 1 | current prompt builder | join text |
| `discover.ts` | sonnet-4-6 | 2048 | `discoverySystem(category)` fn | `["web_search_short","propose_places"]` | 6 | `discoveryPrompt` | find `propose_places` -> suggestions ?? [] |
| `budget-planner.ts` | sonnet-4-6 | 3072 | budget prompt string | `["web_search","submit_budget"]` | 8 | `budgetFillPrompt` | find `submit_budget` -> fills/fillSources (needs `input.unpriced.length`) or null |
| `itinerary-planner.ts` | sonnet-4-6 | 2048 | itinerary prompt string | `["propose_itinerary"]`, forced choice | 1 | `itineraryPrompt` | find `propose_itinerary` -> {events, question} |
| `suggestion.ts` | sonnet-4-6 | 512 | SUGGESTION_SYSTEM string | `["propose_suggestion"]`, forced choice | 1 | raw prompt | find `propose_suggestion` -> Suggestion, throw if none |

- [ ] **Step 1:** Write `budget-planner.ts` first (already closest to the shape); it defines `BudgetFillContext`, `BudgetFillResult`, moves `budgetFillPrompt` + the planner prompt in, and its `parseOutput(msg, input)` rebuilds `fills`/`fillSources` sized by `input.unpriced.length`. Export `draftBudgetFill(context) = runAgent(budgetPlanner, context)`.
- [ ] **Step 2:** Write the other five, each moving its prompt/system/parse from `claude.ts` verbatim. `chat.ts` input is `{messages, tripContext}`; its wrapper is `chatReply(messages, tripContext)`.

---

### Task 5: Rewire `claude.ts` and delete `skills/`

**Files:**
- Modify: `src/lib/ai/claude.ts` (replace body with re-exports + `pingClaude`)
- Delete: `src/lib/ai/skills/registry.ts`, `skills/budget-planner.ts`, `skills/itinerary-planner.ts`

- [ ] **Step 1:** Replace `claude.ts` with `import "server-only"`, `import { anthropic } from "./client"`, a `pingClaude` using `anthropic`, and `export { ... }` lines for the six functions (and the budget/itinerary types) from `./agents/*`.
- [ ] **Step 2:** Delete the three `skills/` files (only `claude.ts` referenced them).
- [ ] **Step 3:** Validate: `pnpm build` then `pnpm lint`. Expected: both pass. This proves every caller (`suggestion-actions`, `itinerary-actions`, `chat-actions`, `budget-actions`, `couple-summary-actions`, `api/ai/ping`, `api/ai/discover`) still resolves its import.

---

### Task 6: Docs

**Files:**
- Modify: `docs/DECISIONS.md` (append a row), `docs/TODO.md` (mark done)

- [ ] **Step 1:** Append the DECISIONS row from the spec.
- [ ] **Step 2:** Add a TODO line noting the descriptor refactor shipped.

## Self-Review

- Spec coverage: descriptor (T4), runtime (T3), registry (T2), all six migrated (T4/T5), MCP seam honored-but-empty (T2/T3), incremental+build-green (T5). Covered. Correction logged: models are sonnet-4-6/sonnet-5, not opus-4-8.
- No placeholders: every task names exact files and the source to copy from.
- Type consistency: `runAgent`/`AgentDescriptor`/`resolveTools`/`resolveMcpServers`/`resolveMcpToolsets` names are used identically across tasks.
