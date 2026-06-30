import { describe, it, expect } from 'vitest'
import { MockEngine } from '../mock/mockEngine'
import { expectValidKiteTick } from './tickShape'

describe('MockEngine — Kite-shaped stand-in contract', () => {
  it('emits full-mode ticks that satisfy the KiteTick contract', () => {
    const t0 = Date.now()
    const eng = new MockEngine(t0)
    const ticks = eng.generateUpTo(t0 + 5000) // ~5s of activity
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) {
      expect(t.mode).toBe('full')
      expectValidKiteTick(t)
    }
  })

  it('keeps volume_traded cumulative (monotonically non-decreasing) per symbol', () => {
    const t0 = Date.now()
    const eng = new MockEngine(t0)
    const first = eng.generateUpTo(t0 + 4000)
    const second = eng.generateUpTo(t0 + 8000)

    const lastVolByToken = (arr: { instrument_token: number; volume_traded?: number }[]) => {
      const m = new Map<number, number>()
      for (const t of arr) m.set(t.instrument_token, t.volume_traded ?? 0)
      return m
    }
    const before = lastVolByToken(first)
    const after = lastVolByToken(second)
    for (const [token, v] of after) {
      if (before.has(token)) expect(v).toBeGreaterThanOrEqual(before.get(token)!)
    }
  })
})

