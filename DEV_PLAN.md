# TickPulse — Dev Plan (v2 · trimmed to essentials)

> Trader-first roadmap for an intraday volume & order-flow terminal. Aesthetic: **Obsidian Flux**
> (dark default). Guiding rule for this revision: **only what's truly necessary** — the right
> signals at the right density, never the kitchen sink. Status: **draft for review.**

---

## 0. Design language — "Obsidian Flux"

Realized Stitch designs live in the repo (dark = default, light = "Daylight"):

```
design/stitch_volume_pulse_monitor/
├── obsidian_flux/DESIGN.md               ← DARK design system (DEFAULT)
├── precision_trading_interface/DESIGN.md ← LIGHT design system ("Daylight")
├── scanner_obsidian_dark_theme/      + scanner_daylight_light_theme/
├── marketwatch_obsidian_dark_theme/  + marketwatch_daylight_light_theme/
├── alerts_obsidian_dark_theme/       + alerts_daylight_light_theme/
├── settings_obsidian_dark_theme/     + settings_daylight_light_theme/
├── analytics_obsidian_dark_theme/    (dark only in this drop)
└── dashboard_daylight_light_theme/   (light only in this drop)
```

**Personality**: "Tools, not art." Technical-brutalist + minimal — a hairline-separated
*spreadsheet* feel, sharp corners, monospaced numbers, color = direction. Dark by default to
reduce eye strain. **Not too dense, not too sparse**: each screen shows only the signals that
change a decision.

### Tokens — Obsidian Flux (dark · default)
| Role | Hex |
|---|---|
| desk / background / panel | `#111418` (card-lowest `#0b0e12`) |
| container low / mid / high / highest | `#191c20` / `#1d2024` / `#272a2f` / `#32353a` |
| hairline (outline-variant) / outline | `#424753` / `#8c909f` |
| text / text-variant | `#e1e2e8` / `#c2c6d6` |
| primary — accent · focus · **VWAP** | `#aec6ff` · container `#4e8eff` |
| **up / buy** (secondary) | `#4ae176` · tint `rgba(74,225,118,0.14)` |
| **down / sell** (tertiary) | `#ffb3ad` · strong `#ff5451` · tint `rgba(255,84,81,0.14)` |
| caution / indicators | amber `#f59e0b` · cyan for overlays |

> Unlike the earlier "Obsidian Terminal", Flux puts **true green/red in the palette** (secondary
> green / tertiary red), so direction stays unambiguous in dark mode with no overrides.

### Tokens — Daylight (light · "Precision Trading Interface")
surface `#fbf9f8`, card `#ffffff`, hairline `#c1c6d3`, text `#1b1c1c` / `#414751`,
primary `#005cab`, up `#006e12`, down `#b02528`. Same layout & semantics; theme is a token swap.

### Type, density & motion
- **UI = Inter** (headline 24/18, body 13/11, label-caps 10 uppercase-tracked).
- **Data/numbers = JetBrains Mono** (16/13/11), **right-aligned, tabular** — no jitter on ticks.
- **30 px rows · 1 px hairlines (no shadows) · sharp 0 px corners** (2 px on buttons) · panel-pad 12 px.
- **Motion rationed**: 300 ms green/red cell flash on tick · breakout-row glow · sparkline redraw. Nothing else moves. Honor `prefers-reduced-motion`.
- **Every metric/column/widget has an ⓘ "How: … · Means: …" tooltip.**

---

## 1. Foundations (necessary — build first)

- **A. `settings.ts`** — versioned `tickpulse.settings` in `localStorage` (`load/save/migrate`),
  migrating the existing `tickpulse.breakout`. **Survives refresh AND logout** (logout only clears
  the server `kite_session` cookie; `localStorage` is untouched). Persists: watchlists,
  `activeWatchlist`, breakout thresholds, per-screen sort/filters/columns, `activeSection`, theme,
  alert prefs, pinned/muted.
- **B. Routing** — `@solidjs/router` for the 5 sections + deep link `/analytics/:symbol`.
- **C. `InfoTip` + `help.ts`** — one tooltip component, one copy registry feeding tooltips *and*
  column `title`s.
- **D. Configurable watchlist + instruments dump** — store **slot allocator** (`MAX_N = 1024`,
  per-token `idx` on demand) so symbols are dynamic; `/auth/instruments` proxy (daily-cached CSV →
  slim JSON) for search; falls back to local `universe.ts` when not logged in.
