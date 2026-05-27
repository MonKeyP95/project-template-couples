// mobile-app.jsx — Together interactive prototype
// Screens: Home → Trip → (Itinerary / Packing / Budget)
// One stateful component, switches views without unmounting.

const { useState: useStateM, useMemo: useMemoM } = React;

// ═══════════════════════════════════════════════════════════
// Data
// ═══════════════════════════════════════════════════════════
const INITIAL_PACK = [
  { cat: "Surf kit",  items: [
    { id: "s1", label: "3/2mm wetsuit", who: "M", done: true },
    { id: "s2", label: "Surf wax (warm)", who: "G", done: true },
    { id: "s3", label: "Leash + spare", who: "M", done: false },
    { id: "s4", label: "Reef booties", who: "G", done: false },
  ]},
  { cat: "Dive kit",  items: [
    { id: "d1", label: "Mask + snorkel", who: "M", done: true },
    { id: "d2", label: "Logbook + pen",  who: "M", done: false },
    { id: "d3", label: "Dive computer",  who: "G", done: true },
  ]},
  { cat: "Trek",      items: [
    { id: "t1", label: "Approach shoes (Rinjani)", who: "G", done: false },
    { id: "t2", label: "Headlamp + spare batt.",   who: "M", done: false },
    { id: "t3", label: "Insulated layer",          who: "G", done: false },
  ]},
  { cat: "Everyday", items: [
    { id: "e1", label: "Reef-safe SPF 50",  who: "G", done: true },
    { id: "e2", label: "Linen shirts ×3",   who: "M", done: true },
    { id: "e3", label: "Sandals",           who: "M", done: false },
    { id: "e4", label: "Filter water bottle", who: "G", done: false },
  ]},
  { cat: "Documents", items: [
    { id: "p1", label: "Passports (6mo+ valid)", who: "M", done: true },
    { id: "p2", label: "Dive insurance card",    who: "G", done: false },
    { id: "p3", label: "Visa on arrival fee €25", who: "M", done: false },
  ]},
];

const INITIAL_EXPENSES = [
  { id: "x1", title: "Surfboard rental · 8d", who: "M", amt: 96.00, day: "JUN 12", cat: "Surf" },
  { id: "x2", title: "Ferry · Bangsal → Gili Trawangan", who: "G", amt: 24.40, day: "JUN 14", cat: "Transit" },
  { id: "x3", title: "Padi refresher dive", who: "M", amt: 78.00, day: "JUN 14", cat: "Dive" },
  { id: "x4", title: "Warung dinner · Selong", who: "G", amt: 18.20, day: "JUN 13", cat: "Food" },
  { id: "x5", title: "Scooter rental · 4d", who: "M", amt: 42.00, day: "JUN 12", cat: "Transit" },
  { id: "x6", title: "Rinjani trek permit", who: "G", amt: 88.00, day: "JUN 16", cat: "Trek" },
  { id: "x7", title: "Beach grill · Mawi", who: "M", amt: 32.50, day: "JUN 13", cat: "Food" },
];

const ITINERARY = [
  { d: "01", dow: "Sat",  date: "Jun 12", title: "Land in Mataram",   sub: "Pickup → south to Kuta. Sunset at Mandalika.",      tag: "ARRIVE",  tone: "sand" },
  { d: "02", dow: "Sun",  date: "Jun 13", title: "Selong Belanak",    sub: "Long lefts. Lunch at the warung. Mawi at golden.", tag: "SURF",    tone: "sea" },
  { d: "03", dow: "Mon",  date: "Jun 14", title: "Gili Trawangan",    sub: "Ferry 09:00. Refresher dive + snorkel turtles.",     tag: "DIVE",    tone: "sea" },
  { d: "04", dow: "Tue",  date: "Jun 15", title: "Gili Meno · slow",  sub: "Hammock day. Sunset dive 17:00.",                    tag: "DIVE",    tone: "sea" },
  { d: "05", dow: "Wed",  date: "Jun 16", title: "Senaru gateway",    sub: "Return to Lombok. Drive to Senaru. Pre-trek brief.",  tag: "TRANSIT", tone: "clay" },
  { d: "06", dow: "Thu",  date: "Jun 17", title: "Rinjani · ascent",  sub: "Sembalun route. Camp at 2,639m. Cold night.",         tag: "TREK",    tone: "moss" },
  { d: "07", dow: "Fri",  date: "Jun 18", title: "Rinjani · summit",  sub: "02:30 push. 3,726m. Descent to crater lake.",         tag: "TREK",    tone: "moss" },
  { d: "08", dow: "Sat",  date: "Jun 19", title: "Slow morning + fly", sub: "Hot springs, drive south, evening flight.",          tag: "DEPART",  tone: "sand" },
];

