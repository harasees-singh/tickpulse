// Data plane (DESIGN.md §6). Structure-of-Arrays over typed arrays: zero
// per-tick allocation, cache-friendly, GC-free hot path. Every tick is
// processed here (lossless); the render plane only reads the latest snapshot.

import { UNIVERSE } from './data/universe'
import type { KiteTick } from './data/kite'

export const N = UNIVERSE.length
export const HIST = 48 // sparkline samples per symbol

export interface SymMeta {
  idx: number
  token: number
  name: string
  exch: string
}

export const symbols: SymMeta[] = UNIVERSE.map((s, i) => ({
  idx: i,
  token: s.token,
  name: s.name,
  exch: s.exch
}))

export const tokenToIdx = new Map<number, number>()
UNIVERSE.forEach((s, i) => tokenToIdx.set(s.token, i))

// --- hot fields (index = stable per-symbol slot) ---
export const ltp = new Float64Array(N)
export const dir = new Int8Array(N) // last move: +1 up, -1 down
export const chgPct = new Float64Array(N)
export const ltq = new Float64Array(N)
export const buyQty = new Float64Array(N) // total pending buy qty (order book)
export const sellQty = new Float64Array(N) // total pending sell qty (order book)
export const cumVol = new Float64Array(N)
export const volEwma = new Float64Array(N)
export const volVar = new Float64Array(N)
export const rvol = new Float64Array(N)
export const zScore = new Float64Array(N)
export const buyFlow = new Float64Array(N) // EWMA buyer-initiated volume (tick rule)
export const sellFlow = new Float64Array(N) // EWMA seller-initiated volume
const baseInit = new Uint8Array(N)
const lastAlertAt = new Float64Array(N)
export const alertUntil = new Float64Array(N)
export const alertTier = new Uint8Array(N) // 0 none, 1 info, 2 warn, 3 critical
export const histVol = new Float32Array(N * HIST)
export const histPrice = new Float32Array(N * HIST)
export const histHead = new Int32Array(N)
export const prevClose = new Float64Array(N) // previous-day close (for price line + Chg%)
export const vwap = new Float64Array(N) // day VWAP (Kite average_traded_price)

// seed so the table shows sensible values before the first tick arrives
for (let i = 0; i < N; i++) {
  ltp[i] = UNIVERSE[i].base
  prevClose[i] = UNIVERSE[i].base
  vwap[i] = UNIVERSE[i].base
}

const ALPHA = 0.05 // EWMA smoothing for volume mean/variance
const FLOW_ALPHA = 0.08 // EWMA smoothing for buy/sell order-flow classification