- **E. Store fields** (all O(1) in `ingest()`): `open/high/low`, `oi`, `lastTickAt`, `cumDelta`,
  latest `depth`, derived `turnover`.

---

## 2. Screens (trimmed to the right signals)

### 2.1 Scanner — the core (match the design's **9 columns** exactly — that *is* the right density)
- **Left rail**: configurable **Saved Scans** (LIVE badge, description, symbol count, pin; ＋ New).
- **Controls**: filter chips **Min RVOL · Min Turnover · Price band**; **sort** + **column gear**.
- **Columns**: **Symbol · LTP** (flash) **· Chg% · Spark** (w/ dashed VWAP) **· Vol Surge • Flow**
  (RVOL × + ▲/▼ + green/red buy-sell split bar) **· Turnover ₹ · Day Range** (LTP · VWAP · open) **·
  Depth** (mini → popover) **· Fresh** (dot + age). Breakout rows **glow**.
- **Sort**: RVOL · Turnover · Buy/Sell imbalance · % from day high · VWAP distance · Chg% · Spike
  recency. **Filters**: above-VWAP · buy-flow-only · F&O-only.
- *Resist adding more columns — this is the "right amount."*

### 2.2 Dashboard — cockpit (calm)
Index strip · **Top Volume Bursts** (hero) · Buy/Sell-flow leaders · breadth bar · **My Focus**
(pinned) · **Live Alerts** feed. Only the burst list + alerts animate.

### 2.3 Marketwatch — configurable watchlists
List manager (create/rename/delete/enable/reorder) + **instrument search** → dense grid:
**Symbol · LTP · Chg% · RVOL · Turnover · VWAP dist · % from H/L · Fresh** + row actions
(pin/mute/chart/remove). Active list → `subscribe()/unsubscribe()`.

### 2.4 Analytics — per-symbol deep dive (`/analytics/:symbol`)
Header (big LTP, Chg%, RVOL-vs-avg, Buy/Sell). **Hero**: intraday price chart + **volume bars
colored by buy/sell flow**, **VWAP + PDC/ORH-ORL** overlays, 1m/5m/15m. **Right**: per-symbol
order-book pressure + **5-level depth ladder**. **CVD** strip. Compact stats grid.

### 2.5 Alerts
**Watch / High / Spike** threshold sliders + **cooldown** (live preview sentence) + a couple of
qualifiers (min turnover, above-VWAP). **Delivery**: toast · sound · desktop. **Recent alerts log**.

### 2.6 Settings (all persisted)
Theme (Obsidian/Daylight) · data source (Live/Demo) · watchlists · per-screen columns/sort/density
· alerts · **Reset to defaults**.

---

## 3. Roadmap — only what's truly necessary

**Core A — foundation**: `settings.ts` · router · `InfoTip`+`help.ts` · store slot-allocator + fields.

**Core B — the product** (all live-socket-only): Scanner (full columns + sort + filters + saved
scans + depth popover) · Marketwatch (configurable watchlists + instruments) · Settings (persisted)
· Dashboard (live widgets) · Alerts (thresholds + delivery + log).

**Core C — polish**: Analytics (chart + depth + CVD + levels) · dark/light theme toggle · pin/mute ·
audio · per-row freshness.

### Later — needs external data (explicitly deferred, not blocking v1)
| Item | Needs |
|---|---|
| 20-day RVOL, ATR, PDH/PDL, full-day chart backfill | Kite **historical API** |
| Index strip values · sector treemap | **index/sector subscription** + metadata |
| OI + price buildup | **F&O subscription** |
| One-click order ticket | **Orders API** (use Kite deep-link until then) |

### Cut from v1 (not necessary — add only if traders ask)
AND/OR rule builder · trade-frequency / volume-profile heatmap · block-trade detection · settings
export/import · custom multi-pane layouts.

---

## 4. Guardrails
- **Zero-jank stays**: per-tick work is O(1) SoA in `ingest()`/`render.ts`; charts on canvas; motion only on change.
- **No undocumented numbers**: every metric ships with its `help.ts` entry.
- **Refresh/logout-safe**: all prefs via CSS variables + `tickpulse.settings`.
- **Density discipline**: ~9 columns / 30 px rows on Scanner is the target — *right signals, not all signals.*
