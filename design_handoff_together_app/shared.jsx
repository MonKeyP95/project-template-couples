// shared.jsx — tiny editorial primitives used across screens
// All components attached to window at the bottom for cross-file scope.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── Mono uppercase label ───────────────────────────────────
function Label({ children, style, className = "" }) {
  return (
    <div className={"t-label " + className} style={style}>{children}</div>
  );
}

// ─── Section header used inside mobile screens ──────────────
function SectionHead({ label, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <Label>{label}</Label>
      {right ? <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: ".06em" }}>{right}</div> : null}
    </div>
  );
}

// ─── Avatar (initial), shared affordance ────────────────────
function Avatar({ name, size = 22, tone = "sea" }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const color = tone === "sea" ? "var(--sea)" : tone === "clay" ? "var(--clay)" : tone === "moss" ? "var(--moss)" : "var(--ink-2)";
  return (
    <div
      title={name}
      style={{
        width: size, height: size, borderRadius: 999,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "var(--paper)", color,
        border: "1px solid " + color,
        fontFamily: "var(--font-mono)",
        fontSize: Math.max(9, size * 0.42),
        fontWeight: 500,
        letterSpacing: 0,
      }}
    >{initial}</div>
  );
}

// pair of avatars overlapping — the canonical "ours" mark
function PairAvatar({ a = "M", b = "G", size = 22 }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      <Avatar name={a} size={size} tone="sea" />
      <div style={{ marginLeft: -6 }}><Avatar name={b} size={size} tone="clay" /></div>
    </div>
  );
}

// ─── Striped placeholder ────────────────────────────────────
function Placeholder({ w, h, label = "image", style }) {
  return (
    <div className="placeholder" style={{ width: w, height: h, borderRadius: 4, ...style }}>
      {label}
    </div>
  );
}

// ─── Coord readout ──────────────────────────────────────────
function Coord({ children }) {
  return <span className="t-mono" style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: ".04em" }}>{children}</span>;
}

// ─── Tiny weather chip ──────────────────────────────────────
function DayChip({ d, t, glyph = "sun", active = false }) {
  const dot = {
    sun:  <circle cx="7" cy="7" r="3" fill="var(--sand)" />,
    haze: <circle cx="7" cy="7" r="3" fill="var(--sea-2)" />,
    rain: <circle cx="7" cy="7" r="3" fill="var(--sea)" />,
  };
  return (
    <div style={{
      flex: 1, textAlign: "center",
      borderLeft: "1px solid var(--hair)",
      padding: "8px 2px",
      background: active ? "var(--paper)" : "transparent",
    }}>
      <div className="t-mono" style={{ fontSize: 9, color: "var(--ink-3)", letterSpacing: ".1em" }}>{d}</div>
      <svg width="14" height="14" viewBox="0 0 14 14" style={{ margin: "4px auto 2px", display: "block" }}>{dot[glyph]}</svg>
      <div className="t-mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>{t}°</div>
    </div>
  );
}

// ─── Progress bar (thin, mono) ──────────────────────────────
function Bar({ pct, tone = "sea" }) {
  const c = tone === "sea" ? "var(--sea)" : tone === "clay" ? "var(--clay)" : tone === "moss" ? "var(--moss)" : "var(--ink-2)";
  return (
    <div style={{ height: 4, background: "var(--hair)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: pct + "%", height: "100%", background: c, transition: "width .35s ease" }} />
    </div>
  );
}

// ─── Inline checkbox row ────────────────────────────────────
function CheckRow({ done, label, who = "M", onToggle, tone = "clay" }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: "100%", background: "transparent", border: 0,
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 0", cursor: "pointer", textAlign: "left",
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: 4,
        border: "1.5px solid " + (done ? "var(--" + tone + ")" : "var(--rule)"),
        background: done ? "var(--" + tone + ")" : "transparent",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flex: "0 0 auto", transition: "all .15s",
      }}>
        {done ? (
          <svg width="10" height="10" viewBox="0 0 10 10" className="pop">
            <path d="M1.5 5.2 L4 7.5 L8.5 2.5" fill="none" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : null}
      </span>
      <span className={done ? "checked-line" : ""} style={{ flex: 1, fontSize: 14, color: done ? "var(--ink-3)" : "var(--ink)", letterSpacing: "-0.005em" }}>
        {label}
      </span>
      <Avatar name={who} size={18} tone={who === "M" ? "sea" : "clay"} />
    </button>
  );
}

// ─── Status bar overlay (tiny, fixed inside frame) ──────────
function MonoBadge({ tone = "ink", children }) {
  const c = tone === "sea" ? "var(--sea)" : tone === "clay" ? "var(--clay)" : tone === "moss" ? "var(--moss)" : "var(--ink-2)";
  return (
    <span className="t-mono" style={{
      fontSize: 9, letterSpacing: ".18em", textTransform: "uppercase",
      color: c, border: "1px solid " + c, padding: "2px 6px", borderRadius: 3,
    }}>{children}</span>
  );
}

// ─── Tiny chevron ──────────────────────────────────────────
function Chevron({ dir = "right", size = 10, color = "var(--ink-3)" }) {
  const rot = { right: 0, left: 180, up: -90, down: 90 }[dir];
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ transform: `rotate(${rot}deg)`, transition: "transform .2s" }}>
      <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Topographic background SVG (very subtle) ───────────────
function TopoBg({ tone = "sea", opacity = 0.07 }) {
  const color = tone === "sea" ? "var(--sea)" : tone === "clay" ? "var(--clay)" : tone === "moss" ? "var(--moss)" : "var(--sand)";
  return (
    <svg width="100%" height="100%" viewBox="0 0 400 400" preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
      <defs>
        <pattern id="topo" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          <circle cx="40" cy="40" r="6" fill="none" stroke={color} strokeWidth="0.6"/>
          <circle cx="40" cy="40" r="14" fill="none" stroke={color} strokeWidth="0.6"/>
          <circle cx="40" cy="40" r="24" fill="none" stroke={color} strokeWidth="0.6"/>
          <circle cx="40" cy="40" r="36" fill="none" stroke={color} strokeWidth="0.6"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#topo)" />
    </svg>
  );
}

// ─── Wave glyph (decorative, used on Trip hero) ─────────────
function WaveGlyph({ color = "currentColor", w = 80, h = 16 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 80 16" style={{ display: "block" }}>
      <path d="M0 8 Q 5 1, 10 8 T 20 8 T 30 8 T 40 8 T 50 8 T 60 8 T 70 8 T 80 8"
        fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

Object.assign(window, {
  Label, SectionHead, Avatar, PairAvatar, Placeholder, Coord,
  DayChip, Bar, CheckRow, MonoBadge, Chevron, TopoBg, WaveGlyph,
});
