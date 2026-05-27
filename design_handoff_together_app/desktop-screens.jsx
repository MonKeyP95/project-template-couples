// desktop-screens.jsx — two desktop showcases inside browser windows
// 1) Trip Dashboard (wide editorial)
// 2) Workspace Home (trip grid + dream board)

// ─── Left rail used in trip dashboard ──────────────────────
function LeftRail({ active = "trips" }) {
  const nav = [
    { id: "home",   label: "Home" },
    { id: "trips",  label: "Trips" },
    { id: "dream",  label: "Dream board" },
    { id: "notes",  label: "Notes" },
    { id: "people", label: "People" },
  ];
  return (
    <div style={{
      width: 220, padding: "28px 22px",
      borderRight: "1px solid var(--hair)",
      background: "var(--paper)",
      display: "flex", flexDirection: "column", gap: 36,
      flex: "0 0 220px",
    }}>
      <div>
        <Label>Together</Label>
        <div className="t-display" style={{ fontSize: 30, color: "var(--ink)", marginTop: 8, lineHeight: 0.95 }}>
          <em>Monkey</em>
          <span style={{ color: "var(--ink-3)" }}> &amp; </span>
          <em>Giraf</em>
        </div>
        <Coord>workspace · est. 2024</Coord>
      </div>

      <div>
        <Label style={{ marginBottom: 12 }}>Navigate</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map(n => (
            <div key={n.id} style={{
              padding: "8px 10px", borderRadius: 6,
              fontSize: 13.5, color: n.id === active ? "var(--ink)" : "var(--ink-2)",
              background: n.id === active ? "var(--sea-tint)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              cursor: "pointer",
            }}>
              <span className={n.id === active ? "t-italic" : ""}>{n.label}</span>
              {n.id === active ? <Chevron /> : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "auto" }}>
        <Label style={{ marginBottom: 10 }}>Members</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name="M" size={26} tone="sea" />
            <div>
              <div style={{ fontSize: 13, color: "var(--ink)" }} className="t-italic">Monkey</div>
              <div className="t-mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: ".1em" }}>ACTIVE NOW</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name="G" size={26} tone="clay" />
            <div>
              <div style={{ fontSize: 13, color: "var(--ink)" }} className="t-italic">Giraf</div>
              <div className="t-mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: ".1em" }}>EDITING DAY 03</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Right rail (stats, AI, presence) ──────────────────────
function RightRail() {
  return (
    <div style={{
      width: 280, padding: "28px 24px",
      borderLeft: "1px solid var(--hair)",
      background: "var(--paper)",
      display: "flex", flexDirection: "column", gap: 30,
      flex: "0 0 280px",
    }}>
      <div>
        <Label>Pre-trip</Label>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span className="t-italic" style={{ fontSize: 13, color: "var(--ink)" }}>Packing</span>
              <span className="t-num" style={{ fontSize: 12, color: "var(--ink-3)" }}>8 / 17</span>
            </div>
            <Bar pct={47} tone="clay" />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span className="t-italic" style={{ fontSize: 13, color: "var(--ink)" }}>Budget</span>
              <span className="t-num" style={{ fontSize: 12, color: "var(--ink-3)" }}>€379 / €2,800</span>
            </div>
            <Bar pct={14} tone="sea" />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span className="t-italic" style={{ fontSize: 13, color: "var(--ink)" }}>Booked</span>
              <span className="t-num" style={{ fontSize: 12, color: "var(--ink-3)" }}>4 / 6</span>
            </div>
            <Bar pct={67} tone="moss" />
          </div>
        </div>
      </div>

      <div>
        <Label>Weather · 7 day</Label>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(7,1fr)", border: "1px solid var(--hair)", borderRadius: 8, overflow: "hidden" }}>
          <DayChip d="THU" t="28" glyph="sun"  />
          <DayChip d="FRI" t="29" glyph="sun"  />
          <DayChip d="SAT" t="29" glyph="sun" active />
          <DayChip d="SUN" t="27" glyph="haze" />
          <DayChip d="MON" t="26" glyph="rain" />
          <DayChip d="TUE" t="28" glyph="sun"  />
          <DayChip d="WED" t="29" glyph="sun"  />
        </div>
        <Coord>Mataram station · IDN</Coord>
      </div>

      <div>
        <Label>Activity</Label>
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          <div style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--hair)" }}>
            <Avatar name="G" size={16} tone="clay" />
            <div>
              <span className="t-italic">Giraf</span> added Rinjani permit · <span className="t-mono" style={{ color: "var(--ink-3)", fontSize: 11 }}>€88</span>
              <div className="t-mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: ".1em", marginTop: 2 }}>2 MIN AGO</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--hair)" }}>
            <Avatar name="M" size={16} tone="sea" />
            <div>
              <span className="t-italic">Monkey</span> moved Day 03 to Gili Trawangan
              <div className="t-mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: ".1em", marginTop: 2 }}>14 MIN AGO</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "6px 0" }}>
            <div style={{
              width: 16, height: 16, borderRadius: 99,
              background: "var(--moss-tint)", color: "var(--moss)",
              fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>/</div>
            <div>
              <span className="t-italic" style={{ color: "var(--moss)" }}>Assistant</span> suggested 3 packing items for Rinjani
              <div className="t-mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: ".1em", marginTop: 2 }}>1 HR AGO</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Center column for trip dashboard ──────────────────────
function TripCenter() {
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto", background: "var(--bg)" }}>
      {/* Hero */}
      <div style={{ position: "relative", padding: "36px 44px 28px", borderBottom: "1px solid var(--hair)", background: "var(--sea-tint)", overflow: "hidden" }}>
        <TopoBg tone="sea" opacity={0.14} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <Label>Trip 02 · upcoming</Label>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 6 }}>
              <h1 className="t-display" style={{ fontSize: 96, margin: 0, color: "var(--ink)", lineHeight: 0.9 }}><em>Lombok</em></h1>
              <WaveGlyph color="var(--sea)" w={80} h={16} />
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 10, alignItems: "center" }}>
              <div className="t-mono" style={{ fontSize: 12, color: "var(--ink)", letterSpacing: ".06em" }}>INDONESIA</div>
              <span style={{ width: 4, height: 4, borderRadius: 99, background: "var(--ink-3)" }} />
              <div className="t-mono" style={{ fontSize: 12, color: "var(--ink)", letterSpacing: ".06em" }}>JUN 12 — JUN 20, 2026</div>
              <span style={{ width: 4, height: 4, borderRadius: 99, background: "var(--ink-3)" }} />
              <div className="t-mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>8.7° S · 116.3° E</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <PairAvatar size={26} />
            <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-2)", letterSpacing: ".18em", textTransform: "uppercase", marginTop: 8 }}>
              2 travellers
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 6 }}>
              <button style={{
                background: "var(--ink)", color: "var(--paper)", border: 0, borderRadius: 6,
                padding: "8px 14px", fontFamily: "var(--font-mono)", fontSize: 10,
                letterSpacing: ".22em", textTransform: "uppercase", cursor: "pointer",
              }}>+ event</button>
              <button style={{
                background: "transparent", color: "var(--ink-2)", border: "1px solid var(--rule)", borderRadius: 6,
                padding: "8px 14px", fontFamily: "var(--font-mono)", fontSize: 10,
                letterSpacing: ".22em", textTransform: "uppercase", cursor: "pointer",
              }}>share</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 28, padding: "12px 44px 0", borderBottom: "1px solid var(--hair)" }}>
        {[
          { id: "itin", l: "Itinerary", active: true,  count: "8 days" },
          { id: "pack", l: "Packing",   active: false, count: "8/17" },
          { id: "bud",  l: "Budget",    active: false, count: "€379" },
          { id: "note", l: "Notes",     active: false, count: "3" },
          { id: "map",  l: "Map",       active: false, count: "" },
        ].map(t => (
          <div key={t.id} style={{
            padding: "10px 0 12px",
            borderBottom: "2px solid " + (t.active ? "var(--ink)" : "transparent"),
            display: "flex", alignItems: "center", gap: 8,
            cursor: "pointer",
          }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              letterSpacing: ".22em", textTransform: "uppercase",
              color: t.active ? "var(--ink)" : "var(--ink-3)",
            }}>{t.l}</span>
            {t.count ? <span className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>· {t.count}</span> : null}
          </div>
        ))}
      </div>

      {/* Itinerary main: two-column layout */}
      <div style={{ padding: "28px 44px 60px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 36 }}>
        {/* timeline */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
            <Label>Itinerary · 8 days</Label>
            <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>drafted together · last edit 2 min ago</div>
          </div>
          {ITINERARY.slice(0, 6).map((d, i) => (
            <div key={d.d} style={{ position: "relative", display: "grid", gridTemplateColumns: "76px 1fr", gap: 20, padding: "14px 0" }}>
              <div style={{ position: "relative" }}>
                <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".14em" }}>DAY {d.d}</div>
                <div className="t-display" style={{ fontSize: 38, color: "var(--ink)", lineHeight: 1, marginTop: 2 }}>{d.dow}</div>
                <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>{d.date}</div>
                {i < 5 && (
                  <div style={{
                    position: "absolute", left: 32, top: 70, bottom: -14, width: 1, background: "var(--hair)",
                  }} />
                )}
              </div>
              <div style={{
                background: "var(--paper)", border: "1px solid var(--hair)",
                borderLeft: `3px solid var(--${d.tone})`,
                borderRadius: 8, padding: "16px 18px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <MonoBadge tone={d.tone}>{d.tag}</MonoBadge>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Avatar name={i % 2 === 0 ? "M" : "G"} size={18} tone={i % 2 === 0 ? "sea" : "clay"} />
                    <Chevron />
                  </div>
                </div>
                <div className="t-display" style={{ fontSize: 26, color: "var(--ink)", lineHeight: 1.1, marginBottom: 4 }}>{d.title}</div>
                <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5, maxWidth: 520 }}>{d.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* side cards (notes / map / AI) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--hair)" }}>
              <Label>Region map</Label>
            </div>
            <div style={{ position: "relative", aspectRatio: "1 / 1", background: "var(--sea-tint)", overflow: "hidden" }}>
              <TopoBg tone="sea" opacity={0.32} />
              {/* faux pins */}
              {[
                { x: 28, y: 60, label: "Kuta",     tone: "sea"  },
                { x: 36, y: 38, label: "Gilis",    tone: "sea"  },
                { x: 68, y: 30, label: "Rinjani",  tone: "moss" },
                { x: 18, y: 70, label: "Mawi",     tone: "sand" },
              ].map((p, i) => (
                <div key={i} style={{ position: "absolute", left: p.x + "%", top: p.y + "%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
                  <div style={{ width: 8, height: 8, borderRadius: 99, background: `var(--${p.tone})`, margin: "0 auto 3px", boxShadow: "0 0 0 4px var(--paper)" }} />
                  <Coord>{p.label}</Coord>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            background: "var(--paper)", border: "1px solid var(--hair)", borderRadius: 10,
            padding: "14px 16px", borderLeft: "3px solid var(--moss)",
          }}>
            <Label style={{ color: "var(--moss)" }}>/ assistant</Label>
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Day 05 has a 4-hour drive after the ferry. Want me to <span className="t-italic" style={{ color: "var(--ink)" }}>split it across two days</span> so you're not arriving in Senaru tired?
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <button style={{
                background: "var(--ink)", color: "var(--paper)", border: 0, borderRadius: 6,
                padding: "7px 12px", fontFamily: "var(--font-mono)", fontSize: 9.5,
                letterSpacing: ".2em", textTransform: "uppercase", cursor: "pointer",
              }}>apply</button>
              <button style={{
                background: "transparent", color: "var(--ink-2)", border: "1px solid var(--rule)", borderRadius: 6,
                padding: "7px 12px", fontFamily: "var(--font-mono)", fontSize: 9.5,
                letterSpacing: ".2em", textTransform: "uppercase", cursor: "pointer",
              }}>dismiss</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Desktop #1: Trip Dashboard ────────────────────────────
function DesktopTripDashboard() {
  return (
    <div style={{ display: "flex", height: "100%", background: "var(--bg)", color: "var(--ink)", fontFamily: "var(--font-body)" }}>
      <LeftRail active="trips" />
      <TripCenter />
      <RightRail />
    </div>
  );
}

// ─── Desktop #2: Workspace Home ────────────────────────────
function DesktopWorkspaceHome() {
  const trips = [
    { name: "Lombok",       country: "Indonesia",   date: "Jun 12 – Jun 20, 2026", days: 8, status: "upcoming", tone: "sea",  coord: "8.7° S · 116.3° E",  tag: "Surf · Dive · Trek" },
    { name: "Andalucía",    country: "Spain",        date: "Apr 04 – Apr 11, 2026", days: 8, status: "past",     tone: "clay", coord: "37.4° N · 5.9° W",   tag: "Road trip" },
    { name: "Faroe Islands",country: "Denmark",      date: "Sep 22 – Sep 28, 2025", days: 7, status: "past",     tone: "moss", coord: "62.0° N · 6.8° W",   tag: "Hike · Sail" },
  ];
  return (
    <div style={{ background: "var(--bg)", color: "var(--ink)", fontFamily: "var(--font-body)", minHeight: "100%", padding: "44px 60px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <Label>Together · workspace</Label>
          <h1 className="t-display" style={{ fontSize: 80, lineHeight: 0.95, margin: "10px 0 0", color: "var(--ink)" }}>
            Hello, <em>Monkey</em>.
          </h1>
        </div>
        <div style={{ textAlign: "right" }}>
          <Coord>05 / 26 / 2026 · Tuesday</Coord>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <PairAvatar size={26} />
          </div>
        </div>
      </div>

      <div className="rule" style={{ margin: "28px 0 12px" }} />

      <div style={{ display: "flex", gap: 28, fontSize: 12.5, color: "var(--ink-2)" }}>
        <div><span className="t-num" style={{ color: "var(--ink)", fontSize: 16 }}>03</span> &nbsp;<span className="t-mono" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--ink-3)" }}>Trips</span></div>
        <div><span className="t-num" style={{ color: "var(--ink)", fontSize: 16 }}>17</span> &nbsp;<span className="t-mono" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--ink-3)" }}>Days away in 2026</span></div>
        <div><span className="t-num" style={{ color: "var(--ink)", fontSize: 16 }}>04</span> &nbsp;<span className="t-mono" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--ink-3)" }}>Dream places</span></div>
        <div style={{ marginLeft: "auto" }}><span className="t-mono" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--sea)" }}>● Giraf editing Day 03</span></div>
      </div>

      <div style={{ marginTop: 44, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
        {trips.map(t => (
          <div key={t.name} style={{
            background: "var(--paper)", border: "1px solid var(--hair)",
            borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
          }}>
            <div style={{ position: "relative", aspectRatio: "16 / 10", background: `var(--${t.tone}-tint)`, overflow: "hidden" }}>
              <TopoBg tone={t.tone} opacity={0.16} />
              <div style={{ position: "absolute", inset: 0, padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <MonoBadge tone={t.tone}>{t.tag}</MonoBadge>
                  <Coord>{t.coord}</Coord>
                </div>
                <div>
                  <div className="t-display" style={{ fontSize: 44, color: "var(--ink)", lineHeight: 1 }}>
                    <em>{t.name}</em>
                  </div>
                  <div className="t-mono" style={{ fontSize: 10, letterSpacing: ".22em", color: "var(--ink-2)", marginTop: 4, textTransform: "uppercase" }}>
                    {t.country}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="t-mono" style={{ fontSize: 11, color: "var(--ink)" }}>{t.date}</div>
                <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>{t.days} days · {t.status === "upcoming" ? "in 17 days" : "past trip"}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <PairAvatar size={20} />
                <Chevron />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Dream board */}
      <div style={{ marginTop: 48 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <Label>Dream board · 4</Label>
          <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>someday, together</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {[
            { name: "Faroe Islands", coord: "62.0° N · 6.8° W",  tone: "moss", note: "off-season sail · sept"   },
            { name: "Patagonia",     coord: "50.0° S · 73.0° W", tone: "clay", note: "torres trek · 5 days"    },
            { name: "Hokkaido",      coord: "43.0° N · 142° E",  tone: "sea",  note: "winter onsen · febuary"  },
            { name: "Aeolian Isles", coord: "38.5° N · 14.9° E", tone: "sand", note: "sail vulcano → stromboli"},
          ].map(d => (
            <div key={d.name} style={{
              position: "relative",
              aspectRatio: "4 / 5",
              border: "1px solid var(--hair)", borderRadius: 10,
              background: `var(--${d.tone}-tint)`,
              padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between",
              overflow: "hidden",
            }}>
              <TopoBg tone={d.tone} opacity={0.12} />
              <Label style={{ position: "relative", color: `var(--${d.tone})` }}>/ dream</Label>
              <div style={{ position: "relative" }}>
                <div className="t-display" style={{ fontSize: 26, color: "var(--ink)" }}><em>{d.name}</em></div>
                <Coord>{d.coord}</Coord>
                <div className="t-italic" style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8 }}>{d.note}</div>
              </div>
            </div>
          ))}
          <div style={{
            aspectRatio: "4 / 5",
            border: "1px dashed var(--rule)", borderRadius: 10,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
            cursor: "pointer",
          }}>
            <Chevron dir="up" />
            <span className="t-mono" style={{ fontSize: 10, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--ink-3)" }}>+ pin a dream</span>
          </div>
        </div>
      </div>
    </div>
  );
}

window.DesktopTripDashboard = DesktopTripDashboard;
window.DesktopWorkspaceHome = DesktopWorkspaceHome;
