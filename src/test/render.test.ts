import { describe, it, expect } from 'vitest'
import { surgeClass, surgeArrow, depthTwoSided, depthSpread } from '../core/render'

// Regression lock for the Vol Surge colour. The bug (a NON-ZERO RVOL with
// balanced flow showing a plain/neutral colour) has surfaced twice — first grey,
// then white. The colour must be muted ONLY for a true no-surge (0.00×) and
// green/red (by net flow) for everything else.
describe('surgeClass — Vol Surge colour', () => {
  it('is muted grey ONLY for a no-surge reading (rounds to 0.00×)', () => {
    expect(surgeClass(0, 0.5)).toBe('zero')
    expect(surgeClass(0.004, 0.5)).toBe('zero') // displays "0.00x"
    expect(surgeClass(0.005, 0.5)).not.toBe('zero') // "0.01x" is a real reading
  })

  it('tints a NON-ZERO value with BALANCED flow — never grey/white (the recurring bug)', () => {
    expect(surgeClass(0.37, 0.5)).toBe('up') // bp == 0.5, balanced → tinted, NOT zero/flat
    expect(surgeClass(0.37, 0.5)).not.toBe('zero')
    expect(surgeClass(2, 0.0)).toBe('down') // no buy flow at all → still tinted
  })

  it('tints by net flow lean for non-zero values', () => {
    expect(surgeClass(2, 0.7)).toBe('up') // net buying
    expect(surgeClass(2, 0.3)).toBe('down') // net selling
    expect(surgeClass(2, 0.49)).toBe('down')
    expect(surgeClass(2, 0.5)).toBe('up')
  })

  it('only ever returns zero / up / down — never a "flat" (white) class', () => {
    for (const rv of [0, 0.004, 0.01, 0.5, 1, 5, 50]) {
      for (const bp of [0, 0.25, 0.45, 0.5, 0.55, 0.75, 1]) {
        expect(['zero', 'up', 'down']).toContain(surgeClass(rv, bp))
      }
    }
  })
})

describe('surgeArrow — Vol Surge flow glyph', () => {
  it('shows · for no surge, ▲ strong buy, ▼ strong sell, · balanced', () => {
    expect(surgeArrow(0, 0.9)).toBe('·') // no surge
    expect(surgeArrow(2, 0.7)).toBe('▲') // strong buy
    expect(surgeArrow(2, 0.3)).toBe('▼') // strong sell
    expect(surgeArrow(2, 0.5)).toBe('·') // balanced band
  })
})

// Market-closed robustness (the depth panel showed a lone ghost row + a bogus
// full-price "spread" of ask − 0 when the book went one-sided at close).
const lvl = (price: number, quantity: number) => ({ price, quantity, orders: 1 })
const twoSidedBook = { buy: [lvl(100, 50)], sell: [lvl(100.5, 40)] }
const oneSidedBook = { buy: [lvl(0, 0)], sell: [lvl(1308, 30037)] } // only asks, no bids
const emptyBook = { buy: [lvl(0, 0)], sell: [lvl(0, 0)] }

describe('depthTwoSided — is there a live two-sided market?', () => {
  it('true only when BOTH sides carry positive price + quantity', () => {
    expect(depthTwoSided(twoSidedBook)).toBe(true)
  })
  it('false for a one-sided book (market-closed snapshot)', () => {
    expect(depthTwoSided(oneSidedBook)).toBe(false)
  })
  it('false for an all-zero or missing book', () => {
    expect(depthTwoSided(emptyBook)).toBe(false)
    expect(depthTwoSided(undefined)).toBe(false)
  })
})

describe('depthSpread — best bid/ask spread', () => {
  it('is the ask − bid for a valid two-sided top-of-book', () => {
    expect(depthSpread(twoSidedBook)).toBeCloseTo(0.5, 5)
  })
  it('is null for a one-sided book — never reports ask − 0 as a spread', () => {
    expect(depthSpread(oneSidedBook)).toBeNull()
    expect(depthSpread(emptyBook)).toBeNull()
    expect(depthSpread(undefined)).toBeNull()
  })
  it('is null for a crossed/stale quote (ask < bid)', () => {
    expect(depthSpread({ buy: [lvl(101, 10)], sell: [lvl(100, 10)] })).toBeNull()
  })
})

