import { Section, Step, Steps } from "./manual-section"

/**
 * The Manual: a calm reference page. An overview (the "main manual") followed by
 * one short section per core area of the trip workspace. Each section reads as
 * orientation depth; pressing `more` reveals a step-by-step walkthrough. Anchor
 * ids are kept for future deep-links.
 */
export function ManualContent() {
  return (
    <div className="max-w-[64ch]">
      <section className="mb-10">
        <h1 className="t-display text-[30px] text-foreground">
          How <em>Together</em> works
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Together is a shared workspace for planning trips as a couple. You and
          your partner see the same trips, the same packing list, the same budget —
          everything updates live for both of you. <strong className="font-medium text-foreground">Home</strong> is
          your starting point: the trip happening now, what is coming up, and the
          dreams you have not dated yet. Each trip opens into its own workspace with
          tabs for the itinerary, packing, budget, and notes. While a trip is live,
          <strong className="font-medium text-foreground"> On the road</strong> focuses
          the day for you, and <strong className="font-medium text-foreground">Checklists</strong> hold
          reusable packing templates you can pull from any trip. Each section below
          has a <em>more</em> link for a step-by-step walkthrough.
        </p>
      </section>

      <Section
        id="trips"
        kicker="Trips & Dreams"
        title="Trips and dreams"
        details={
          <Steps>
            <Step>On Home, tap <em>+ new trip or dream</em>.</Step>
            <Step>
              Give it a name and a destination. The web address (slug) fills in
              from the name on its own.
            </Step>
            <Step>
              For a real trip, set a start and end date. For a dream, tick{" "}
              <em>this is a dream</em> instead — the dates disappear and you can type
              a loose &ldquo;when?&rdquo; like &ldquo;someday&rdquo; or &ldquo;next winter.&rdquo;
            </Step>
            <Step>Save. The trip now appears on Home in its band (now, upcoming, dream, or past).</Step>
            <Step>
              To turn a dream into a real trip later: open it, choose <em>Edit</em>,
              uncheck <em>this is a dream</em>, and add a start date. Any days you
              already sketched slide onto the calendar from that date.
            </Step>
          </Steps>
        }
      >
        A <em>trip</em> has real dates; a <em>dream</em> is a place you want to go
        someday with no dates yet. Make either one from Home with{" "}
        <em>+ new trip or dream</em> — give it a name, a destination, and dates (or
        skip the dates and add a loose &ldquo;when?&rdquo; for a dream). When a dream
        firms up, open it, choose Edit, uncheck &ldquo;this is a dream,&rdquo; and add a
        start date; any days you already sketched move onto the calendar
        automatically.
      </Section>

      <Section
        id="itinerary"
        kicker="Itinerary"
        title="The itinerary"
        details={
          <Steps>
            <Step>Open a trip and go to the <em>Itinerary</em> tab.</Step>
            <Step>
              Tap <em>+ location</em> and name the place you will stay (e.g. a town
              or area). Optionally give it a date span so its days sit on the
              calendar.
            </Step>
            <Step>
              Under a location, add days. Each day has a one-line summary and a list
              of mini-events — tap <em>+ add event</em> for each, with an optional
              time and a short description. Events sort themselves by time.
            </Step>
            <Step>
              Tap a day to expand its full list of events; tap again to collapse back
              to the summary.
            </Step>
            <Step>
              To reorder, drag a day by its handle. The dates stay fixed — only what
              happens on each date moves. Empty days between locations show as slots
              you can tap to fill.
            </Step>
            <Step>
              For a dream (no dates), the itinerary uses numbered days — Day 1, Day
              2, and so on — instead of a calendar.
            </Step>
          </Steps>
        }
      >
        The itinerary is a day-by-day plan grouped under the places you will stay.
        Add a location, give it an optional date span, then fill its days — each day
        carries a short summary and a list of timed mini-events. Drag a day by its
        handle to reschedule it; the dates stay put and the activities shuffle into
        place. Empty days between locations show as slots you can tap to fill.
        Dreams plan the same way but with numbered days (Day 1, Day 2…) instead of a
        calendar.
      </Section>

      <Section
        id="packing"
        kicker="Packing"
        title="Packing"
        details={
          <Steps>
            <Step>Open a trip and go to the <em>Packing</em> tab.</Step>
            <Step>
              Items are grouped into categories. Add an item under a category and it
              appears for your partner straight away.
            </Step>
            <Step>
              Tick an item to mark it packed; your partner sees the check live, and
              you see theirs.
            </Step>
            <Step>
              To avoid retyping the same gear every trip, tap <em>Import items</em>{" "}
              and pull from one of your saved Checklists.
            </Step>
          </Steps>
        }
      >
        A shared packing list for the trip, organised into categories. Add items,
        tick them off, and watch your partner&rsquo;s checks appear live. To save
        retyping the same gear every trip, use <em>Import items</em> to pull from one
        of your saved Checklists.
      </Section>

      <Section
        id="budget"
        kicker="Budget & Expenses"
        title="Budget and expenses"
        details={
          <Steps>
            <Step>Open a trip and go to the <em>Budget</em> tab.</Step>
            <Step>
              To plan, attach expected costs to each itinerary location (the
              <em> Budget</em> view), plus a trip-wide section for things not tied to
              one place. The planned total adds up as you go.
            </Step>
            <Step>
              As you spend, switch to <em>Expense</em> and log each cost: an amount, a
              category, who paid, and a date.
            </Step>
            <Step>
              <em>Settle up</em> shows who owes whom from everything logged. Record a
              full or partial payment there to square up; the history keeps a record.
            </Step>
            <Step>
              <em>Saved</em> tracks what each of you has set aside — tap your box to
              add a contribution (crediting your partner asks for a quick confirm).
            </Step>
          </Steps>
        }
      >
        Plan a budget by attaching costs to each location in the itinerary, with a
        trip-wide section for anything that is not tied to a place. As the trip
        happens, log expenses against categories and mark who paid. <em>Settle up</em>{" "}
        keeps a running tally of who owes whom and lets you record full or partial
        payments, while <em>Saved</em> tracks what each of you has set aside.
      </Section>
    </div>
  )
}
