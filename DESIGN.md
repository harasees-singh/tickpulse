# TickPulse — Real-Time Volume Tracking UI

**Design Document · v1.0**

A UI-only, high-frequency volume-tracking terminal that consumes the Zerodha
Kite Connect WebSocket (KiteTicker), tracks **hundreds of symbols concurrently**,
processes **every tick** (~5 ticks/sec/symbol), and surfaces **visual volume
alerts** — at a rock-steady **60/120 fps with zero jank**.

For the POC the live socket is replaced by a **mock ticker** that emits
*realistic* random ticks (mean-reverting price, monotonic cumulative volume,
occasional engineered bursts to exercise alerts), behind the *same interface* as
the real client so the swap is a one-liner.

---

## 1. Goals & Non-Goals

### Goals
- Ingest and **process 100% of ticks** (no dropped ticks for stats/alerts).
- Track **300–500+ symbols** concurrently without UI degradation.
- **Zero lag / zero jitter**: steady frame rate even during volume bursts.
- Real-time **volume analytics**: per-interval volume, RVOL, z-score spikes.
- **Visual alerts**: row glow, badges, sparkline emphasis, toasts, alert panel.
- **Pluggable data source**: mock ⇄ real KiteTicker via one interface.

### Non-Goals
- No backend, persistence, or order placement (UI-only POC).
- No historical/backfill charts beyond in-memory rolling windows.
- No auth UX (real integration assumes an `access_token` is supplied).

---

## 2. The "Zero-Jank" Principle (read this first)

The single most important architectural rule:

> **The tick rate must never drive the render rate.**
> Ticks are *ingested* as fast as they arrive; the screen is *painted* on a
> `requestAnimationFrame` loop that reads the **latest** value per symbol.

This gives us two independent planes:

