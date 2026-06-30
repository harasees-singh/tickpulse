// Pure, DOM-free tick generator. Runs inside the Web Worker. Produces objects
// shaped EXACTLY like real KiteTicker "full" ticks (see DESIGN.md §5).

import { UNIVERSE, type SymSpec } from '../data/universe'
import type { KiteTick, KiteDepthItem } from '../data/kite'

interface SymState extends SymSpec {
  price: number
  lastPriceAt: number
  cumVolume: number
  avg: number
  open: number
  high: number
  low: number
  prevClose: number
  target: number // intraday mean-reversion level → gives each symbol a day trend
  nextAt: number // when the next tick is due (ms)
  burstUntil: number // wall-clock ms; > now => bursting
  tbq: number // total buy qty (slow random walk)
  tsq: number // total sell qty
}

// Box–Muller standard normal.
function gaussian(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const round2 = (x: number) => Math.round(x * 100) / 100

// Deterministic pseudo-random in [0,1) from an integer, so each symbol keeps a
// stable day trend across reloads.
function hash01(n: number): number {
  let x = ((n + 1) * 2654435761) >>> 0
  x = (x ^ (x >>> 13)) >>> 0
  return (x % 100000) / 100000
}

function makeDepth(price: number, tick: number, median: number, lean: number): { buy: KiteDepthItem[]; sell: KiteDepthItem[] } {
  const buy: KiteDepthItem[] = []
  const sell: KiteDepthItem[] = []
  for (let l = 1; l <= 5; l++) {
    // Independent bid/ask sizes that lean with order-book pressure, so the Depth
    // bar reflects real imbalance and actually moves (not pinned at 50/50).
    const bq = Math.max(1, Math.round(median * (0.5 + Math.random()) * (1 + 0.6 * lean)))
    const sq = Math.max(1, Math.round(median * (0.5 + Math.random()) * (1 - 0.6 * lean)))
    buy.push({ price: round2(price - l * tick), quantity: bq, orders: 1 + (bq % 7) })
    sell.push({ price: round2(price + l * tick), quantity: sq, orders: 1 + (sq % 5) })
  }
  return { buy, sell }
}

export class MockEngine {
  syms: SymState[]
  rpsScale = 1
  burstProb = 0.0006 // per symbol per second chance to spontaneously spike
  private lastRoll: number

  constructor(now = Date.now()) {
    this.lastRoll = now
    this.syms = UNIVERSE.map((s, idx) => {
      // Per-symbol day trend: some up, some down, varied magnitude — so the board
      // shows a realistic green/red mix instead of clustering at 0%.
      const dayBias = (hash01(idx) - 0.45) * 0.06 // ≈ -2.7% … +3.3%
      return {
        ...s,
        price: s.base,
        target: s.base * (1 + dayBias),
        lastPriceAt: now,
        cumVolume: s.openingVolume,
        avg: s.base,
        open: s.base,
        high: s.base,
        low: s.base,
        prevClose: s.base,
        nextAt: now + Math.random() * 200,
        burstUntil: 0,
        tbq: s.qtyMedian * 50,
        tsq: s.qtyMedian * 50
      }
    })
  }

  setRpsScale(x: number) {
    this.rpsScale = clamp(x, 0.1, 25)
  }

  setBurstProb(x: number) {
    this.burstProb = clamp(x, 0, 0.05)
  }

  /** Force a visible spike on one symbol (used by the "Trigger spike" button). */
  triggerBurst(idx?: number) {
    const i = idx ?? Math.floor(Math.random() * this.syms.length)
    this.syms[i].burstUntil = Date.now() + 4000
  }

  /** Generate every tick that should have fired up to `now`, across all symbols. */
  generateUpTo(now: number): KiteTick[] {
    const out: KiteTick[] = []
    const dtRoll = clamp((now - this.lastRoll) / 1000, 0, 0.25)
    this.lastRoll = now

    for (let k = 0; k < this.syms.length; k++) {
      const s = this.syms[k]
      let bursting = now < s.burstUntil

      // Spontaneous bursts (news spikes) to exercise the alert engine.
      if (!bursting && Math.random() < this.burstProb * dtRoll) {
        s.burstUntil = now + (2000 + Math.random() * 3000)
        bursting = true
      }

      const eff = Math.max(0.1, (bursting ? s.baseRps * 3 : s.baseRps) * this.rpsScale)
      let emitted = 0

      while (s.nextAt <= now && emitted < 8) {
        emitted++

        // --- price: mean-reverting random walk, snapped + circuit-clamped ---
        const dt = clamp((now - s.lastPriceAt) / 1000, 0.001, 1)
        s.lastPriceAt = now
        const drift = s.theta * (s.target - s.price) * dt
        const shock = s.price * s.sigma * Math.sqrt(dt) * gaussian() * (bursting ? 1.5 : 1)
        let p = s.price + drift + shock
        p = Math.round(p / s.tickSize) * s.tickSize
        p = clamp(p, s.base * (1 - s.band), s.base * (1 + s.band))
        s.price = p

        // --- volume: monotonic cumulative, heavy-tailed trade size ---
        const median = s.qtyMedian * (bursting ? 4 : 1)
        const qty = Math.max(
          1,
          Math.round(median * Math.exp(s.qtySigma * gaussian() - (s.qtySigma * s.qtySigma) / 2))
        )
        s.cumVolume += qty
        s.avg = (s.avg * (s.cumVolume - qty) + p * qty) / s.cumVolume

        if (p > s.high) s.high = p
        if (p < s.low) s.low = p
        // Order-book queue sizes lean with price vs base, so aggregate buy/sell
        // pressure is meaningful (not a symmetric random walk).
        const lean = clamp((s.price - s.base) / (s.base * s.band), -1, 1)
        const baseQ = s.qtyMedian * 50
        s.tbq = Math.max(1, Math.round(baseQ * (1 + 0.6 * lean) + gaussian() * median * 3))
        s.tsq = Math.max(1, Math.round(baseQ * (1 - 0.6 * lean) + gaussian() * median * 3))

        const ts = new Date(now)
        out.push({
          tradable: true,
          mode: 'full',
          instrument_token: s.token,
          last_price: round2(p),
          last_traded_quantity: qty,
          average_traded_price: round2(s.avg),
          volume_traded: s.cumVolume,
          total_buy_quantity: s.tbq,
          total_sell_quantity: s.tsq,
          ohlc: { open: round2(s.open), high: round2(s.high), low: round2(s.low), close: round2(s.prevClose) },
          change: round2(((p - s.prevClose) / s.prevClose) * 100),
          last_trade_time: ts,
          exchange_timestamp: ts,
          oi: 0,
          oi_day_high: 0,
          oi_day_low: 0,
          depth: makeDepth(p, s.tickSize, median, lean)
        })

        // schedule next arrival (exponential inter-arrival ~ Poisson process)
        s.nextAt += (-Math.log(1 - Math.random()) / eff) * 1000
      }

      // Re-sync if we fell behind (e.g. tab was backgrounded) to avoid backlog.
      if (s.nextAt < now) s.nextAt = now + (-Math.log(1 - Math.random()) / eff) * 1000
    }

    return out
  }
}

