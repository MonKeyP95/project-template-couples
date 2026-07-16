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
