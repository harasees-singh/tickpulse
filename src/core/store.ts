// Data plane (DESIGN.md §6). Structure-of-Arrays over typed arrays: zero
// per-tick allocation, cache-friendly, GC-free hot path. Every tick is
// processed here (lossless); the render plane only reads the latest snapshot.

import { UNIVERSE } from '../data/universe'
import type { KiteTick } from '../data/kite'
import { getSettings, updateSettings, subscribeSettings, type BreakoutConfig } from './settings'

// Re-export so existing `import { BreakoutConfig } from '.../core/store'` works.
export type { BreakoutConfig }

// Slot allocator (DEV_PLAN §1.D). Arrays are sized to a fixed MAX_N capacity;
// per-token slots are handed out on demand by ensureSlot(), so the tracked
// symbol set is dynamic (local universe by default, live watchlists later).
export const MAX_N = 1024
export let N = 0 // active slot count (live binding; grows as slots allocate)
export const HIST = 48 // sparkline samples per symbol

export interface SymMeta {
  idx: number
  token: number
  name: string
  exch: string
}

// Grow as slots are allocated; symbols[idx] is the metadata for slot idx.
export const symbols: SymMeta[] = []
export const tokenToIdx = new Map<number, number>()
export const nameToIdx = new Map<string, number>() // tradingsymbol → slot (for /analytics/:symbol)

// --- hot fields (index = stable per-symbol slot, capacity MAX_N) ---
export const ltp = new Float64Array(MAX_N)
export const dir = new Int8Array(MAX_N) // last move: +1 up, -1 down
export const chgPct = new Float64Array(MAX_N)
export const ltq = new Float64Array(MAX_N)
export const buyQty = new Float64Array(MAX_N) // total pending buy qty (order book)
export const sellQty = new Float64Array(MAX_N) // total pending sell qty (order book)
export const cumVol = new Float64Array(MAX_N)
export const volEwma = new Float64Array(MAX_N)
export const volVar = new Float64Array(MAX_N)
export const rvol = new Float64Array(MAX_N)
export const zScore = new Float64Array(MAX_N)
export const buyFlow = new Float64Array(MAX_N) // EWMA buyer-initiated volume (tick rule)
export const sellFlow = new Float64Array(MAX_N) // EWMA seller-initiated volume
const baseInit = new Uint8Array(MAX_N)
const lastAlertAt = new Float64Array(MAX_N)
export const alertUntil = new Float64Array(MAX_N)
export const alertTier = new Uint8Array(MAX_N) // 0 none, 1 info, 2 warn, 3 critical
export const histVol = new Float32Array(MAX_N * HIST)
export const histPrice = new Float32Array(MAX_N * HIST)
export const histHead = new Int32Array(MAX_N)
export const prevClose = new Float64Array(MAX_N) // previous-day close (for price line + Chg%)
export const vwap = new Float64Array(MAX_N) // day VWAP (Kite average_traded_price)
export const open = new Float64Array(MAX_N) // day open (ohlc.open)
export const high = new Float64Array(MAX_N) // running intraday high
export const low = new Float64Array(MAX_N) // running intraday low
export const oi = new Float64Array(MAX_N) // open interest (F&O; 0 for equity/mock)
export const lastTickAt = new Float64Array(MAX_N) // performance.now() of last tick (freshness)
export const cumDelta = new Float64Array(MAX_N) // cumulative volume delta / CVD (signed)

export type DepthSnapshot = NonNullable<KiteTick['depth']>
// Latest 5-level depth per slot — a reference to the decoder/mock-allocated
// object, so the store hot path itself never allocates.
export const depth: (DepthSnapshot | undefined)[] = new Array(MAX_N)

/** Day turnover (₹) ≈ VWAP × cumulative volume. Derived O(1) on read (no per-tick array). */
export function turnoverOf(i: number): number {
  return vwap[i] * cumVol[i]
}

export interface SlotSpec {
  token: number
  name: string
  exch: string
  base?: number // opening/reference price to seed ltp/prevClose/vwap
}

/**
 * Return the stable slot index for a token, allocating (and seeding) a new one
 * on first sight. Cold path only — never called per tick. Returns -1 if the
 * MAX_N capacity is exhausted.
 */
export function ensureSlot(s: SlotSpec): number {
  const existing = tokenToIdx.get(s.token)
  if (existing !== undefined) return existing
  if (N >= MAX_N) {
    console.warn(`[store] slot capacity ${MAX_N} reached; dropping ${s.name}`)
    return -1
  }
  const i = N
  symbols.push({ idx: i, token: s.token, name: s.name, exch: s.exch })
  tokenToIdx.set(s.token, i)
  nameToIdx.set(s.name, i)
  const base = s.base ?? 0
  ltp[i] = base
  prevClose[i] = base
  vwap[i] = base
  open[i] = base
  high[i] = base
  low[i] = base
  N++
  return i
}

