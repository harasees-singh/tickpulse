# Stitch Prompt — "TickPulse" Intraday Volume & Order‑Flow Terminal

**How to use this:** Stitch works screen‑by‑screen. Paste **Block 0 (Design System)** first so
the visual language is set, then paste each **Screen block** to generate that page. Generate a
**dark theme** primary and a **light theme** variant of each. Keep the same shell/nav across all
screens.

---

## BLOCK 0 — App, audience & design system (paste first)

Design a **professional intraday trading terminal** called **TickPulse** for **active Indian
(NSE/BSE) intraday traders and scalpers**. It consumes a **real‑time tick WebSocket** (live
price/volume/market‑depth) and a **historical API** (intraday candles, previous‑day levels,
20‑day averages). The single goal: **let a trader spot a volume burst and decide BUY or SELL in
under a second.** Everything must be **glanceable, dense, color‑coded, keyboard‑friendly, and
configurable.** This is a "tools, not art" terminal — think Bloomberg/quant‑desk, not a consumer
app.

**Core design principles (apply to every screen):**
- **Decide‑in‑milliseconds hierarchy:** the most decision‑critical signal in any row/card must be
  the largest / highest‑contrast element. Minimize reading; encode meaning in color, size, and
  position. A trader should never have to parse a sentence.
- **Color = instant meaning:** green = up / buying / bullish, red = down / selling / bearish,
  amber = caution/elevated, violet = VWAP, blue = neutral selection/focus. Use these consistently
  everywhere; never use green/red decoratively.
- **Numbers are sacred:** all prices, %, volumes, and stats use a **monospaced, tabular** font so
  columns align for fast vertical scanning. Right‑align numeric columns.
- **Motion is rationed:** only *live changes* animate — a 120 ms green/red background flash on a
  price/▲▼ change, a soft pulse on a fresh alert, sparkline redraws. Everything else is static.
  Respect `prefers-reduced-motion`.
- **Density:** compact rows (~30 px), 1 px hairline separators (no heavy borders or shadows),
  tight padding, high information density without feeling cramped.
- **Configurable & accessible:** every screen's columns, watchlists, alert thresholds, sort, and
  layout are user‑configurable; a global **command palette (⌘K / Ctrl‑K)** jumps to any symbol,
  scan, or page; keyboard navigation throughout.
- **Self‑documenting:** **every metric, column header, gauge, and widget has a small "ⓘ" info
  affordance** that on hover/click shows a 2‑line popover — "**How:** \<formula\> · **Means:**
  \<trader takeaway\>". No undocumented indicator anywhere.

### Dark theme — "Obsidian" (primary)
| Role | Hex |
|---|---|
| App background (deepest) | `#0A0D11` |
| Panel / surface | `#111418` |
| Card | `#171B21` |
| Elevated / hover | `#1D232A` |
| Hairline / border | `#262D35` |
| Text primary | `#E6E9EE` |
| Text secondary | `#9AA4B2` |
| Text muted | `#5B6675` |
| Accent / focus / selection | `#4C8DFF` |
| Up / Buy (bright green) | `#22C55E` · tint `rgba(34,197,94,0.14)` |
| Down / Sell (bright red) | `#EF4444` · tint `rgba(239,68,68,0.14)` |
| Caution / elevated | `#F59E0B` |
| VWAP line | `#A78BFA` |
| Info | `#22D3EE` |

### Light theme — "Daylight"
App `#FBF9F8`, card `#FFFFFF`, hairline `#E2E2E2`, text `#1B1C1C`/`#5B6675`, accent `#005CAB`,
up `#06893A`, down `#D32F2F`, VWAP `#6D28D9`. Same semantics, same layout.

**Typography:** UI labels = Inter; all numeric/data = **JetBrains Mono** (tabular). Uppercase
11 px tracked labels for column/section headers; 12–13 px data; 22–30 px for hero numbers.
**Icons:** thin line icons (Lucide / Material Symbols Outlined).

### Global shell (on every screen)
- **Left icon+label sidebar (collapsible):** logo "TickPulse"; nav = **Dashboard, Scanner,
  Marketwatch, Analytics, Alerts, Settings**; footer = connection status dot ("LIVE • 14 ms" /
  "MOCK" / "MARKET CLOSED"), Zerodha account chip, Connect/Logout.
- **Top bar:** global symbol/scan **search with ⌘K hint**; segment tabs **NSE · BSE · F&O · MCX**;
  a compact **market‑context strip** (NIFTY, BANKNIFTY with LTP+Chg% colored, plus a tiny
  advancers/decliners breadth bar); right side = a **bell with live‑alert count**, theme toggle,
  and a clock showing **IST + market session state** (Pre‑open / Open / Closed).
- **Bottom‑right status pill:** WS latency (ms), ticks/sec throughput, render FPS, data freshness.
- **Toasts:** critical breakout alerts slide in bottom‑center (symbol, "VOLUME SPIKE · BUYING",
  RVOL, ▲, dismissible, optional sound).