// --- user-configurable "breakout" thresholds (Settings tab) ---
export interface BreakoutConfig {
  info: number // z-score for a "Watch" (mild) flag
  warn: number // z-score for "High"
  crit: number // z-score for "Spike" (a breakout)
  cooldownMs: number // min gap between alerts per symbol
}
const BREAKOUT_DEFAULTS: BreakoutConfig = { info: 2.5, warn: 3.5, crit: 5, cooldownMs: 4000 }
const BREAKOUT_KEY = 'tickpulse.breakout'
function loadBreakout(): BreakoutConfig {
  try {
    const raw = localStorage.getItem(BREAKOUT_KEY)
    if (raw) return { ...BREAKOUT_DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...BREAKOUT_DEFAULTS }
}
let breakout: BreakoutConfig = loadBreakout()
export function getBreakoutConfig(): BreakoutConfig {
  return { ...breakout }
}
export function setBreakoutConfig(patch: Partial<BreakoutConfig>): void {
  breakout = { ...breakout, ...patch }
  try {
    localStorage.setItem(BREAKOUT_KEY, JSON.stringify(breakout))
  } catch {
    /* ignore */
  }
}

export interface Alert {
  id: number
  idx: number
  name: string
  tier: number
  z: number
  rvol: number
  ts: number
}

let alertSeq = 1
const pending: Alert[] = []
const NO_ALERTS: Alert[] = []
let ingestCount = 0

export function getAndResetIngestCount(): number {
  const c = ingestCount
  ingestCount = 0
  return c
}

function pushHist(i: number, vol: number, price: number) {
  const h = histHead[i]
  histVol[i * HIST + h] = vol
  histPrice[i * HIST + h] = price
  histHead[i] = (h + 1) % HIST
}

/** Ingest a batch of Kite-shaped ticks. O(1) per tick, processes ALL of them. */
export function ingest(ticks: KiteTick[]): void {
  const now = performance.now()
  for (let t = 0; t < ticks.length; t++) {
    const tk = ticks[t]
    const i = tokenToIdx.get(tk.instrument_token)
    if (i === undefined) continue
    ingestCount++

    const price = tk.last_price
    dir[i] = price > ltp[i] ? 1 : price < ltp[i] ? -1 : dir[i]
    ltp[i] = price
    if (tk.change !== undefined) chgPct[i] = tk.change
    if (tk.last_traded_quantity !== undefined) ltq[i] = tk.last_traded_quantity
    if (tk.total_buy_quantity !== undefined) buyQty[i] = tk.total_buy_quantity
    if (tk.total_sell_quantity !== undefined) sellQty[i] = tk.total_sell_quantity
    if (tk.ohlc && tk.ohlc.close > 0) prevClose[i] = tk.ohlc.close
    if (tk.average_traded_price !== undefined && tk.average_traded_price > 0) vwap[i] = tk.average_traded_price

    const newVol = tk.volume_traded ?? cumVol[i]

    // First tick for this symbol: establish the cumulative-volume baseline.
    if (!baseInit[i]) {
      baseInit[i] = 1
      cumVol[i] = newVol
      const seed = tk.last_traded_quantity ?? 0
      volEwma[i] = seed
      volVar[i] = seed * seed * 0.01
      pushHist(i, seed, price)
      continue
    }

    // Per-interval volume = delta of cumulative (the heart of volume tracking).
    const delta = Math.max(0, newVol - cumVol[i])
    cumVol[i] = newVol

    // Streaming EWMA mean/variance -> z-score + RVOL (O(1), no windows).
    const mean = volEwma[i]
    const diff = delta - mean
    volEwma[i] = mean + ALPHA * diff
    volVar[i] = (1 - ALPHA) * (volVar[i] + ALPHA * diff * diff)
    const sd = Math.sqrt(volVar[i]) || 1
    const z = diff / sd
    zScore[i] = z
    rvol[i] = delta / (volEwma[i] || 1)
    pushHist(i, delta, price)

    // Order flow (tick rule): attribute this interval's volume to buyers or
    // sellers by price direction, EWMA-smoothed → "is the surge buying/selling".
    const buyDelta = dir[i] > 0 ? delta : 0
    const sellDelta = dir[i] < 0 ? delta : 0
    buyFlow[i] += FLOW_ALPHA * (buyDelta - buyFlow[i])
    sellFlow[i] += FLOW_ALPHA * (sellDelta - sellFlow[i])

    // Tiered alert using the user's breakout thresholds, with per-symbol cooldown.
    const tier = z >= breakout.crit ? 3 : z >= breakout.warn ? 2 : z >= breakout.info ? 1 : 0
    if (tier > 0 && now - lastAlertAt[i] > breakout.cooldownMs) {
      lastAlertAt[i] = now
      alertUntil[i] = now + 1600 // row glow duration
      alertTier[i] = tier
      pending.push({ id: alertSeq++, idx: i, name: symbols[i].name, tier, z, rvol: rvol[i], ts: Date.now() })
    }
  }
}

/** Pull alerts raised since the last call (drained once per frame by the pump). */
export function drainAlerts(): Alert[] {
  if (pending.length === 0) return NO_ALERTS
  const a = pending.slice()
  pending.length = 0
  return a
}

export type SortKey = 'activity' | 'rvol' | 'volume' | 'change' | 'symbol'

/** Compute display order (filtered + sorted). Called on a timer, not per frame. */
export function computeOrder(sort: SortKey, filter: string): number[] {
  const f = filter.trim().toUpperCase()
  const idxs: number[] = []
  for (let i = 0; i < N; i++) {
    if (!f || symbols[i].name.includes(f)) idxs.push(i)
  }
  let cmp: (a: number, b: number) => number
  switch (sort) {
    case 'rvol':
      cmp = (a, b) => rvol[b] - rvol[a]
      break
    case 'volume':
      cmp = (a, b) => cumVol[b] - cumVol[a]
      break
    case 'change':
      cmp = (a, b) => chgPct[b] - chgPct[a]
      break
    case 'symbol':
      cmp = (a, b) => symbols[a].name.localeCompare(symbols[b].name)
      break
    case 'activity':
    default:
      cmp = (a, b) => zScore[b] - zScore[a] || cumVol[b] - cumVol[a]
      break
  }
  idxs.sort(cmp)
  return idxs
}

