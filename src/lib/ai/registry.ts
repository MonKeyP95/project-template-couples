import "server-only"
import type Anthropic from "@anthropic-ai/sdk"

/**
 * The shared tool + MCP catalog. Each AI descriptor (agents/*.ts) references
 * tools and MCP servers by name; this file resolves those names to Anthropic
 * definitions. A typo in a descriptor fails loudly here rather than silently
 * dropping a tool.
 */

export const TOOL_REGISTRY: Record<string, Anthropic.Messages.ToolUnion> = {
  // Basic web_search (not the _20260209 variant): its "dynamic filtering" spins
  // up server-side code_execution to pre-filter results, which tripled latency
  // for no quality gain. Two capped variants — budget wants up to 5 rounds,
  // discovery finds 3 plenty.
  web_search: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
  web_search_short: { type: "web_search_20250305", name: "web_search", max_uses: 3 },

  submit_budget: {
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

  propose_itinerary: {
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

  propose_places: {
    name: "propose_places",
    description: "Return the final shortlist of place suggestions.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              why: {
                type: "string",
                description: "One sentence on why it fits this couple/trip.",
              },
              area: { type: "string", description: "Neighbourhood or area." },
              priceHint: {
                type: "string",
                description:
                  "Rough cost feel as text (e.g. 'mid-range'). Never an exact price.",
              },
              sourceUrl: {
                type: "string",
                description: "A real URL from the web search backing this pick.",
              },
            },
            required: ["name", "why", "area", "priceHint", "sourceUrl"],
          },
        },
      },
      required: ["suggestions"],
    },
  },

  propose_suggestion: {
    name: "propose_suggestion",
    description: "Return one short, actionable suggestion for the couple.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: {
          type: "string",
          description:
            "A terse header in the app's voice, e.g. '/ suggested' or '/ assistant'.",
        },
        body: {
          type: "string",
          description:
            "One to two sentences: a specific, actionable suggestion grounded in the given context. No preamble.",
        },
      },
      required: ["label", "body"],
    },
  },
}

/** Resolve tool names to Anthropic tool definitions, in order. Throws on an
 * unknown name so a typo in a descriptor fails loudly. */
export function resolveTools(names: string[]): Anthropic.Messages.ToolUnion[] {
  return names.map((n) => {
    const tool = TOOL_REGISTRY[n]
    if (!tool) throw new Error(`Unknown tool: ${n}`)
    return tool
  })
}

/**
 * The MCP catalog: name -> server URL. Empty until a real MCP server is added.
 * To connect an AI to a server, add an entry here, then list its name in the
 * descriptor's `mcpServers`.
 */
const MCP_REGISTRY: Record<string, string> = {}

/** Resolve MCP server names to server-URL definitions. Throws on unknown name. */
export function resolveMcpServers(
  names: string[],
): Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition[] {
  return names.map((n) => {
    const url = MCP_REGISTRY[n]
    if (!url) throw new Error(`Unknown MCP server: ${n}`)
    return { type: "url", name: n, url }
  })
}

/** Resolve MCP server names to their matching mcp_toolset tool entries. The API
 * requires both the server definition and its toolset entry together. */
export function resolveMcpToolsets(
  names: string[],
): Anthropic.Beta.Messages.BetaMCPToolset[] {
  return names.map((n) => {
    if (!MCP_REGISTRY[n]) throw new Error(`Unknown MCP server: ${n}`)
    return { type: "mcp_toolset", mcp_server_name: n }
  })
}
