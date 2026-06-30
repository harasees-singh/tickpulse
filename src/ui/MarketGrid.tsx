import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { Icon } from './Icon'
import { tokenToIdx, symbols, ltp, chgPct, rvol, vwap, high, lastTickAt, turnoverOf } from '../core/store'
import { fmtPrice, fmtTurnover, fmtAge } from '../core/format'

const dirCls = (v: number) => (v > 0.01 ? 'up' : v < -0.01 ? 'down' : 'flat')

// Marketwatch grid — the active watchlist's symbols on a cheap 250ms updater
// (watchlists are small, so no virtualization). Rows for symbols that have a
// slot but no ticks yet (e.g. non-universe in demo) show "—".
export function MarketGrid(props: {
  tokens: number[]
  metaOf: (token: number) => { name: string; exch: string } | undefined
  onOpen: (name: string) => void
  onRemove: (token: number) => void
}) {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250)
    onCleanup(() => clearInterval(id))
  })

  const rows = () =>
    props.tokens.map((token) => {
      const idx = tokenToIdx.get(token)
      const m = props.metaOf(token)
      return {
        token,
        idx,
        name: idx !== undefined ? symbols[idx].name : m?.name ?? String(token),
        exch: idx !== undefined ? symbols[idx].exch : m?.exch ?? 'NSE'
      }
    })

  return (
    <div class="mw">
      <div class="mw-head">
        <div>Symbol</div>
        <div class="num">LTP</div>
        <div class="num">Chg%</div>
        <div class="num">RVOL</div>
        <div class="num">Turnover</div>
        <div class="num">VWAP Dist</div>
        <div class="num">% from High</div>
        <div class="num">Fresh</div>
        <div />
      </div>
      <Show when={rows().length} fallback={<div class="mw-empty">This watchlist is empty — search above to add symbols.</div>}>
        <For each={rows()}>
          {(r) => {
            const live = () => {
              tick()
              return r.idx !== undefined && lastTickAt[r.idx] > 0
            }
            const i = () => r.idx!
            const chg = () => (live() ? chgPct[i()] : 0)
            const vd = () => (live() && vwap[i()] ? ((ltp[i()] - vwap[i()]) / vwap[i()]) * 100 : 0)
            const fh = () => (live() && high[i()] ? ((ltp[i()] - high[i()]) / high[i()]) * 100 : 0)
            return (
              <div class="mw-row">
                <div class="mw-sym" onClick={() => props.onOpen(r.name)}>
                  <span class="sym-name">{r.name}</span>
                  <span class="sym-sub">{r.exch} • EQ</span>
                </div>
                <div class="num mono">{live() ? fmtPrice(ltp[i()]) : '—'}</div>
                <div class="num">
                  <Show when={live()} fallback={<span class="mw-dash">—</span>}>
                    <span class={'chg-pill ' + dirCls(chg())}>{(chg() > 0 ? '+' : '') + chg().toFixed(2)}%</span>
                  </Show>
                </div>
                <div class="num mono">{live() ? rvol[i()].toFixed(2) + 'x' : '—'}</div>
                <div class="num mono">{live() ? fmtTurnover(turnoverOf(i())) : '—'}</div>
                <div class={'num mono ' + (live() ? dirCls(vd()) : '')}>{live() ? (vd() > 0 ? '+' : '') + vd().toFixed(2) + '%' : '—'}</div>
                <div class="num mono">{live() ? fh().toFixed(1) + '%' : '—'}</div>
                <div class="num mono">{live() ? fmtAge(performance.now() - lastTickAt[i()]) : '—'}</div>
                <div class="mw-actions">
                  <button class="icon-btn" title="Open analytics" onClick={() => props.onOpen(r.name)}><Icon n="monitoring" /></button>
                  <button class="icon-btn" title="Remove from list" onClick={() => props.onRemove(r.token)}><Icon n="close" /></button>
                </div>
              </div>
            )
          }}
        </For>
      </Show>
    </div>
  )
}

