# Note reminders: design

Date: 2026-11-24. Size: a small change.

## Intent

A note can carry "remind me at <date, time>". Once that moment has passed, the
app shows it: the Notes box on the road and on the phone trip page turns the
attention colour, and on desktop the "Trip folder" pill does. One of us taps
"done" on the note and the colour goes away. Both of us see it, since notes are
shared.

## Goals

- Set, change or remove a reminder on a note: when adding it (road quick note,
  trip-page add form) and when editing it.
- A due note (remind time in the past, not done) colours:
  - the road's Notes box (and is listed there even if it is not today's note),
  - the phone trip page's Notes box,
  - the desktop "Trip folder" pill (when it is not the active tab).
- The due note itself is highlighted and has a "done" button; done clears it.
- A reminder still in the future shows a grey "remind 18:00 · 25 Nov" on the
  note, with no colour.

## Non-goals

- No phone notifications, email or anything that fires while the app is
  closed. The colour shows on the next page load after the time passes. Push
  can be added later on top of the same column.
- No repeat reminders, no several reminders per note, no history of done ones.

## Approaches

- **Picked: one `remind_at timestamptz` column on `trip_notes`.** Null means
  no reminder; done sets it back to null; setting a new time re-arms it. Due =
  `remind_at <= now()`. An exact moment means "due" needs no timezone.
- Rejected: a separate reminders table (several per note, history): nothing
  asked for it.
- Rejected: keep the time plus a done flag: remembers when it was cleared,
  which nobody reads.

## Decided

- Done tap on the note clears it (the user's choice over "clears when seen").
- Colour is clay (attention), not red (red means over budget).
- The time is entered and shown in the phone's own timezone (the `tz` cookie,
  `localTimeZone()`), which on the road is local time. The page passes that
  timezone down so the server and client render the same string; dates follow
  en-GB, day before month.

## Builder's calls

- Migration is one re-runnable `add column if not exists`; existing
  `trip_notes` RLS covers it.
- `updateNote` always writes `remind_at` (the editor always sends it);
  `addNote` takes an optional one; a small `clearNoteReminder` action does
  "done".
- Field: a native `datetime-local` input labelled "Remind me", empty = none.
