import { describe, it, expect } from 'vitest'
import { computeOrder, ingest, symbols, DEFAULT_SCAN_FILTERS, type ScanFilters } from '../core/store'
import type { KiteTick } from '../data/kite'

function tick(token: number, o: Partial<KiteTick>): KiteTick {
  return {
    tradable: true, mode: 'full', instrument_token: token,
    last_price: 100, average_traded_price: 100, volume_traded: 1000,
    total_buy_quantity: 100, total_sell_quantity: 100, change: 0,
    ohlc: { open: 100, high: 100, low: 100, close: 100 },
    ...o
  }
}
function withFilters(over: Partial<ScanFilters>): ScanFilters {
  return { ...DEFAULT_SCAN_FILTERS, ...over }
}

// Seed three universe symbols with distinct, directly-controlled fields.
const r = symbols[0].token // RELIANCE  idx 0
const t = symbols[1].token // TCS       idx 1
const h = symbols[2].token // HDFCBANK  idx 2
ingest([tick(r, { last_price: 100, average_traded_price: 90, volume_traded: 1000, total_buy_quantity: 300, total_sell_quantity: 100, change: 5, ohlc: { open: 95, high: 120, low: 80, close: 95 } })])
ingest([tick(t, { last_price: 200, average_traded_price: 210, volume_traded: 1000, total_buy_quantity: 100, total_sell_quantity: 300, change: -2, ohlc: { open: 205, high: 220, low: 195, close: 205 } })])
ingest([tick(h, { last_price: 50, average_traded_price: 50, volume_traded: 10000, total_buy_quantity: 200, total_sell_quantity: 200, change: 1, ohlc: { open: 49, high: 55, low: 48, close: 49 } })])

describe('computeOrder — scanner sort + filters', () => {
  it('sorts by turnover (VWAP × cumVol) descending', () => {
    expect(computeOrder('turnover', DEFAULT_SCAN_FILTERS)[0]).toBe(2) // HDFC 50×10000 = 5L
  })
  it('sorts by change% descending', () => {
    expect(computeOrder('change', DEFAULT_SCAN_FILTERS)[0]).toBe(0) // RELIANCE +5%
  })
  it('sorts by buy/sell imbalance descending', () => {
    expect(computeOrder('imbalance', DEFAULT_SCAN_FILTERS)[0]).toBe(0) // RELIANCE (300-100)/400 = +0.5
  })
  it('sorts by VWAP distance descending', () => {
    expect(computeOrder('vwapDist', DEFAULT_SCAN_FILTERS)[0]).toBe(0) // RELIANCE +11% above VWAP
  })
  it('filters by text (case-insensitive substring)', () => {
    expect(computeOrder('activity', withFilters({ text: symbols[1].name.toLowerCase() }))).toEqual([1])
  })
  it('filters above-VWAP only', () => {
    const o = computeOrder('activity', withFilters({ aboveVwap: true }))
    expect(o).toContain(0) // ltp 100 > vwap 90
    expect(o).not.toContain(1) // ltp 200 < vwap 210
    expect(o).not.toContain(2) // ltp == vwap (not strictly above)
  })
  it('filters by price band (minimum)', () => {
    const o = computeOrder('activity', withFilters({ priceMin: 150 }))
    expect(o).toContain(1) // 200
    expect(o).not.toContain(0) // 100
    expect(o).not.toContain(2) // 50
  })
  it('filters by minimum turnover', () => {
    const o = computeOrder('activity', withFilters({ minTurnover: 100000 }))
    expect(o).toContain(1) // 210000
    expect(o).toContain(2) // 500000
    expect(o).not.toContain(0) // 90000
  })

  it('reverses the order when the sort direction flips', () => {
    const desc = computeOrder('turnover', DEFAULT_SCAN_FILTERS, 'desc')
    const asc = computeOrder('turnover', DEFAULT_SCAN_FILTERS, 'asc')
    expect(asc).toEqual([...desc].reverse())
  })
})

