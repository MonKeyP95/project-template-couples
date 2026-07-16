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
