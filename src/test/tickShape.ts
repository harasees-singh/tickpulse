import { expect } from 'vitest'
import type { KiteTick } from '../data/kite'

/**
 * Asserts an object satisfies the KiteTick wire contract the rest of the app
 * depends on. Used by both the binary-parser tests and the mock-engine tests so
 * a future change that drops/renames a field fails loudly.
 */
export function expectValidKiteTick(t: KiteTick): void {
  expect(typeof t.instrument_token).toBe('number')
  expect(typeof t.last_price).toBe('number')
  expect(['ltp', 'quote', 'full']).toContain(t.mode)

  if (t.mode !== 'ltp') {
    expect(typeof t.volume_traded).toBe('number')
    expect(typeof t.last_traded_quantity).toBe('number')
    expect(typeof t.average_traded_price).toBe('number')
    expect(typeof t.total_buy_quantity).toBe('number')
    expect(typeof t.total_sell_quantity).toBe('number')
    expect(typeof t.change).toBe('number')
    expect(t.ohlc).toBeTruthy()
    for (const k of ['open', 'high', 'low', 'close'] as const) {
      expect(typeof t.ohlc![k]).toBe('number')
    }
  }

  if (t.mode === 'full') {
    expect(t.exchange_timestamp instanceof Date).toBe(true)
    expect(t.depth).toBeTruthy()
    expect(t.depth!.buy).toHaveLength(5)
    expect(t.depth!.sell).toHaveLength(5)
    for (const lvl of [...t.depth!.buy, ...t.depth!.sell]) {
      expect(typeof lvl.price).toBe('number')
      expect(typeof lvl.quantity).toBe('number')
      expect(typeof lvl.orders).toBe('number')
    }
  }
}

