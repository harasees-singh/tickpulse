import { Index, Show } from 'solid-js'
import { depth } from '../core/store'
import { fmtPrice, fmtQty } from '../core/format'

// 5-level bid/ask ladder for one symbol, reading the live depth snapshot.
// IMPORTANT: uses <Index> (position-keyed) not <For> (reference-keyed). The
// store hands us a fresh depth object every tick — with <For> Solid would
// unmount + remount every row each tick, killing the CSS width transition on
// `.ladder-fill`. <Index> reuses the same DOM nodes and just patches their
// values, so the bars animate smoothly.
export function DepthLadder(props: { idx: number; tick: number }) {
  const book = () => {
    void props.tick // track for live refresh
    return depth[props.idx]
  }
  const asks = () => {
    const d = book()
    if (!d) return [] as { price: number; quantity: number }[]
    const a = d.sell.slice(0, 5)
    while (a.length < 5) a.push({ price: 0, quantity: 0, orders: 0 })
    return a.reverse()
  }
  const bids = () => {
    const d = book()
    if (!d) return [] as { price: number; quantity: number }[]
    const b = d.buy.slice(0, 5)
    while (b.length < 5) b.push({ price: 0, quantity: 0, orders: 0 })
    return b
  }
  const maxQ = () => {
    const d = book()
    if (!d) return 1
    let m = 1
    for (const l of d.buy) if (l.quantity > m) m = l.quantity
    for (const l of d.sell) if (l.quantity > m) m = l.quantity
    return m
  }
  const spread = () => {
    const d = book()
    if (!d || !d.buy[0] || !d.sell[0]) return '—'
    return fmtPrice(d.sell[0].price - d.buy[0].price)
  }
  return (
    <Show when={book()} fallback={<div class="ladder-empty">No depth data yet.</div>}>
      <div class="ladder">
        <Index each={asks()}>
          {(level) => (
            <div class="ladder-row ask">
              <span class="ladder-fill" style={{ width: level().quantity ? (level().quantity / maxQ()) * 100 + '%' : '0%' }} />
              <span class="ladder-q">{level().quantity ? fmtQty(level().quantity) : ''}</span>
              <span class="ladder-p">{level().price ? fmtPrice(level().price) : ''}</span>
            </div>
          )}
        </Index>
        <div class="ladder-spread">Spread {spread()}</div>
        <Index each={bids()}>
          {(level) => (
            <div class="ladder-row bid">
              <span class="ladder-fill" style={{ width: level().quantity ? (level().quantity / maxQ()) * 100 + '%' : '0%' }} />
              <span class="ladder-q">{level().quantity ? fmtQty(level().quantity) : ''}</span>
              <span class="ladder-p">{level().price ? fmtPrice(level().price) : ''}</span>
            </div>
          )}
        </Index>
      </div>
    </Show>
  )
}