Deliver **dark + light** for each screen below, with realistic NSE sample data (RELIANCE, HDFCBANK,
TATAMOTORS, ZOMATO, ICICIBANK, INFY, SBIN, ADANIENT, etc.), realistic prices, %s, and volumes.

---

## SCREEN 1 — Scanner (Volume‑Burst Leaderboard) — THE CORE

A full‑height, real‑time **scanner table** ranking instruments by unusual volume, designed so a
trader can read "what's surging, how big, and which side (buy/sell)" in one glance.

**Layout, top → bottom:**
1. **Header row:** title "Scanner", a row of **filter chips** — segment (NSE/F&O), **Min RVOL**,
   **Min ₹ Turnover**, **Price band**, toggles **Above VWAP**, **Buy‑flow only**, **F&O‑only
   (shortable)** — plus a **Sort dropdown** (RVOL · Turnover · Buy/Sell imbalance · % from day
   high · VWAP distance · Chg% · Spike recency) and a **column‑chooser** gear.
2. **Left rail (240 px):** saved **scans/watchlists** (e.g. "Momentum scalp", "F&O movers",
   "My focus"), each a card with name + count + enabled toggle; "＋ New scan".
3. **The table (fills the rest):** sticky header, ~30 px rows, hairline separators, hover reveals
   row actions. **Columns (left→right):**
   - **Symbol** — bold ticker + tiny "NSE · EQ" tag; a small ★ pin and 🔕 mute on hover.
   - **LTP** — mono; **flashes** green/red on tick.
   - **Chg%** — colored pill (vs previous close).
   - **Price spark** — a tiny line of the last ~60 ticks, green if above previous close else red,
     with a faint **violet dotted VWAP line** through it.
   - **Vol Surge · Flow** ⭐ *(the hero column — make it the visual anchor)* — a large mono **RVOL
     "×" number** with a **▲ or ▼ aggressor arrow**, and beneath it a **horizontal split bar
     where the bar's LENGTH = surge magnitude and the green/red split = buyer‑ vs seller‑initiated
     volume (order‑flow / CVD).** So "4.8× ▼" with a mostly‑red bar = a big SELLING surge.
   - **₹ Turnover** — value traded today (e.g. "₹482 Cr"); conviction/liquidity.
   - **Day Range** — a thin horizontal track from day‑low→day‑high with a **dot for LTP**, a small
     **tick for VWAP** and a faint mark for **open**; shows where price sits in the range.
   - **Depth** — a tiny **bid‑vs‑ask imbalance** mini‑bar; clicking opens the **Depth popover**
     (see Appendix A).
   - **Fresh** — a freshness dot (green=ticking, grey=stale "8s") + time since last spike.
   - **Actions (hover):** chart, quick‑trade (Buy/Sell), set alert, pin.
4. **Row states:** a **fresh breakout** row briefly **glows** (amber=High, red=Spike) with a left
   accent bar; muted rows are dimmed; the selected row is accent‑outlined.

Show it **busy and alive** — several rows mid‑flash, a couple glowing from fresh spikes, varied
buy/sell splits, a toast firing. Make **Vol Surge · Flow** unmistakably the dominant column.

---

## SCREEN 2 — Dashboard (Market Cockpit)

The "state of my market right now" home a trader stares at between trades. A **bento grid**:
- **Top full‑width strip:** large index tiles — NIFTY, BANK NIFTY, FINNIFTY, SENSEX — each with
  big mono LTP, Chg% (colored), and a micro‑sparkline; plus an **advance/decline breadth bar**.
- **Hero (left, large):** **Top Volume Bursts** — a compact live list (top 8 by RVOL) with
  symbol, RVOL×, ▲/▼ buy‑sell arrow, ₹turnover; rows flash.
- **Sector heatmap (center):** a **treemap** of sectors → tiles **sized by turnover, colored by
  Chg%** (green↔red gradient); hover → mini popover (symbol, vol, RVOL).
- **Right rail:** **My Focus** (pinned symbols, live quotes) on top; **Live Alerts feed** below
  (newest breakouts with symbol, "BUYING/SELLING", RVOL, time).
- **Two small KPI cards:** **Order‑flow tilt** (aggregate buy vs sell pressure gauge, BULLISH/
  BEARISH) and **Market activity** (ticks/min, trading turnover).

Calm and scannable; only the burst list and alert feed animate.

---

## SCREEN 3 — Marketwatch (configurable watchlists)

The workspace where the trader **defines what the terminal watches** (drives subscriptions).
- **Left:** **watchlist manager** — cards per list (name, N instruments, Enabled toggle, drag to
  reorder), "＋ New list", and an **instrument search** (type "REL…" → dropdown of matches from
  the instruments dump: symbol, name, exchange, segment) to **add** rows.
- **Main:** a **dense live quote grid** for the active list (columns: Symbol, LTP (flash), Chg%
  pill, RVOL, ₹Turnover, **Distance from VWAP** (%, green above/red below), **% from day H/L**,
  **Freshness**, quick actions). Active list highlighted with an accent left border.
- Per‑row: pin/star, mute, open chart, remove. Editable, reorderable columns.

