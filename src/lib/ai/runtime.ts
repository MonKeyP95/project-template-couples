import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { anthropic } from "./client"
import { resolveTools, resolveMcpServers, resolveMcpToolsets } from "./registry"

/**
 * The one shared Claude call. Each AI is an `AgentDescriptor` under agents/*.ts;
 * `runAgent` turns that data into a request. To improve an AI you edit its
 * descriptor (prompt, tools, mcpServers) — never this file.
 */
export interface AgentDescriptor<In, Out> {
  name: string
  /** Model id. Kept explicit per-AI so it never drifts by a hidden default. */
  model: string
  maxTokens: number
  /** System prompt: a string, or a function of the input when it varies. */
  system?: string | ((input: In) => string)
  /** Turn the typed input into the user turn(s). */
  buildInput: (input: In) => string | Anthropic.MessageParam[]
  /** Tool names, resolved via the registry. */
  tools?: string[]
  /** Force a specific tool, when the AI must always answer through one. */
  toolChoice?: Anthropic.Messages.ToolChoice
  /** MCP server names, resolved via the registry. Empty for now. */
  mcpServers?: string[]
  /** pause_turn resume cap for server-tool loops (web search). Default 1. */
  maxTurns?: number
  /** Turn the final response into typed output. Gets the input too, for AIs
   * whose parsing depends on it (e.g. sizing arrays by input length). */
  parseOutput: (message: Anthropic.Message, input: In) => Out
}

/** Concatenate a message's text blocks, trimmed. For text-answer AIs. */
export function joinText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}

export async function runAgent<In, Out>(
  descriptor: AgentDescriptor<In, Out>,
  input: In,
): Promise<Out> {
  const built = descriptor.buildInput(input)
  const messages: Anthropic.MessageParam[] =
    typeof built === "string" ? [{ role: "user", content: built }] : [...built]

  const system =
    typeof descriptor.system === "function"
      ? descriptor.system(input)
      : descriptor.system
  const tools = descriptor.tools ? resolveTools(descriptor.tools) : undefined
  const useMcp = !!descriptor.mcpServers?.length
  const maxTurns = descriptor.maxTurns ?? 1

  let response: Anthropic.Message | undefined
  for (let i = 0; i < maxTurns; i++) {
    response = useMcp
      ? await runMcpTurn(descriptor, messages, system, tools)
      : await anthropic.messages.create({
          model: descriptor.model,
          max_tokens: descriptor.maxTokens,
          ...(system ? { system } : {}),
          ...(tools ? { tools } : {}),
          ...(descriptor.toolChoice ? { tool_choice: descriptor.toolChoice } : {}),
          messages,
        })
    // Resume the server-side search loop; otherwise this is the final response.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content })
      continue
    }
    break
  }
  return descriptor.parseOutput(response!, input)
}

/**
 * The MCP seam: taken when a descriptor lists `mcpServers`. Unexercised while
 * the MCP registry is empty. The beta Messages types are structurally close to
 * the base ones but TS-distinct, so the base messages/tools are cast into the
 * beta shapes here — confined to this unused path so the common call stays clean.
 */
async function runMcpTurn<In, Out>(
  descriptor: AgentDescriptor<In, Out>,
  messages: Anthropic.MessageParam[],
  system: string | undefined,
  tools: Anthropic.Messages.ToolUnion[] | undefined,
): Promise<Anthropic.Message> {
  const betaTools: Anthropic.Beta.Messages.BetaToolUnion[] = [
    ...((tools ?? []) as unknown as Anthropic.Beta.Messages.BetaToolUnion[]),
    ...resolveMcpToolsets(descriptor.mcpServers!),
  ]
  const response = await anthropic.beta.messages.create({
    model: descriptor.model,
    max_tokens: descriptor.maxTokens,
    betas: ["mcp-client-2025-11-20"],
    ...(system ? { system } : {}),
    tools: betaTools,
    mcp_servers: resolveMcpServers(descriptor.mcpServers!),
    ...(descriptor.toolChoice
      ? { tool_choice: descriptor.toolChoice as Anthropic.Beta.Messages.BetaToolChoice }
      : {}),
    messages: messages as unknown as Anthropic.Beta.Messages.BetaMessageParam[],
  })
  return response as unknown as Anthropic.Message
}
