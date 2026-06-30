import { describe, it, expect } from 'vitest'
// Namespace import so reads of the live-binding `N` always reflect the current count.
import * as S from '../core/store'
import { UNIVERSE } from '../data/universe'

describe('store — slot allocator', () => {
  it('pre-registers the local universe at import', () => {
    expect(S.N).toBeGreaterThanOrEqual(UNIVERSE.length)
    expect(S.symbols[0].token).toBe(UNIVERSE[0].token)
    expect(S.tokenToIdx.get(UNIVERSE[0].token)).toBe(0)
  })

  it('ensureSlot allocates a fresh slot and seeds price fields from base', () => {
    const n0 = S.N
    const idx = S.ensureSlot({ token: 9_000_001, name: 'TESTCO', exch: 'NSE', base: 123.5 })
    expect(idx).toBe(n0)
    expect(S.N).toBe(n0 + 1)
    expect(S.symbols[idx].name).toBe('TESTCO')
    expect(S.ltp[idx]).toBe(123.5)
    expect(S.prevClose[idx]).toBe(123.5)
    expect(S.vwap[idx]).toBe(123.5)
  })

  it('dedups by token — same idx, no growth', () => {
    const idx1 = S.ensureSlot({ token: 9_000_002, name: 'DUP', exch: 'NSE', base: 10 })
    const n1 = S.N
    const idx2 = S.ensureSlot({ token: 9_000_002, name: 'DUP-AGAIN', exch: 'NSE', base: 99 })
    expect(idx2).toBe(idx1)
    expect(S.N).toBe(n1)
    expect(S.symbols[idx1].name).toBe('DUP') // first registration wins
  })

  it('defaults the seed to 0 when base is omitted', () => {
    const idx = S.ensureSlot({ token: 9_000_003, name: 'NOBASE', exch: 'NSE' })
    expect(S.ltp[idx]).toBe(0)
    expect(S.vwap[idx]).toBe(0)
  })

  it('registerInstruments returns idxs and dedups against the universe', () => {
    const idxs = S.registerInstruments([
      { token: UNIVERSE[0].token, name: UNIVERSE[0].name, exch: 'NSE', base: UNIVERSE[0].base },
      { token: 9_000_004, name: 'NEWONE', exch: 'NSE', base: 5 }
    ])
    expect(idxs[0]).toBe(0) // existing universe slot reused
    expect(S.symbols[idxs[1]].name).toBe('NEWONE')
  })

  it('respects the MAX_N capacity and never overflows', () => {
    let token = 9_500_000
    while (S.N < S.MAX_N) {
      expect(S.ensureSlot({ token: token++, name: 'FILL', exch: 'NSE' })).toBeGreaterThanOrEqual(0)
    }
    expect(S.N).toBe(S.MAX_N)
    expect(S.ensureSlot({ token: token++, name: 'OVERFLOW', exch: 'NSE' })).toBe(-1)
    expect(S.N).toBe(S.MAX_N) // capacity is a hard ceiling
  })
})

