# IDEAS.md

Differentiating feature ideas — brainstormed, **not committed scope**. These lean into what's uniquely Together's (shared workspace, the learning taste/budget profile, two-modes, dreams → trips) rather than generic travel-app features. Promote an idea to `FEATURES.md` / `PLAN.md` only after it's brainstormed into a real design.

## On-the-road "what now?" concierge

When today falls inside a trip's dates (the existing dates-driven **on-the-road** mode), the assistant flips from planner to concierge. Instead of "help me draft an itinerary," it answers "what should we do *right now*?" — context-aware of weather, time of day, where you are in the itinerary, and closures.

- Example: "It's raining and your museum is closed — here are two indoor picks that match your taste, 8 min away."
- Builds directly on the committed two-modes principle ([[project-two-modes-planning-vs-road]]) and the taste profile.
- Same AI seam (`lib/ai/claude.ts`), different prompt/tools depending on mode.

## The trip journal that writes itself

While on the road, passively assemble a lightweight log from what *actually happened* — expenses imply meals/activities, itinerary implies places visited. Minimal manual entry.

- Post-trip, this becomes the shareable per-trip summary that already feeds the profile ([[project-trip-summary-as-shareable-unit]]).
- Closes the loop: dream → trip → journal → profile → next dream.
- Distinct from a photo-sharing feature; the point is a low-effort record derived from data the app already holds.

## Phone-payment capture into a trip expense inbox

_Brainstormed 2026-11-23, not built._ Tap-to-pay on the road becomes a draft expense without typing it in. Wallets have no public read API (Google Wallet: none; Apple FinanceKit: native app plus Apple entitlement, mostly Apple's own cards), so we capture the payment **signal** on the phone and send it to us.

**Core shape (holds at every stage):**
- One source-agnostic intake endpoint: `{source, raw_text, amount?, currency?, merchant?, occurred_at}` plus a **per-user, write-only, revocable token**. The token identifies who paid.
- **On the road only:** the server keeps an item only if that user has a trip active today (trip-local date). Otherwise it's dropped and never stored, so home spending never reaches the DB.
- Items land in a **"to review" inbox** on the trip, never straight into expenses. One tap confirms. Numbers come from the parser and are never AI-rewritten.
- Deterministic parser (regex per known notification format). Category is suggested from the user's own past merchants. Unparseable text goes into the inbox as raw text for manual entry.
- Receipt photo already exists and stays the universal fallback (cash, chip-and-PIN).

**Build order (decided 2026-11-23):** Stage 1, then Stage 2. Stage 3 only if it ever goes to production.

**Stage 1: us. Google Wallet only, Android only, Samsung Galaxy A34 + A35.** MacroDroid macro "Notification received, app = Google Wallet" sends an HTTP POST. We write the endpoint, parser, inbox table and review UI. No AI and no native app.
- Before building: tap-pay once on each phone and copy the exact Google Wallet notification text (title + body). The parser is written against those real samples, not a guessed format.
- Samsung One UI puts idle apps to sleep. Add MacroDroid to "Never sleeping apps" and set its battery use to Unrestricted, or the macro silently stops firing.
- Samsung Wallet is ignored (the macro filters on the Google Wallet app only).
- Her cards in Google Wallet: a Wise card and a normal credit card. Listen to Google Wallet only, so each tap is one notification and there is nothing to de-duplicate. The Wise app's own notifications are not watched in Stage 1.

**Stage 2: friends and family (mixed phones, banks, currencies).**
- In-app "Connect your phone" screen: generate/revoke token, copy URL, short setup guide. Ship a shareable MacroDroid template.
- iPhone users: iOS Shortcuts **Wallet transaction trigger** (gives merchant + amount on card tap), shared as an iCloud shortcut link. Same endpoint.
- More notification formats/languages. An AI fallback parser for unknown formats becomes reasonable here (tiny cost per call, capped, only on parse failure).
- Group trips already fit: workspace not couple. Each member forwards their own payments and the existing settle-up handles splits.

**Stage 3: production (strangers, app stores).** Phone-wallet signals only. **No bank connections** (no bank alert emails, no open-banking aggregators), by choice (2026-11-23).
- **iOS:** stays on the shared iCloud shortcut. Users create the Wallet-transaction automation themselves (Apple doesn't let automations be shared), about 2 minutes, with some drop-off. No App Store review needed. Apple owns the trigger and could change it.
- **Android:** MacroDroid doesn't scale to strangers, and a separate companion app is still an extra install. Instead, **Together itself becomes the Android app** (2026-11-25): wrap the website in a thin shell (Capacitor or Trusted Web Activity) so the screens stay web and deploy as today, plus one small native Kotlin notification listener that posts to the same intake endpoint. The user grants Notification access, and the listener must filter to watched apps on-device and forward nothing else (state this in a clear disclosure plus privacy policy, and confirm the current Play policy before building). Needs a per-brand battery-optimization guide (Xiaomi/Huawei/Samsung kill listeners). Support Samsung Wallet as a second format.
- **Bank apps (Wise, Revolut):** their own push notifications for card payments are the same kind of signal, not a bank connection, and also cover physical-card, chip-and-PIN and online payments that wallets miss. Add them as watched apps with one parser each. Skip non-purchase notifications (top-ups, exchanges, transfers). Their APIs are not used: Revolut has no personal API (open banking only, ruled out), and Wise's personal token would cover Wise alone.
- **Duplicates:** a bank card inside Google Wallet produces two notifications per tap (wallet + bank app). Merge items with the same amount within a couple of minutes, or watch only one source per card.
- **Known issues (both):** notification format/language can change silently, so track the parse-failure rate and send failures to the inbox as raw text. Pre-tip restaurant amounts need correcting in the inbox. Holds/deposits/refunds need a "dismiss". Non-wallet payments (swipe, online, cash) stay on receipt photo plus manual entry.
- Compliance: financial data is sensitive (GDPR). Minimize what we keep (the drop-when-not-on-trip rule helps), let users delete it, rate-limit the endpoint.

**Decisions to keep the door open now:** the intake payload is source-agnostic, tokens are per user (not per workspace), and the active-trip filter is server-side. Everything after Stage 1 is a new source, not a redesign.

---

_Parked (from the same brainstorm, not chosen yet): taste reconciliation / "where we overlap", silent voting on dreams, cross-trip fair-split intelligence, couple compatibility matchmaking._
