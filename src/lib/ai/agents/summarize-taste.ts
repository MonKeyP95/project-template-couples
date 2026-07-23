import "server-only"
import { runAgent, joinText, type AgentDescriptor } from "../runtime"
import type {
  LearnedCategory,
  TasteSignal,
} from "@/lib/preferences/couple-summary-types"

/**
 * The taste-summary AI. Distils a couple's category signals into a short
 * markdown summary, evolving their current one (which may hold hand-edits)
 * rather than replacing it. Plain call, no tools. Suggest-only: returns text;
 * the caller persists it. Edit `system`/`buildInput` to change it.
 */

interface SummarizeTasteInput {
  category: LearnedCategory
  currentSummaryMd: string
  signals: TasteSignal[]
}

function signalToLine(s: TasteSignal): string {
  if (s.kind === "rated") {
    const note = s.note ? ` · ${s.note}` : ""
    return `- ${s.text} · rated ${s.rating}/5${note}`
  }
  if (s.kind === "planned") return `- ${s.text} · planned (not rated)`
  if (s.kind === "used") return `- ${s.text} · booked & paid on a trip (real)`
  return `- ${s.text} · wanted`
}

const LEARNED_NOUN: Record<LearnedCategory, string> = {
  food: "food",
  activity: "activities",
  accommodation: "places to stay",
  transport: "ways of getting around",
}

function summarizePrompt(input: SummarizeTasteInput): string {
  const noun = LEARNED_NOUN[input.category]
  const lines = input.signals.map(signalToLine).join("\n")
  const current = input.currentSummaryMd.trim()
    ? `Their current ${noun} summary (may include their own hand-edits — respect ` +
      `them):\n\n${input.currentSummaryMd.trim()}`
    : `They have no ${noun} summary yet.`
  return (
    `A couple leaves signals about their ${noun} across their trips: places ` +
    `they rated, places they planned but never rated, things they said they ` +
    `wanted, and places or modes they actually booked and paid for. ${current}\n\n` +
    `Here are the signals:\n${lines}\n\n` +
    `Weight rated highest and actually-booked ("booked & paid") next as real ` +
    `behaviour; treat "planned" and "wanted" as lighter hints about direction. ` +
    `Write a short markdown summary (a few bullet points) of what this couple ` +
    `likes and dislikes in ${noun}. Evolve the current summary rather than ` +
    `discarding it; keep any hand-edits that still hold. Return only the ` +
    `markdown, no preamble.`
  )
}

const summarizeTasteAgent: AgentDescriptor<SummarizeTasteInput, string> = {
  name: "summarize-taste",
  model: "claude-sonnet-4-6",
  maxTokens: 512,
  mcpServers: [],
  buildInput: (input) => summarizePrompt(input),
  parseOutput: (message) => joinText(message),
}

export function summarizeTaste(
  category: LearnedCategory,
  currentSummaryMd: string,
  signals: TasteSignal[],
): Promise<string> {
  return runAgent(summarizeTasteAgent, { category, currentSummaryMd, signals })
}