| Plane | Cadence | Responsibility |
|---|---|---|
| **Data plane** | Per tick (bursty, ~500–5000/s) | Parse, write latest value, accumulate volume, run streaming stats, raise alerts. **Lossless.** |
| **Render plane** | Per frame (60/120 Hz) | Read latest snapshot of *visible* rows, update DOM/canvas. **Coalescing, lossy by design** (you can't see >120 updates/s anyway). |

Consequences:
- "Respond to every tick" is satisfied in the **data plane** (every tick runs
  through volume accumulation + alert logic). The **render plane** coalesces
  many ticks into one paint — visually lossless, computationally bounded.
- A burst of 5,000 ticks/s still results in ≤120 paints/s. No backlog, no jank.
- The framework (Solid/React) is **not** in the hot path. Per-tick values are
  written **directly** to DOM cells / canvas; the framework only owns
  *structure* (which rows/panels exist, layout, filters).

```
┌──────────────────────────────────────────────────────────────────┐
│ Web Worker  ── DATA PLANE (per tick, lossless) ──                 │
│   MockTicker / KiteTicker → decode → for each tick:               │
│     • SoA[idx].ltp = price                                        │
│     • volDelta = cumVol − prevCumVol ;  SoA[idx].cumVol = cumVol  │
│     • EWMA mean/var ← volDelta   → rvol, zScore                   │
│     • if zScore > threshold (and not in cooldown) → push Alert    │
│   (writes into SharedArrayBuffer; alerts into a ring buffer)      │
└───────────────▲────────────────────────────────────┬─────────────┘
                │  SharedArrayBuffer (lock-free read)  │
                │                                      ▼
┌───────────────┴──────────────────────────────────────────────────┐
│ Main thread ── RENDER PLANE (rAF @ 60/120 Hz, coalescing) ──      │
│   • TanStack Virtual → only ~40 visible rows exist in the DOM     │
│   • read latest snapshot for visible idx → patch cells + flash    │
│   • draw sparklines on (Offscreen)Canvas                          │
│   • drain alert ring buffer → toasts + Alerts panel               │
│   SolidJS owns structure only (rows, panels, sort, filters)       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack (decisive picks)

| Concern | Choice | Why |
|---|---|---|
| Build/dev | **Vite 5 + TypeScript** | Instant HMR, ESM, worker & `?worker` imports, builds on your existing TS config. |
| UI framework | **SolidJS** | Fine-grained reactivity, **no VDOM diffing** — ideal when structure is stable but values churn. (React 19 + `useSyncExternalStore` is a viable fallback; see §11.) |
| Virtualized list | **@tanstack/virtual** | Keeps DOM node count constant (~40) regardless of symbol count. |
| Sparklines/flashes | **Canvas 2D / OffscreenCanvas** | DOM/SVG per-tick updates cause paint/layout storms; canvas is O(pixels), not O(nodes). |
| Heavy charts (detail view) | **uPlot** | Fastest canvas time-series lib; ~tens of µs/redraw. |
| Concurrency | **Web Workers + SharedArrayBuffer + Atomics** | Decode + stats + alerts off the main thread = main thread free to render. |
| Worker RPC ergonomics | **Comlink** (optional) | Clean async proxy to the worker; not used on the hot path. |
| "Cold" UI state | **nanostores** (or Solid signals) | Filters, sort, selection — *not* tick data. |

> **Hot-path rule:** anything touched per-tick is plain TS over typed arrays in a
> worker. Frameworks/state libs only manage cold, low-frequency UI state.

---

## 4. Zerodha KiteTicker — what we're integrating

- **Endpoint:** `wss://ws.kite.trade?api_key=<key>&access_token=<token>`
- **Transport:** **binary** frames (big-endian). One frame packs many quotes.
  - Frame: `int16 numPackets`, then per packet `int16 length` + payload.
  - 1-byte frame = heartbeat → ignore.
- **Subscription modes** (`ltp` | `quote` | `full`):

  | Mode | Equity bytes | Contains |
  |---|---|---|
  | `ltp` | 8 | token, last_price |
  | `quote` | 44 | + qty, avg, **volume (cumulative)**, buy/sell qty, OHLC |
  | `full` | 184 | + timestamps, OI, 5-level market depth |

- **Prices** are in paise → divide by 100 (equity; other segments use
  segment-specific divisors).
- **Volume is cumulative for the day.** Per-interval volume must be derived as
  `Δvol = cumVolₜ − cumVolₜ₋₁`. **This is the heart of volume tracking** — and
  the mock mirrors it exactly so the real swap needs no UI changes.

### Pluggable client interface
```ts
// src/data/ticker.ts
export type Mode = 'ltp' | 'quote' | 'full';

export interface Tick {
  token: number;
  ltp: number;
  lastQty: number;
  cumVolume: number;       // cumulative day volume (as Kite sends it)
  avgPrice?: number;
  buyQty?: number;
  sellQty?: number;
  ohlc?: { o: number; h: number; l: number; c: number };
  ts: number;              // epoch ms
}

export interface TickerClient {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(tokens: number[]): void;
  unsubscribe(tokens: number[]): void;
  setMode(mode: Mode, tokens: number[]): void;
  on(ev: 'ticks',     cb: (ticks: Tick[]) => void): void;
  on(ev: 'connect',   cb: () => void): void;
  on(ev: 'disconnect',cb: () => void): void;
}
```
Both `MockTicker` and `KiteTickerAdapter` implement `TickerClient`. The app
depends only on the interface.

---

## 5. Realistic Mock Tick Generator

Runs **inside a Web Worker** so it never competes with rendering.

### Price realism — mean-reverting random walk (so LTP doesn't fly around)
Ornstein–Uhlenbeck / damped GBM, snapped to tick size and clamped to a circuit band:
```ts
// per symbol: { price, base, sigma, theta, tickSize, band }
function nextPrice(s: SymState, dt: number): number {
  const noise = gaussian() * s.sigma * Math.sqrt(dt);
  const meanRevert = s.theta * (s.base - s.price) * dt;   // pull toward base
  let p = s.price + meanRevert + noise * s.price;
  p = Math.round(p / s.tickSize) * s.tickSize;            // snap to tick grid
  const lo = s.base * (1 - s.band), hi = s.base * (1 + s.band);
  return Math.min(hi, Math.max(lo, p));                   // circuit clamp
}
```

### Volume realism — monotonic cumulative + heavy-tailed trade sizes
```ts
function nextVolume(s: SymState): number {
  const qty = Math.max(1, Math.round(lognormal(s.qtyMu, s.qtySigma)));
  s.cumVolume += qty;        // cumulative, like the real feed
  s.lastQty = qty;
  return s.cumVolume;
}
```

### Arrival realism — Poisson process (~5 rps/symbol), with engineered bursts
```ts
// Exponential inter-arrival → ~rps ticks/sec, naturally jittery.
function scheduleNext(s: SymState, rps: number) {
  const dt = -Math.log(1 - Math.random()) / rps;          // seconds
  return performance.now() + dt * 1000;
}
// Burst mode (news spike): for a random window, multiply rps ×8 and qtyMu +Δ
// so RVOL/z-score alerts actually fire and can be visually verified.
```

- Generator emits **batched `Tick[]`** per ~16 ms tick (coalesced at source to
  mimic Kite's multi-quote frames and reduce postMessage overhead).
- A "chaos" control in the UI lets you crank global RPS and burst frequency to
  **stress-test** the render pipeline (see §10).

---

## 6. Data Plane — store, stats, alerts

### Structure-of-Arrays store over SharedArrayBuffer (cache-friendly, zero-GC)
```ts
// src/data/store.ts  — index = stable per-token slot
const N = 1024;                       // max symbols
const sab = new SharedArrayBuffer(N * Float64Array.BYTES_PER_ELEMENT * 6);
export const ltp     = new Float64Array(sab, 0,            N);
export const cumVol  = new Float64Array(sab, N*8*1,        N);
export const volEwma = new Float64Array(sab, N*8*2,        N);
export const volVar  = new Float64Array(sab, N*8*3,        N);
export const rvol    = new Float64Array(sab, N*8*4,        N);
export const zScore  = new Float64Array(sab, N*8*5,        N);
const tokenToIdx = new Map<number, number>();
```
- Hot fields are flat typed arrays → predictable memory, **no per-tick GC**.
- Main thread reads the same `SharedArrayBuffer` (eventual-consistency reads are
  fine for a UI; no locks needed on the read side).

### Streaming stats — O(1) per tick (EWMA mean/variance)
```ts
// src/data/stats.ts  — incremental, cheap, no windows to scan
const ALPHA = 0.05;                   // smoothing
function onVolumeDelta(i: number, delta: number) {
  const mean = volEwma[i] || delta;
  const diff = delta - mean;
  volEwma[i] = mean + ALPHA * diff;
  volVar[i]  = (1 - ALPHA) * (volVar[i] + ALPHA * diff * diff);
  const sd   = Math.sqrt(volVar[i]) || 1;
  zScore[i]  = (delta - volEwma[i]) / sd;       // spike signal
  rvol[i]    = delta / (volEwma[i] || 1);       // relative volume
}
```
- **RVOL** = current interval volume ÷ typical interval volume.
- **z-score** = how many σ above normal this interval's volume is.
- (For session-aware RVOL against time-of-day baselines, bucket by minute; out
  of scope for POC but the hook is here.)

### Alert engine — tiered + cooldown (no spam)
```ts
// src/data/alerts.ts
type Tier = 'info' | 'warn' | 'critical';
const COOLDOWN_MS = 4000;
function evaluate(i: number, now: number): Alert | null {
  const z = zScore[i];
  const tier: Tier | null = z > 5 ? 'critical' : z > 3 ? 'warn' : z > 2 ? 'info' : null;
  if (!tier || now - lastAlertAt[i] < COOLDOWN_MS) return null;
  lastAlertAt[i] = now;
  return { idx: i, tier, z, rvol: rvol[i], ts: now };  // → alert ring buffer
}
```

---

## 7. Render Plane — the rAF pump

```ts
// src/render/renderPump.ts (main thread)
function startPump(getVisibleRange: () => [number, number]) {
  function frame() {
    const [start, end] = getVisibleRange();      // from TanStack Virtual
    for (let row = start; row < end; row++) {
      const i = orderedIdx[row];
      const cell = cells[row];                    // pre-bound DOM refs
      const price = ltp[i];
      if (price !== cell.lastPrice) {
        cell.ltpEl.textContent = fmt(price);
        flash(cell, price > cell.lastPrice ? 'up' : 'down'); // compositor-only
        cell.lastPrice = price;
      }
      drawSparkline(cell.canvasCtx, i);           // canvas, not DOM
      paintVolumeBar(cell, rvol[i], zScore[i]);
    }
    drainAlerts();                                // toasts + panel
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

**Why this is jank-proof**
- Constant work per frame: `O(visible rows ≈ 40)`, not `O(symbols)` or `O(ticks)`.
- Price flash uses **transform/opacity** transitions (compositor thread) — no
  layout, no main-thread paint stalls.
- Sparklines are drawn to canvas (ideally **OffscreenCanvas** in a worker), so
  hundreds of mini-charts cost pixels, not DOM nodes.
- Framework reconciliation runs **only** when structure changes (sort/filter/
  add/remove symbol), never per tick.

---

## 8. UI / UX Design

```
┌───────────────────────────────────────────────────────────────────────┐
│  TickPulse           [Filter ▾] [Sort: z-score ▾]  RPS▮▮▮▯ 🔔3  ●Live  │
├───────────────────────────────────────────────────────────────────────┤
│ Symbol   LTP        Δ%     Vol(Δ)   RVOL   z   Sparkline      Alert     │
│ RELIANCE 2,941.05 ▲ +0.42  12,400  3.1x  4.2  ▁▂▅█▆▃▁  ▲▲▲   ⚡ SPIKE   │  ← glowing row
│ INFY       1,512.30 ▼ −0.11   3,100  0.9x  0.4  ▁▁▂▁▂▁▁              │
│ TCS        3,880.00 ▲ +0.05   8,900  2.0x  2.6  ▂▃▆▅▃▂▁   ▲   ● WATCH │
│ … (virtualized — hundreds more, only ~40 in the DOM) …                 │
├───────────────────────────────────────────────────────────────────────┤
│  ALERTS (live)                                                         │
│  12:04:11  RELIANCE  z=4.2  RVOL 3.1x  ⚡ critical                      │
│  12:03:58  TCS       z=2.6  RVOL 2.0x  ● info                          │
└───────────────────────────────────────────────────────────────────────┘
```

**Visual alert language**
- **Tier color**: info = amber dot, warn = orange, critical = red.
- **Row glow**: a brief box-shadow/opacity pulse (compositor-only) on critical.
- **Volume bar**: width = RVOL, color ramps with z-score.
- **Price flash**: green/red fade on up/down tick (opacity transition).
- **Sparkline**: last-N interval volumes; bars tint to alert color on spike.
- **Toast**: throttled, dismissible, click → focus & scroll row into view.
- **Alerts panel**: append-only ring (last 200), filter by tier, mute per symbol.
- **Accessibility/UX**: optional sound on critical (debounced), reduced-motion
  honors `prefers-reduced-motion` (disables flashes/glows).

---

## 9. Project Structure

```
tickpulse/
├─ index.html
├─ vite.config.ts                 # COOP/COEP headers for SharedArrayBuffer
├─ package.json
├─ tsconfig.json                  # extend current: "module":"ESNext","lib":["ES2022","DOM"]
└─ src/
   ├─ main.tsx
   ├─ app/
   │  ├─ App.tsx
   │  └─ components/
   │     ├─ SymbolTable.tsx        # TanStack Virtual host
   │     ├─ SymbolRow.tsx          # structure only; values patched by pump
   │     ├─ Sparkline.tsx          # canvas element + ctx ref
   │     ├─ AlertsPanel.tsx
   │     ├─ Toasts.tsx
   │     └─ Controls.tsx           # filter / sort / chaos-RPS / mute
   ├─ data/
   │  ├─ ticker.ts                 # TickerClient interface + Tick type
   │  ├─ mockTicker.worker.ts      # realistic generator (worker)
   │  ├─ kiteTicker.ts             # real binary adapter (parses frames)
   │  ├─ store.ts                  # SoA typed arrays over SharedArrayBuffer
   │  ├─ stats.ts                  # EWMA mean/var, RVOL, z-score
   │  └─ alerts.ts                 # tiers, cooldown, ring buffer
   ├─ render/
   │  ├─ renderPump.ts             # rAF loop (main thread)
   │  └─ sparklineRenderer.ts      # (Offscreen)Canvas drawing
   └─ ui/theme.css
```

> **Note:** SharedArrayBuffer requires cross-origin isolation. Add
> `Cross-Origin-Opener-Policy: same-origin` and
> `Cross-Origin-Embedder-Policy: require-corp` via `vite.config.ts` dev server
> headers. If isolation isn't available, fall back to `postMessage` with
> transferable `ArrayBuffer`s (slightly higher latency, still fine at 500/s).

---

## 10. Performance Budget & Verification

| Metric | Target |
|---|---|
| Frame rate (steady + during bursts) | **60 fps** (8.3 ms if 120 Hz) |
| Long tasks (>50 ms) on main thread | **0** |
| Per-frame main-thread work | < 3 ms for ~40 visible rows |
| Per-tick data-plane work | O(1), < ~5 µs |
| DOM node count | ~constant (≈ visible rows × cells) |
| GC pauses on hot path | none (typed arrays, object pooling) |

**How we verify**
- Built-in **FPS/long-task HUD** using `PerformanceObserver({ type:'longtask' })`
  and rAF deltas.
- **Chaos slider**: drive global tick rate from 500 → 5,000+ tps and confirm the
  frame rate holds.
- Chrome DevTools **Performance** trace: assert no dropped frames, no forced
  reflow, paint confined to flash/sparkline layers.
- **Correctness check**: sum of per-tick `Δvol` over a window equals
  `cumVolₑₙ𝒹 − cumVolₛₜₐᵣₜ` (proves no ticks dropped in the data plane).

---

## 11. React 19 Alternative (if Solid isn't desired)

Achievable, with discipline:
- Keep tick data **out** of React state. Rows subscribe via
  `useSyncExternalStore` to a manual store, but the store **only notifies on
  structure changes**, never per tick.
- Per-tick value updates still go through the **rAF pump writing to DOM refs**
  (`ref.current.textContent = …`), bypassing reconciliation.
- Use `React.memo` + stable keys; virtualize with `@tanstack/react-virtual`.

Net: same architecture, the framework is just heavier. **Solid is recommended**
because fine-grained signals make the "structure vs. values" split natural and
the runtime is lighter.

---

## 12. Real KiteTicker Swap (post-POC)

1. Implement `KiteTickerAdapter` (`src/data/kiteTicker.ts`):
   - open `wss://ws.kite.trade?api_key&access_token` with `binaryType='arraybuffer'`,
   - parse frames → `Tick[]` (apply price divisor, keep `cumVolume` as-is),
   - send `{a:'subscribe', v:[tokens]}` / `{a:'mode', v:[mode,[tokens]]}` JSON.
2. Swap the construction site: `new MockTicker()` → `new KiteTickerAdapter(...)`.
3. **No UI changes** — both implement `TickerClient`; the volume-delta math is
   identical because the mock already emits cumulative volume.

*(Token mapping/instrument metadata comes from Kite's instruments dump; for the
POC we use synthetic tokens + names.)*

---

## 13. Milestones

| # | Deliverable | Exit criteria |
|---|---|---|
| **M0** | Vite + Solid + TS scaffold; ESM/worker config; SAB headers | Dev server with HMR; empty grid renders |
| **M1** | `mockTicker.worker.ts` — 100 symbols, realistic price/volume, Poisson arrivals | Worker streams batched `Tick[]`; logged sanity stats |
| **M2** | SoA store + rAF render pump + virtualized table + price flash | 300 symbols, 60 fps, price flashes on tick |
| **M3** | Volume deltas + canvas sparklines + RVOL column | Per-interval volume correct vs cumulative |
| **M4** | EWMA z-score + alert engine + glow/badges/toasts/panel | Engineered bursts reliably fire tiered alerts |
| **M5** | Perf hardening: SharedArrayBuffer, OffscreenCanvas, HUD | 5,000 tps chaos test holds 60 fps, 0 long tasks |
| **M6** | `KiteTickerAdapter` + one-line source swap | Live ticks render with no UI changes |

---

## 14. Key Decisions & Risks

- **Decision — decouple ingest/render via rAF + SoA + workers.** Foundational to
  "zero jank"; everything else follows.
- **Decision — canvas for sparklines, DOM only for text cells.** Avoids
  paint/layout storms from hundreds of animated SVG/DOM nodes.
- **Decision — framework out of the hot path.** Per-tick writes go straight to
  DOM/canvas; framework owns structure only.
- **Risk — SharedArrayBuffer needs cross-origin isolation.** Mitigation: dev
  headers in Vite; `postMessage(transferable)` fallback.
- **Risk — alert fatigue.** Mitigation: tiers + per-symbol cooldown + mute.
- **Risk — real feed quirks** (divisors per segment, heartbeats, reconnect/
  backoff, token limits). Mitigation: isolate all of it inside the adapter.

