import { describe, it, expect } from 'vitest'
import * as S from '../core/store'
import { updateSettings } from '../core/settings'

// Regression: a live watchlist's slots must take their display name from the
// persisted watchlistMeta (recorded when the user searched + added the symbol),
// NOT from the raw instrument_token. The old code named them `String(token)`,
// so any watchlist symbol outside the tiny local universe showed as e.g. 492033.

describe('store — applyWatchlist name resolution', () => {
  it('names live watchlist slots from watchlistMeta, not the token number', () => {
    const token = 9_200_000
    updateSettings({
      watchlists: [{ id: 'wl', name: 'WL', tokens: [token], enabled: true }],
      activeWatchlist: 'wl',
      watchlistMeta: { [token]: { name: 'ACMECORP', exch: 'NSE' } }
    })

    const res = S.applyWatchlist({ live: true })
    expect(res.source).toBe('watchlist')
    expect(res.tokens).toContain(token)

    const idx = S.tokenToIdx.get(token)!
    expect(S.symbols[idx].name).toBe('ACMECORP') // real name, not '9200000'
    expect(S.resolveByName('ACMECORP')).toBe(idx)
  })

  it('falls back to the token id only when metadata is genuinely missing', () => {
    const token = 9_200_777
    updateSettings({
      watchlists: [{ id: 'wl2', name: 'WL2', tokens: [token], enabled: true }],
      activeWatchlist: 'wl2',
      watchlistMeta: {} // no meta recorded for this token
    })

    S.applyWatchlist({ live: true })
    const idx = S.tokenToIdx.get(token)!
    expect(S.symbols[idx].name).toBe(String(token)) // honest fallback
  })

  it('an explicit instruments override still takes precedence', () => {
    const token = 9_200_888
    updateSettings({
      watchlists: [{ id: 'wl3', name: 'WL3', tokens: [token], enabled: true }],
      activeWatchlist: 'wl3',
      watchlistMeta: { [token]: { name: 'FROM_META', exch: 'NSE' } }
    })

    S.applyWatchlist({ live: true, instruments: [{ token, name: 'FROM_OVERRIDE', exch: 'BSE' }] })
    const idx = S.tokenToIdx.get(token)!
    expect(S.symbols[idx].name).toBe('FROM_OVERRIDE')
  })
})