/** Resolve a tradingsymbol to its slot index, if tracked. */
export function resolveByName(name: string): number | undefined {
  return nameToIdx.get(name)
}

/** Seed the local demo universe (default + mock-mode source). Idempotent. */
export function registerUniverse(): void {
  for (const s of UNIVERSE) ensureSlot(s)
}

/** Register a batch of instruments (e.g. a live watchlist). Returns their idxs. */
export function registerInstruments(list: SlotSpec[]): number[] {
  const idxs: number[] = []
  for (const s of list) {
    const idx = ensureSlot(s)
    if (idx >= 0) idxs.push(idx)
  }
  return idxs
}

export interface ApplyResult {
  tokens: number[]
  idxs: number[]
  source: 'universe' | 'watchlist'
}

/**
 * Resolve which instruments to track from settings: a non-empty, enabled active
 * watchlist (live mode) wins; otherwise fall back to the local universe (always
 * the case in mock mode, which can only stream universe tokens).
 */
export function applyWatchlist(opts: { live: boolean; instruments?: SlotSpec[] }): ApplyResult {
  const s = getSettings()
  const wl = s.watchlists.find((w) => w.id === s.activeWatchlist)
  const wlTokens = wl && wl.enabled ? wl.tokens : []
  if (opts.live && wlTokens.length > 0) {
    const specs: SlotSpec[] =
      opts.instruments ?? wlTokens.map((token) => ({ token, name: String(token), exch: 'NSE' }))
    return { tokens: wlTokens, idxs: registerInstruments(specs), source: 'watchlist' }
  }
  registerUniverse()
  return { tokens: symbols.map((m) => m.token), idxs: symbols.map((m) => m.idx), source: 'universe' }
}

// Seed the local universe at import so the store is populated before first
// render and the existing tests / mock keep working.
registerUniverse()

const ALPHA = 0.05 // EWMA smoothing for volume mean/variance
const FLOW_ALPHA = 0.08 // EWMA smoothing for buy/sell order-flow classification