---

## SCREEN 4 — Symbol Analytics (per‑symbol deep dive — "should I take this trade?")

Deep‑linkable page for one instrument. Top = **symbol header** (big name + segment tag, hero
**LTP** with Chg%, "RVOL vs 20‑day", quick **Buy/Sell** buttons). Then a **bento workbench**:
- **Hero chart (8/12 width):** an **intraday price chart** (candles or area) with a **volume
  histogram below, each bar colored by buy/sell aggression**; overlays for **VWAP** (violet),
  **previous‑day close/high/low (PDC/PDH/PDL)** and **opening‑range high/low** as horizontal
  reference lines; timeframe toggle **1m · 5m · 15m**.
- **Order‑book pressure (4/12):** this symbol's **total bid vs ask** as a vertical gauge + the
  **5‑level depth ladder** (price, size, size‑bar) — see Appendix A.
- **Cumulative Delta (CVD) strip:** a line of accumulated signed volume (buying−selling) over the
  day — net aggression trend.
- **Trade‑frequency / volume‑profile heatmap (full width):** time (x) × price (y) grid, cell
  intensity = volume; shows acceptance/rejection zones and the day's high‑volume node.
- **Stats grid:** RVOL (vs 20‑day), ATR, ₹turnover, spread, day O/H/L, VWAP, **OI + price
  buildup** (for F&O: a long/short‑buildup quadrant tag), circuit limits.
- Footer: **Add to compare · Add to watchlist · Set alert · Quick Buy · Quick Sell.**

---

## SCREEN 5 — Alerts & Rules

Where the trader **configures what a "breakout" means** and how they're notified.
- **Threshold sliders:** three tiers — **Watch · High · Spike** — each a slider in σ/RVOL (e.g.
  Spike = ≥5σ or ≥4×), plus an **alert cooldown** slider. Show a live preview sentence: "A *Spike*
  fires when per‑tick volume is ≥ X above its recent average."
- **Rule builder:** add custom conditions (e.g. "RVOL > 3 AND price above VWAP AND turnover >
  ₹50 Cr AND F&O") with AND/OR chips → named alert presets.
- **Delivery:** toggles for in‑app toast, **sound**, desktop notification; "persist until
  acknowledged".
- **Recent alerts log:** a paginated table (Instrument, Surge×, Buy/Sell, LTP, Time, actions),
  "Showing 20 of 240".

---

## SCREEN 6 — Settings

Sectioned, calm, form‑dense — and **everything here is saved in the browser and survives refresh
and logout**:
- **General:** theme (Dark "Obsidian" / Light "Daylight"), reduced‑motion, default landing page.
- **Data source:** Live (Zerodha session, with Connect/Logout + token‑expiry note that it must be
  renewed daily) vs Simulated demo.
- **Watchlists:** same manager as Marketwatch.
- **Columns & layout:** per‑screen column visibility + order, row density.
- **Alerts:** mirror of Screen 5 essentials.
- **Reset to defaults**; optional export/import settings JSON.

(Plus a minimal **Connect screen**: centered "Connect your Zerodha account", a single primary
"Login with Kite" button, a one‑line security note, and a "Continue with demo data" link.)

---

## APPENDIX A — Market Depth popover/panel (used in Scanner & Analytics)
A compact **5‑level order‑book ladder**: two stacked columns — **Bids (green)** and **Asks
(red)** — each row shows price · quantity · order‑count, with a horizontal **size bar** behind the
quantity (longer = bigger resting size). Header shows **total bid qty vs total ask qty** as a
split bar and the **spread**. A marker shows the last traded price between bid/ask. Hovering a
level highlights it.

## APPENDIX B — The "Vol Surge · Flow" cell (most important component — get it perfect)
One cell that answers three questions at once: **how unusual, which direction, and who's
winning.** Render: a bold mono **"4.8×"**, a **▲ (green) / ▼ (red)** aggressor arrow, and below a
**6 px horizontal bar inside a track** where (a) the **filled length** = surge magnitude (clamped
at ~4×=full) and (b) the fill is **split green↔red by the buy vs sell volume share** (e.g. 30%
green / 70% red = selling‑dominated surge). The number's color also follows the dominant side.
This must read instantly from across the room.

## APPENDIX C — States to design for every data view
Live/streaming (flashing), **loading skeleton**, **empty** ("No instruments — add to your
watchlist"), **stale/market‑closed** (dimmed + "Last snapshot · market closed" banner),
**disconnected** (amber banner "Reconnecting…"), and **error**.

---

### Deliverables requested from Stitch
For **Scanner, Dashboard, Marketwatch, Symbol Analytics, Alerts, Settings** (+ Connect): produce
**dark (primary) and light** versions, the **global shell**, the **Depth popover**, the
**command palette (⌘K)** overlay, the **alert toast**, and the key **states** above. Maintain the
exact color tokens, the monospaced tabular numerics, the compact density, and the rule that the
**volume‑surge + buy/sell order‑flow signal is the visual hero** on every screen where it appears.