// ═══════════════════════════════════════════════════════════
// Bottom of mobile frame — the tab bar
// ═══════════════════════════════════════════════════════════
function MobileNavBar({ view, setView }) {
  const items = [
    { id: "itinerary", label: "Itinerary" },
    { id: "packing",   label: "Packing" },
    { id: "budget",    label: "Budget" },
  ];
  return (
    <div style={{
      position: "absolute", left: 16, right: 16, bottom: 28,
      borderRadius: 999, padding: 6,
      background: "var(--paper)",
      border: "1px solid var(--hair)",
      boxShadow: "var(--shadow-md)",
      display: "flex", gap: 4,
      backdropFilter: "blur(20px)",
    }}>
      {items.map(it => {
        const active = view === it.id;
        return (
          <button key={it.id} onClick={() => setView(it.id)}
            style={{
              flex: 1, border: 0, borderRadius: 999,
              padding: "9px 0",
              background: active ? "var(--ink)" : "transparent",
              color: active ? "var(--paper)" : "var(--ink-2)",
              fontFamily: "var(--font-mono)", fontSize: 10,
              letterSpacing: ".2em", textTransform: "uppercase",
              cursor: "pointer", transition: "all .2s",
            }}>{it.label}</button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Screen 1 — Home (workspace landing)
// ═══════════════════════════════════════════════════════════
function HomeScreen({ onOpenTrip }) {
  return (
    <div style={{ minHeight: "100%", padding: "60px 20px 40px", position: "relative", background: "var(--bg)" }}>
      {/* Top wordmark */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 56 }}>
        <Label>Together · Workspace</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PairAvatar size={20} />
        </div>
      </div>

      {/* Greeting */}
      <div>
        <Label style={{ marginBottom: 10 }}>05 / 26 · Tuesday</Label>
        <h1 className="t-display" style={{ fontSize: 58, margin: 0, color: "var(--ink)" }}>
          Hello,<br/><em style={{ fontStyle: "italic" }}>Monkey</em>.
        </h1>
        <div className="rule" style={{ margin: "20px 0 12px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
            <span className="t-italic">Monkey</span> &amp; <span className="t-italic">Giraf</span>
          </div>
          <Coord>est. 2024 · 2 members</Coord>
        </div>
      </div>

      {/* Trips */}
      <div style={{ marginTop: 40 }}>
        <SectionHead label="Upcoming · 1" right="17 days" />
        <button onClick={onOpenTrip} style={{
          width: "100%", textAlign: "left", padding: 0, border: 0, cursor: "pointer",
          background: "var(--paper)", borderRadius: 14, overflow: "hidden",
          boxShadow: "var(--shadow-md)",
          border: "1px solid var(--hair)",
        }}>
          {/* photo strip placeholder with topo */}
          <div style={{ position: "relative", height: 132, background: "var(--sea-tint)", overflow: "hidden" }}>
            <TopoBg tone="sea" opacity={0.16} />
            <div style={{ position: "absolute", inset: 0, padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <MonoBadge tone="sea">Surf · Dive · Trek</MonoBadge>
                <Coord>8.7° S · 116.3° E</Coord>
              </div>
              <div>
                <div className="t-display" style={{ fontSize: 38, color: "var(--ink)", lineHeight: 1 }}>
                  <em>Lombok</em>
                </div>
                <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: ".18em", marginTop: 4 }}>
                  INDONESIA
                </div>
              </div>
            </div>
          </div>
          {/* meta strip */}
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div className="t-mono" style={{ fontSize: 11, color: "var(--ink)", letterSpacing: ".04em" }}>JUN 12 — JUN 20</div>
              <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2, letterSpacing: ".06em" }}>8 days · 2 travellers</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <PairAvatar size={20} />
              <Chevron />
            </div>
          </div>
        </button>
      </div>

      {/* Dream board */}
      <div style={{ marginTop: 36 }}>
        <SectionHead label="Dream board · 4" right="someday" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { name: "Faroe Islands", coord: "62.0° N · 6.8° W", tone: "moss" },
            { name: "Patagonia",     coord: "50.0° S · 73.0° W", tone: "clay" },
            { name: "Hokkaido",      coord: "43.0° N · 142° E",  tone: "sea"  },
            { name: "Aeolian Isles", coord: "38.5° N · 14.9° E", tone: "sand" },
          ].map(d => (
            <div key={d.name} style={{
              position: "relative", aspectRatio: "1 / 1",
              borderRadius: 10, overflow: "hidden",
              background: `var(--${d.tone}-tint)`,
              border: "1px solid var(--hair)",
              padding: 12, display: "flex", flexDirection: "column", justifyContent: "space-between",
            }}>
              <TopoBg tone={d.tone} opacity={0.10} />
              <Label style={{ position: "relative", color: `var(--${d.tone})` }}>{"// dream"}</Label>
              <div style={{ position: "relative" }}>
                <div className="t-display" style={{ fontSize: 20, color: "var(--ink)" }}><em>{d.name}</em></div>
                <Coord>{d.coord}</Coord>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add new trip */}
      <button style={{
        marginTop: 28, width: "100%", padding: "14px 16px",
        background: "transparent", border: "1px dashed var(--rule)", borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        cursor: "pointer",
      }}>
        <span className="t-mono" style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--ink-2)" }}>
          + new trip
        </span>
        <Chevron />
      </button>

      <div style={{ height: 60 }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Screen 2 — Trip hero + itinerary
// ═══════════════════════════════════════════════════════════
function TripHeader({ onBack }) {
  return (
    <div style={{ position: "relative", padding: "56px 20px 22px", background: "var(--sea-tint)", overflow: "hidden" }}>
      <TopoBg tone="sea" opacity={0.18} />
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <button onClick={onBack} style={{
          background: "transparent", border: 0, padding: 0, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
          fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase",
          color: "var(--ink-2)",
        }}>
          <Chevron dir="left" /> back
        </button>
        <Label>Trip · 02 of 02</Label>
      </div>
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Coord>8.7° S · 116.3° E</Coord>
          <h1 className="t-display" style={{ fontSize: 64, margin: "2px 0 0", color: "var(--ink)" }}>
            <em>Lombok</em>
          </h1>
          <div className="t-mono" style={{ fontSize: 10, letterSpacing: ".22em", color: "var(--ink-2)" }}>INDONESIA</div>
        </div>
        <WaveGlyph color="var(--sea)" w={56} h={14} />
      </div>

      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
        <div className="t-mono" style={{ fontSize: 12, color: "var(--ink)" }}>JUN 12 — JUN 20</div>
        <PairAvatar size={22} />
      </div>
    </div>
  );
}

function ItineraryScreen() {
  return (
    <div style={{ paddingBottom: 120 }}>
      {/* weather strip */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--hair)",
        background: "var(--paper)",
      }}>
        <DayChip d="THU" t="28" glyph="sun"  />
        <DayChip d="FRI" t="29" glyph="sun"  />
        <DayChip d="SAT" t="29" glyph="sun" active />
        <DayChip d="SUN" t="27" glyph="haze" />
        <DayChip d="MON" t="26" glyph="rain" />
        <DayChip d="TUE" t="28" glyph="sun"  />
        <DayChip d="WED" t="29" glyph="sun"  />
      </div>

      <div style={{ padding: "18px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>Itinerary</Label>
        <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".06em" }}>
          drafted by <span style={{ color: "var(--sea)" }}>● M+G</span>
        </div>
      </div>

      <div style={{ padding: "10px 20px 0" }}>
        {ITINERARY.map((d, i) => (
          <div key={d.d} style={{ position: "relative", display: "flex", gap: 14, padding: "14px 0" }}>
            {/* timeline column */}
            <div style={{ position: "relative", flex: "0 0 36px" }}>
              <div className="t-mono" style={{ fontSize: 9, color: "var(--ink-3)", letterSpacing: ".14em", lineHeight: 1 }}>
                DAY
              </div>
              <div className="t-mono" style={{ fontSize: 22, color: "var(--ink)", lineHeight: 1, marginTop: 2, letterSpacing: "-.02em" }}>
                {d.d}
              </div>
              <div className="t-mono" style={{ fontSize: 9, color: "var(--ink-3)", letterSpacing: ".14em", marginTop: 4 }}>
                {d.dow.toUpperCase()}
              </div>
              {/* dot + line */}
              {i < ITINERARY.length - 1 && (
                <div style={{
                  position: "absolute", left: 11, top: 56, bottom: -14, width: 1,
                  background: "var(--hair)",
                }} />
              )}
            </div>

            {/* card */}
            <div style={{
              flex: 1, background: "var(--paper)", border: "1px solid var(--hair)",
              borderLeft: `3px solid var(--${d.tone})`,
              borderRadius: 8, padding: "12px 14px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <MonoBadge tone={d.tone}>{d.tag}</MonoBadge>
                <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".06em" }}>{d.date}</div>
              </div>
              <div className="t-display" style={{ fontSize: 22, color: "var(--ink)", lineHeight: 1.1, marginBottom: 4 }}>
                {d.title}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{d.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Screen 3 — Packing
// ═══════════════════════════════════════════════════════════
function PackingScreen() {
  const [pack, setPack] = useStateM(INITIAL_PACK);
  const all = pack.flatMap(g => g.items);
  const done = all.filter(i => i.done).length;
  const pct = Math.round((done / all.length) * 100);

  const toggle = (cat, id) => {
    setPack(p => p.map(g => g.cat !== cat ? g : ({
      ...g, items: g.items.map(it => it.id !== id ? it : ({ ...it, done: !it.done })),
    })));
  };

  return (
    <div style={{ background: "var(--clay-tint)", minHeight: "100%", paddingBottom: 120 }}>
      {/* Header */}
      <div style={{ padding: "22px 20px 16px", position: "relative", overflow: "hidden" }}>
        <TopoBg tone="clay" opacity={0.10} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <Label>Packing</Label>
            <div className="t-display" style={{ fontSize: 36, color: "var(--ink)", marginTop: 4 }}>
              <span className="t-num">{done}</span><span style={{ color: "var(--ink-3)" }}>/{all.length}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <Coord>17 days out</Coord>
            <div className="t-mono" style={{ fontSize: 11, color: "var(--clay)", letterSpacing: ".06em", marginTop: 4 }}>
              {pct}% ready
            </div>
          </div>
        </div>
        <div style={{ position: "relative", marginTop: 14 }}>
          <Bar pct={pct} tone="clay" />
        </div>
      </div>

      {/* Categories */}
      <div style={{ background: "var(--bg)", borderTop: "1px solid var(--hair)" }}>
        {pack.map(g => {
          const gDone = g.items.filter(i => i.done).length;
          return (
            <div key={g.cat} style={{ padding: "18px 20px 6px", borderBottom: "1px solid var(--hair)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <Label>{g.cat}</Label>
                <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                  {gDone} / {g.items.length}
                </div>
              </div>
              {g.items.map(it => (
                <CheckRow key={it.id} done={it.done} label={it.label} who={it.who}
                  onToggle={() => toggle(g.cat, it.id)} tone="clay" />
              ))}
              <div style={{ paddingBottom: 8 }}>
                <button style={{
                  border: 0, background: "transparent", padding: "4px 0",
                  color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 11,
                  letterSpacing: ".15em", textTransform: "uppercase", cursor: "pointer",
                }}>+ add item</button>
              </div>
            </div>
          );
        })}

        {/* AI suggestion strip */}
        <div style={{ padding: "16px 20px 28px" }}>
          <div style={{
            border: "1px solid var(--hair)", borderRadius: 10, padding: "12px 14px",
            background: "var(--paper)",
            borderLeft: "3px solid var(--moss)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Label style={{ color: "var(--moss)" }}>/ suggested for Rinjani</Label>
              <Chevron dir="down" />
            </div>
            <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>
              Nights drop to 4°C at the crater. <span className="t-italic" style={{ color: "var(--ink)" }}>Consider a packable down layer + thermal liner.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Screen 4 — Budget
// ═══════════════════════════════════════════════════════════
function BudgetScreen() {
  const [expenses, setExpenses] = useStateM(INITIAL_EXPENSES);
  const [settled, setSettled]   = useStateM(false);
  const planned = 2800;
  const total = expenses.reduce((s, e) => s + e.amt, 0);
  const pct = Math.min(100, Math.round((total / planned) * 100));

  // who paid what
  const mPaid = expenses.filter(e => e.who === "M").reduce((s,e)=>s+e.amt,0);
  const gPaid = expenses.filter(e => e.who === "G").reduce((s,e)=>s+e.amt,0);
  const balance = (mPaid - gPaid) / 2; // positive → G owes M

  return (
    <div style={{ background: "var(--dusk-tint)", minHeight: "100%", paddingBottom: 120 }}>
      <div style={{ padding: "22px 20px 18px", position: "relative", overflow: "hidden" }}>
        <TopoBg tone="sea" opacity={0.10} />
        <div style={{ position: "relative" }}>
          <Label>Budget · Lombok</Label>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <div className="t-display" style={{ fontSize: 42, color: "var(--ink)", lineHeight: 1 }}>
              <span style={{ color: "var(--ink-3)", fontSize: 22 }}>€</span>
              <span className="t-num">{total.toFixed(0)}</span>
            </div>
            <div className="t-mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>/ €{planned}</div>
          </div>
          <div style={{ marginTop: 12 }}><Bar pct={pct} tone={pct > 80 ? "clay" : "sea"} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".06em" }}>{pct}% of planned</div>
            <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".06em" }}>€{(planned-total).toFixed(0)} left</div>
          </div>
        </div>
      </div>

      {/* Settle-up */}
      <div style={{ padding: "14px 20px" }}>
        <div style={{
          background: "var(--paper)", border: "1px solid var(--hair)",
          borderRadius: 12, padding: "14px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <Label style={{ marginBottom: 4 }}>Settle-up</Label>
            {settled ? (
              <div style={{ fontSize: 14, color: "var(--moss)" }} className="t-italic">All square.</div>
            ) : (
              <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.3 }}>
                <span className="t-italic">Giraf</span> owes <span className="t-italic">Monkey</span>
                <span className="t-num" style={{ marginLeft: 6, color: "var(--ink)" }}>€{Math.abs(balance).toFixed(2)}</span>
              </div>
            )}
          </div>
          <button onClick={() => setSettled(s => !s)} style={{
            background: settled ? "transparent" : "var(--ink)",
            color: settled ? "var(--ink-2)" : "var(--paper)",
            border: settled ? "1px solid var(--rule)" : "0",
            borderRadius: 99, padding: "8px 14px",
            fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase",
            cursor: "pointer",
          }}>{settled ? "undo" : "settle"}</button>
        </div>
      </div>

      {/* Split breakdown */}
      <div style={{ padding: "0 20px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { who: "Monkey", paid: mPaid, tone: "sea",  init: "M" },
            { who: "Giraf",  paid: gPaid, tone: "clay", init: "G" },
          ].map(p => (
            <div key={p.who} style={{
              background: "var(--paper)", border: "1px solid var(--hair)", borderRadius: 10,
              padding: "12px 14px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Avatar name={p.init} size={18} tone={p.tone} />
                <span className="t-italic" style={{ fontSize: 13, color: "var(--ink)" }}>{p.who}</span>
              </div>
              <Label>paid</Label>
              <div className="t-num" style={{ fontSize: 22, color: "var(--ink)", marginTop: 2 }}>€{p.paid.toFixed(0)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Ledger */}
      <div style={{ background: "var(--bg)", borderTop: "1px solid var(--hair)" }}>
        <div style={{ padding: "14px 20px 6px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Label>Ledger · {expenses.length}</Label>
          <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>most recent</div>
        </div>
        <div>
          {expenses.map((e, i) => (
            <div key={e.id} style={{
              display: "grid", gridTemplateColumns: "44px 1fr auto",
              alignItems: "center", gap: 12,
              padding: "12px 20px",
              borderTop: "1px solid var(--hair)",
            }}>
              <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".08em", lineHeight: 1.1 }}>
                {e.day.split(" ")[0]}<br/>
                <span style={{ color: "var(--ink)", fontSize: 13 }}>{e.day.split(" ")[1]}</span>
              </div>
              <div>
                <div style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.2 }}>{e.title}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <MonoBadge tone={e.cat === "Surf" ? "sea" : e.cat === "Dive" ? "sea" : e.cat === "Trek" ? "moss" : e.cat === "Food" ? "clay" : "ink"}>{e.cat}</MonoBadge>
                  <span className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>paid by</span>
                  <Avatar name={e.who} size={16} tone={e.who === "M" ? "sea" : "clay"} />
                </div>
              </div>
              <div className="t-num" style={{ fontSize: 15, color: "var(--ink)" }}>€{e.amt.toFixed(2)}</div>
            </div>
          ))}
        </div>

        <button style={{
          width: "100%", padding: "16px 20px",
          background: "transparent", border: 0, borderTop: "1px solid var(--hair)",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span className="t-mono" style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--ink-2)" }}>
            + log expense
          </span>
          <Chevron />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main shell — handles screen state
// ═══════════════════════════════════════════════════════════
function MobileApp() {
  const [route, setRoute] = useStateM("home"); // home | trip
  const [tab, setTab]     = useStateM("itinerary");

  if (route === "home") {
    return <HomeScreen onOpenTrip={() => { setRoute("trip"); setTab("itinerary"); }} />;
  }

  return (
    <div style={{ position: "relative", minHeight: "100%", background: "var(--bg)" }}>
      <TripHeader onBack={() => setRoute("home")} />
      {tab === "itinerary" && <ItineraryScreen />}
      {tab === "packing"   && <PackingScreen />}
      {tab === "budget"    && <BudgetScreen />}
      <MobileNavBar view={tab} setView={setTab} />
    </div>
  );
}

window.MobileApp = MobileApp;
