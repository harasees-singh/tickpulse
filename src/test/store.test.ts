import { describe, it, expect } from 'vitest'
import {
  ingest, symbols, ltp, chgPct, cumVol, rvol, buyFlow, sellFlow, prevClose, vwap,
  open, high, low, oi, lastTickAt, cumDelta, depth, turnoverOf
} from '../core/store'
import type { KiteTick } from '../data/kite'

function fullTick(token: number, over: Partial<KiteTick> = {}): KiteTick {
  return {
    tradable: true,
    mode: 'full',
    instrument_token: token,
    last_price: 2950,
    last_traded_quantity: 100,
    average_traded_price: 2945,
    volume_traded: 1_000_000,
    total_buy_quantity: 250_000,
    total_sell_quantity: 180_000,
    ohlc: { open: 2900, high: 2960, low: 2890, close: 2900 },
    change: 1.5,
    last_trade_time: new Date(),
    exchange_timestamp: new Date(),
    oi: 0,
    oi_day_high: 0,
    oi_day_low: 0,
    depth: { buy: [], sell: [] },
    ...over
  }
}

describe('store.ingest — KiteTick → SoA contract', () => {
  it('maps the documented tick fields into the store and derives Δvolume + order flow', () => {
    const idx = 0
    const token = symbols[idx].token

    // 1st tick establishes the cumulative-volume baseline (no Δ yet).
    ingest([fullTick(token, { last_price: 2950, volume_traded: 1_000_000, change: 1.5 })])
    // 2nd tick: uptick (buyer-initiated) + Δvolume of 500.
    ingest([fullTick(token, { last_price: 2955, volume_traded: 1_000_500, change: 1.9, oi: 12345 })])

    expect(ltp[idx]).toBe(2955) // last_price
    expect(chgPct[idx]).toBe(1.9) // change
    expect(cumVol[idx]).toBe(1_000_500) // volume_traded (cumulative)
    expect(prevClose[idx]).toBe(2900) // ohlc.close
    expect(vwap[idx]).toBe(2945) // average_traded_price
    expect(rvol[idx]).toBeGreaterThan(0) // derived from Δvolume
    expect(buyFlow[idx]).toBeGreaterThan(sellFlow[idx]) // uptick ⇒ buyer-initiated flow

    // --- Core A·E store fields ---
    expect(open[idx]).toBe(2900) // ohlc.open
    expect(high[idx]).toBe(2960) // max(price, ohlc.high)
    expect(low[idx]).toBe(2890) // min(price, ohlc.low)
    expect(oi[idx]).toBe(12345) // mapped from tk.oi (0-default proven on tick 1)
    expect(lastTickAt[idx]).toBeGreaterThan(0) // freshness stamp (performance.now)
    expect(cumDelta[idx]).toBe(500) // uptick Δ500 ⇒ +500 signed CVD
    expect(turnoverOf(idx)).toBeCloseTo(vwap[idx] * cumVol[idx]) // 2945 × 1_000_500
    expect(depth[idx]).toBeDefined()
    expect(Array.isArray(depth[idx]!.buy)).toBe(true) // latest depth object
  })
})


