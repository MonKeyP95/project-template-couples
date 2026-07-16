# Planner skills — editable `.md` behavior file + tool-registry anchor

**Status:** Design (brainstormed 2026-07-16). Not yet planned or built.
**Phase:** 5 (AI assistant). Refactor + small capability seam on the existing
`lib/ai` planners.

## Problem / why

Each planner's behavior lives as a hardcoded system-prompt string inside
`src/lib/ai/claude.ts` (`BUDGET_FILL_SYSTEM`, `ITINERARY_SYSTEM`, …), and each
planner's tool list is inlined next to it. To change how the budget planner
behaves, you edit code and redeploy. The user wants to **steer each planner by
editing a file**, and to **grow each planner's toolset over time** — add a tool,
remove a tool, borrow a better prompt — without rewiring code every time.

This is the "skill/agent per planner" idea, landed on its simplest honest form:
each planner is a small **skill** = an editable behavior file plus a declared set
of tools drawn from a shared registry.

## The idea — three anchor shapes

1. **The behavior file** — one per planner (e.g. `budget-planner.ts`). Holds the
   planner's *purpose and behavior* as prose you rewrite freely, plus the list of
   tools it uses. This is the day-to-day surface: reword behavior, switch tools
   on/off, all as file edits. Concretely a `.ts` template-string module for now
   (imported directly, no runtime file read); a true runtime-read `.md` is a
   possible later upgrade. "`.md`-like" throughout this spec means "an editable
   plain-text behavior file," not the file extension.

2. **`PlannerTool`** — the plug for one capability. A fixed shape every tool
   conforms to (`name`, `description`, `schema`, `run`). Implementations live in
   code, collected in a `TOOL_REGISTRY` keyed by name. Adding a genuinely new
   capability = write one `PlannerTool` and drop it in the registry; from then on
   it is just a name any planner's `.md` can list.

3. **`PlannerSkill`** — the plug for a whole planner. Ties an `.md` (its loaded
   prompt) to its resolved tools, and exposes one `run`. New planners reuse this
   shape.

The honest split: **prose and tool-selection are free file edits; a new tool is
a small one-time code add, then reusable.** "Importing" means the user pastes a
better prompt into the `.md`, or drops a small piece of code in as a new tool —
all local, nothing external to integrate.

## What this is NOT (non-goals)

- **Not a plugin framework.** No dynamic loading, no manifests, no plugin
  versioning. The interface + registry is a lightweight seam, not a system. This
  is a two-person learning app; that machinery is speculative complexity.
- **Not Anthropic's product "Skills"** (the `pptx`/`xlsx` kind that run code in a
  sandbox via `container.skills`) — wrong fit for a suggest-only planner.
- **Not a Managed Agent or an open-ended agent loop.** The task is
  well-specified and the review gate makes errors cheap; the API guidance is to
  stay at the simplest tier. Planners keep their bounded single-turn / bounded
  tool-loop shape.
- **Not MCP / external tools** in this arc. If genuine third-party tools are ever
  needed, that is when MCP is reached for — not before.
- **Suggest-only is preserved.** No tool in this arc writes to the database. The
  app's invariant — the AI never writes, the user approves every change via the
  review screen + Apply — stays intact. (Whether a future tool should *act* vs.
  *propose into the review screen* is explicitly parked; see Open decisions.)

## Scope — incremental slices

Smallest useful step first; validate each before the next.

### Slice 1 — budget planner's prompt as an editable behavior file
Lift `BUDGET_FILL_SYSTEM` (and the user-prompt-shaping text where it makes sense
to externalize) out of `claude.ts` into a dedicated, hand-editable file the
budget planner reads. **Zero behavior change** — same model, same tools, same
output — but from this point the budget planner is steerable by editing one
file. Proves the whole idea with the least risk.

**Concrete form: a `.ts` template-string file, not a runtime-read `.md`**
(`src/lib/ai/skills/budget-planner.ts` exporting a `BUDGET_PLANNER_PROMPT`
template string). Chosen to skip the Vercel runtime-file-read risk entirely —
the content is the same editable prose, just imported as a module constant, so
it works everywhere with zero config. A true runtime-read `.md` stays a possible
later upgrade if the file ever needs to change without a deploy; it is not needed
now.

### Slice 2 — the `.md` lists its tools; introduce the registry
Add the `PlannerTool` interface and a `TOOL_REGISTRY`. Give the `.md` a `## Tools`
section the loader parses and resolves against the registry. Now "add/delete
tools in the `.md`" is real. The budget planner's existing tools (`web_search`,
`submit_budget`) become the first registry entries. Introduce the `PlannerSkill`
shape that binds the `.md` prompt + resolved tools + one `run`.

### Slice 3 — itinerary planner on the same shape
Convert `draftItinerary` to a `PlannerSkill` with `itinerary-planner.md` and its
tool(s) from the registry, so both planners share one pattern. This is where the
refactor pays off (adding the third planner — packing, notes — becomes trivial).

Each slice is independently shippable and testable.

## Slice 1 detail

- **New file:** `src/lib/ai/skills/budget-planner.ts` — exports a
  `BUDGET_PLANNER_PROMPT` template-string constant holding the current
  `BUDGET_FILL_SYSTEM` text, edited only for readability (no behavior change
  intended). `import "server-only"` since it is a planner-prompt concern.
- **`claude.ts`:** `draftBudgetFill` imports `BUDGET_PLANNER_PROMPT` instead of
  defining the inline `BUDGET_FILL_SYSTEM` constant. Everything else (tools,
  loop, schema, model) unchanged.
- **No migration, no deps, no UI change, no config change.**

File-loading is settled: a `.ts` template-string constant, imported directly —
no `fs`, no runtime file read, no Vercel file-tracing config. A true
runtime-read `.md` is a possible later upgrade, not part of this arc.

## Model & invariants unchanged
- Model stays `claude-sonnet-4-6` for the budget fill (as today); no model change
  in this arc.
- `draftBudgetFill` still returns data; `budget-actions.ts` still does the write
  after Apply. One `lib/ai` seam. Suggest-only intact.

## Open decisions to confirm before/while planning
- File-loading mechanism — **settled: `.ts` template-string constant**, imported
  directly (no runtime file read, no Vercel risk).
- Slice 2 tools format — where the tool list lives once the behavior file is a
  `.ts` template. Recommend a simple exported `toolNames: string[]` beside the
  prompt (a real `## Tools` markdown section is only meaningful once/if the
  behavior file becomes a runtime-read `.md`).
- Parked (out of this arc): whether any future tool *acts* (writes) vs.
  *proposes into the review screen*. Default remains propose/suggest-only.