// --- user-configurable "breakout" thresholds (Settings tab) ---
// Persistence + migration live in settings.ts (single source of truth). The hot
// path (ingest) reads this plain local mirror; subscribeSettings refreshes it
// only when the user changes thresholds — never a per-tick lookup.
let breakout: BreakoutConfig = getSettings().breakout
subscribeSettings((s) => {
  breakout = s.breakout
})
export function getBreakoutConfig(): BreakoutConfig {
  return { ...breakout }
}
export function setBreakoutConfig(patch: Partial<BreakoutConfig>): void {
  updateSettings({ breakout: { ...breakout, ...patch } })
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
    lastTickAt[i] = now

    const price = tk.last_price
    dir[i] = price > ltp[i] ? 1 : price < ltp[i] ? -1 : dir[i]
    ltp[i] = price
    if (tk.change !== undefined) chgPct[i] = tk.change
    if (tk.last_traded_quantity !== undefined) ltq[i] = tk.last_traded_quantity
    if (tk.total_buy_quantity !== undefined) buyQty[i] = tk.total_buy_quantity
    if (tk.total_sell_quantity !== undefined) sellQty[i] = tk.total_sell_quantity
    if (tk.ohlc) {
      if (tk.ohlc.close > 0) prevClose[i] = tk.ohlc.close
      open[i] = tk.ohlc.open
    }
    if (tk.average_traded_price !== undefined && tk.average_traded_price > 0) vwap[i] = tk.average_traded_price
    if (tk.oi !== undefined) oi[i] = tk.oi
    if (tk.depth) depth[i] = tk.depth

    const newVol = tk.volume_traded ?? cumVol[i]

    // First tick for this symbol: establish the cumulative-volume baseline.
    if (!baseInit[i]) {
      baseInit[i] = 1
      cumVol[i] = newVol
      // Authoritative high/low init (overrides the cosmetic base seed; correct
      // even when base was 0, e.g. a live watchlist token with no seed price).
      high[i] = tk.ohlc ? Math.max(price, tk.ohlc.high) : price
      low[i] = tk.ohlc ? Math.min(price, tk.ohlc.low) : price
      const seed = tk.last_traded_quantity ?? 0
      volEwma[i] = seed
      volVar[i] = seed * seed * 0.01
      pushHist(i, seed, price)
      continue
    }

    // Per-interval volume = delta of cumulative (the heart of volume tracking).
    const delta = Math.max(0, newVol - cumVol[i])
    cumVol[i] = newVol

    // Running intraday range: price extremes + Kite's authoritative session H/L.
    if (price > high[i]) high[i] = price
    else if (price < low[i]) low[i] = price
    if (tk.ohlc) {
      if (tk.ohlc.high > high[i]) high[i] = tk.ohlc.high
      if (tk.ohlc.low < low[i]) low[i] = tk.ohlc.low
    }

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
    cumDelta[i] += buyDelta - sellDelta // signed cumulative volume delta (CVD)

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

export type SortKey =
  | 'activity'
  | 'rvol'
  | 'turnover'
  | 'imbalance'
  | 'fromHigh'
  | 'vwapDist'
  | 'change'
  | 'recency'
  | 'volume'
  | 'symbol'
  | 'price'
  | 'fresh'

export type SortDir = 'asc' | 'desc'

/** A column's natural (first-click) direction: names A→Z, metrics high→low. */
export function naturalDir(sort: SortKey): SortDir {
  return sort === 'symbol' ? 'asc' : 'desc'
}

/** Scanner filter chips + search (DEV_PLAN §2.1). 0 / '' / false = inactive. */
export interface ScanFilters {
  text: string // symbol-name substring
  minRvol: number // minimum relative volume (×)
  minTurnover: number // minimum day turnover (₹)
  priceMin: number // price band low (₹)
  priceMax: number // price band high (₹)
  aboveVwap: boolean // only symbols trading above their VWAP
  buyFlowOnly: boolean // only net buyer-initiated flow
}

export const DEFAULT_SCAN_FILTERS: ScanFilters = {
  text: '',
  minRvol: 0,
  minTurnover: 0,
  priceMin: 0,
  priceMax: 0,
  aboveVwap: false,
  buyFlowOnly: false
}

// --- derived sort metrics (O(1), allocation-free) ---
function imbalance(i: number): number {
  const t = buyQty[i] + sellQty[i]
  return t > 0 ? (buyQty[i] - sellQty[i]) / t : 0
}
function fromHigh(i: number): number {
  return high[i] > 0 ? (ltp[i] - high[i]) / high[i] : 0 // ≤ 0; nearer 0 = closer to day high
}
function vwapDist(i: number): number {
  return vwap[i] > 0 ? (ltp[i] - vwap[i]) / vwap[i] : 0
}

/** Compute display order (filtered + sorted). Called on a timer, not per frame. */
export function computeOrder(sort: SortKey, filters: ScanFilters, dir: SortDir = naturalDir(sort)): number[] {
  const f = filters.text.trim().toUpperCase()
  const idxs: number[] = []
  for (let i = 0; i < N; i++) {
    if (f && !symbols[i].name.includes(f)) continue
    if (filters.minRvol > 0 && rvol[i] < filters.minRvol) continue
    if (filters.minTurnover > 0 && turnoverOf(i) < filters.minTurnover) continue
    if (filters.priceMin > 0 && ltp[i] < filters.priceMin) continue
    if (filters.priceMax > 0 && ltp[i] > filters.priceMax) continue
    if (filters.aboveVwap && ltp[i] <= vwap[i]) continue
    if (filters.buyFlowOnly && buyFlow[i] <= sellFlow[i]) continue
    // F&O-only is deferred — the universe carries no EQ/FUT/OPT segment yet.
    idxs.push(i)
  }
  let cmp: (a: number, b: number) => number
  switch (sort) {
    case 'rvol':
      cmp = (a, b) => rvol[b] - rvol[a]
      break
    case 'turnover':
      cmp = (a, b) => turnoverOf(b) - turnoverOf(a)
      break
    case 'imbalance':
      cmp = (a, b) => imbalance(b) - imbalance(a)
      break
    case 'fromHigh':
      cmp = (a, b) => fromHigh(b) - fromHigh(a)
      break
    case 'vwapDist':
      cmp = (a, b) => vwapDist(b) - vwapDist(a)
      break
    case 'change':
      cmp = (a, b) => chgPct[b] - chgPct[a]
      break
    case 'recency':
      cmp = (a, b) => alertUntil[b] - alertUntil[a]
      break
    case 'volume':
      cmp = (a, b) => cumVol[b] - cumVol[a]
      break
    case 'price':
      cmp = (a, b) => ltp[b] - ltp[a]
      break
    case 'fresh':
      cmp = (a, b) => lastTickAt[b] - lastTickAt[a]
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
  if (dir !== naturalDir(sort)) idxs.reverse()
  return idxs
}

