import { For, Show } from 'solid-js'
import { useTerminal } from '../terminal'
import { symbols } from '../../core/store'
import { openKiteOrder } from '../kiteOrder'
import { fmtTime } from '../../core/format'

// Tier → label + colour (mirrors the breakout tiers in the store).
const TIER: Record<number, { label: string; cls: string }> = {
  1: { label: 'Watch', cls: 'info' },
  2: { label: 'High', cls: 'warn' },
  3: { label: 'Spike', cls: 'crit' }
}


// Alerts — the recent volume-breakout log (newest first). Each row can be traded
// straight to Kite via the Buy/Sell buttons.
export default function Alerts() {
  const t = useTerminal()

  return (
    <>
      <div class="content-head">
        <div>
          <h2 class="content-title">Alerts</h2>
          <p class="content-sub">Volume-breakout alerts, newest first. Tap Buy/Sell to open the order ticket on Zerodha Kite.</p>
        </div>
      </div>

      <div class="alerts-list">
        <Show when={t.alerts().length} fallback={<div class="alerts-empty">No alerts yet — volume spikes across your scanner will appear here.</div>}>
          <For each={t.alerts()}>
            {(a) => {
              const exch = symbols[a.idx]?.exch ?? 'NSE'
              const tier = TIER[a.tier] ?? TIER[1]
              return (
                <div class="alert-row">
                  <span class={'alert-tier ' + tier.cls}>{tier.label}</span>
                  <span class="alert-name">{a.name}<small>{exch} • EQ</small></span>
                  <span class="alert-metric">{a.rvol.toFixed(1)}× RVOL</span>
                  <span class="alert-metric muted">z {a.z.toFixed(1)}</span>
                  <span class="alert-time">{fmtTime(a.ts)}</span>
                  <div class="alert-actions">
                    <button class="ord-btn buy" onClick={() => openKiteOrder('BUY', a.name, exch)} title={`Buy ${a.name} on Kite`}>BUY</button>
                    <button class="ord-btn sell" onClick={() => openKiteOrder('SELL', a.name, exch)} title={`Sell ${a.name} on Kite`}>SELL</button>
                  </div>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </>
  )
}

