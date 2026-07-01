import { describe, it, expect } from 'vitest'
import * as S from '../core/store'
import { DEFAULT_SCAN_FILTERS } from '../core/store'
import { getSettings } from '../core/settings'
import { UNIVERSE } from '../data/universe'

// The Scanner is now the sole watchlist manager: first-run seeds the base
// universe, and the user adds/removes stocks that persist to the active
// watchlist. computeOrder is restricted to that membership set.

const activeTokens = () => {
  const s = getSettings()
  return s.watchlists.find((w) => w.id === s.activeWatchlist)!.tokens
}

describe('store — scanner watchlist', () => {
  it('seeds the base universe once and never re-seeds after an edit', () => {
    expect(getSettings().scannerSeeded).toBe(false)
    S.seedScannerWatchlist()
    expect(getSettings().scannerSeeded).toBe(true)
    for (const u of UNIVERSE) expect(activeTokens()).toContain(u.token)
    expect(getSettings().watchlistMeta[UNIVERSE[0].token].name).toBe(UNIVERSE[0].name)

    // A user who removes a seeded stock must not have it resurrected on re-seed.
    S.removeScannerStock(UNIVERSE[0].token)
    expect(activeTokens()).not.toContain(UNIVERSE[0].token)
    S.seedScannerWatchlist()
    expect(activeTokens()).not.toContain(UNIVERSE[0].token)
  })

  it('computeOrder restricts the board to the given members set', () => {
    const a = S.symbols[0].token
    const b = S.symbols[1].token
    const order = S.computeOrder('symbol', DEFAULT_SCAN_FILTERS, 'asc', new Set([a]))
    expect(order).toContain(S.tokenToIdx.get(a))
    expect(order).not.toContain(S.tokenToIdx.get(b))
  })

  it('computeOrder with no members set considers every registered slot (back-compat)', () => {
    const all = S.computeOrder('symbol', DEFAULT_SCAN_FILTERS, 'asc')
    expect(all).toContain(S.tokenToIdx.get(S.symbols[0].token))
    expect(all).toContain(S.tokenToIdx.get(S.symbols[1].token))
  })

  it('addScannerStock allocates a slot and persists it to the active watchlist', () => {
    const token = 9_400_000
    S.addScannerStock({ token, name: 'ADDCO', exch: 'NSE' })
    expect(S.tokenToIdx.get(token)).toBeGreaterThanOrEqual(0)
    expect(S.activeScannerTokens().has(token)).toBe(true)
    expect(getSettings().watchlistMeta[token].name).toBe('ADDCO')
  })

  it('removeScannerStock drops it from the watchlist but keeps the slot', () => {
    const token = 9_400_001
    S.addScannerStock({ token, name: 'DROPCO', exch: 'NSE' })
    expect(S.activeScannerTokens().has(token)).toBe(true)
    S.removeScannerStock(token)
    expect(S.activeScannerTokens().has(token)).toBe(false)
    expect(S.tokenToIdx.get(token)).toBeGreaterThanOrEqual(0) // slot retained
  })
})

