# FEATURES.md

## Done (shipped)

**MVP (Phases 1–3)**
1. **Auth + pairing** — sign up, log in, invite partner/family member, share a workspace
2. **Trip** — create a trip (name, dates, destination, members)
3. **Shared trip todo / packing list** — add, check off, see each other's edits (Realtime)

**Beyond MVP (Phases 4–4.6)**
- Trip budget + expense splitting (who paid, who owes; settle-up with partial/overpay)
- Itinerary — location-organized planner: dated locations, buffer slots, gap-aware confirm-and-push
- Trip notes and restaurant ideas
- Dream destinations board (dateless dreams that promote to dated trips)
- Dark mode
- Shareable trips — one-toggle public, read-only itinerary at `/t/<token>` (anonymous view; budget/expenses/members/exact dates never shared), with "copy this plan into my workspace" as a new dated trip

## Next (current focus)

- AI assistant — itinerary drafting, restaurant suggestions, hidden gems (Phase 5)

## Later

- Google Calendar sync (push trip events out)
- Google Maps integration (places, routes)
- Restaurant booking integration
- Reminders & notifications
- Photo / memory sharing per trip
- Visited-countries map — color in each country a couple has taken a trip to (needs a country-keyed map asset + `country` text → ISO-code lookup; the current background map is anonymous outlines, so it's a swap not a tweak)

## Future (only if the app actually gets used)

- Multi-family / multi-workspace
- Roles inside a workspace (parent vs. kid, organizer vs. participant)
- Analytics on a couple's/family's travel patterns

## AI scope — kept narrow on purpose
The AI assistant is **proactive and trip-scoped**, not a generic chatbot:
- Draft an itinerary skeleton from "5 days in Lisbon, we like food and walking"
- Suggest restaurants near a given itinerary stop
- Flag missing items in a packing list given destination + dates

If a feature can't be described in one sentence like the above, it's out of scope for now.
