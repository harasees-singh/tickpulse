import { For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import SymbolTable from '../SymbolTable'
import { Icon } from '../Icon'
import { InfoTip } from '../InfoTip'
import { useTerminal } from '../terminal'
import { DEFAULT_SCAN_FILTERS, type ScanFilters } from '../../core/store'
import { fmtTime, fmtVol } from '../../core/format'

// Scanner — the core board (DEV_PLAN §2.1): volume leaderboard + bento widgets.
// All live state comes from the Shell via useTerminal(); board-only derived
// values are computed locally to keep the shared context lean.
export default function Scanner() {
  const t = useTerminal()
  const navigate = useNavigate()

  const total = () => t.adv() + t.dec()
  const advPct = () => (total() ? (t.adv() / total()) * 100 : 50)
  const adRatio = () => (t.dec() ? (t.adv() / t.dec()).toFixed(2) : t.adv().toFixed(2))
  const obTotal = () => t.buy() + t.sell()
  const buyPct = () => (obTotal() ? (t.buy() / obTotal()) * 100 : 50)
  const sellPct = () => 100 - buyPct()
  const sentiment = () => (buyPct() >= 55 ? 'BULLISH' : buyPct() <= 45 ? 'BEARISH' : 'NEUTRAL')
  const sentimentCls = () => (buyPct() >= 55 ? 'up' : buyPct() <= 45 ? 'down' : 'flat')
  const abovePct = () => (t.tracked() ? (t.aboveVwap() / t.tracked()) * 100 : 0)

  // Filter chips → the Shell-owned ScanFilters (drives computeOrder).
  const f = () => t.filters()
  const setF = (patch: Partial<ScanFilters>) => t.setFilters({ ...t.filters(), ...patch })
  const filtersActive = () =>
    !!(f().minRvol || f().minTurnover || f().priceMin || f().priceMax || f().aboveVwap || f().buyFlowOnly)

  return (
    <>
      <div class="content-head">
        <div>
          <h2 class="content-title">Volume Leaderboard</h2>
          <p class="content-sub">{t.live()
            ? (t.feedIdle()
              ? 'Live feed idle — last snapshot (market likely closed). Chg% is vs previous close.'
              : 'Live NSE feed via Zerodha Kite — Chg% is vs previous close.')
            : 'Simulated demo feed (dev mode) — switch to Live in Settings → Developer.'}</p>
        </div>
        <div class="content-actions">
          <Show when={!t.live()}>
            <label class="ctl">
              Load {t.rps().toFixed(1)}×
              <input type="range" min="0.5" max="6" step="0.5" value={t.rps()}
                onInput={(e) => t.onRps(parseFloat(e.currentTarget.value))} />
            </label>
            <button class="ghost-btn" classList={{ on: t.chaos() }} onClick={t.toggleChaos} title="More spontaneous spikes">
              <Icon n="bolt" /> Chaos
            </button>
            <button class="ghost-btn" onClick={() => t.triggerBurst()} title="Force a spike on a random symbol">
              <Icon n="add_alert" /> Trigger spike
            </button>
            <button class="ghost-btn" classList={{ on: t.paused() }} onClick={t.togglePause}>
              <Icon n={t.paused() ? 'play_arrow' : 'pause'} /> {t.paused() ? 'Resume' : 'Pause'}
            </button>
          </Show>
          <Show when={t.live()}>
            <span class="live-badge"><span class="live-dot" classList={{ idle: t.feedIdle() }} /> {t.feedIdle() ? 'IDLE' : 'LIVE'} · {t.userName()}</span>
          </Show>
        </div>
      </div>

      <div class="scan-filters">
        <span class="scan-filters-label"><Icon n="filter_alt" /> Filters</span>
        <label class="scan-chip scan-chip-text" title="Filter the visible rows by symbol name (substring match).">Symbol
          <input type="text" placeholder="e.g. HDFC" value={f().text}
            onInput={(e) => setF({ text: e.currentTarget.value })} />
        </label>
        <label class="scan-chip" title="Relative Volume — today's volume vs its recent average. 2× means twice the usual activity (a volume surge).">Min RVOL
          <input type="number" min="0" step="0.5" placeholder="0" value={f().minRvol || ''}
            onInput={(e) => setF({ minRvol: parseFloat(e.currentTarget.value) || 0 })} />
          <span>×</span>
        </label>
        <label class="scan-chip" title="Minimum value traded so far today (₹ crore) = VWAP × volume. Filters out illiquid names.">Min Turnover
          <input type="number" min="0" step="1" placeholder="0" value={f().minTurnover ? f().minTurnover / 1e7 : ''}
            onInput={(e) => setF({ minTurnover: (parseFloat(e.currentTarget.value) || 0) * 1e7 })} />
          <span>Cr</span>
        </label>
        <label class="scan-chip" title="Only show symbols whose last price is within this ₹ range.">Price ₹
          <input type="number" min="0" placeholder="min" value={f().priceMin || ''}
            onInput={(e) => setF({ priceMin: parseFloat(e.currentTarget.value) || 0 })} />
          <span>–</span>
          <input type="number" min="0" placeholder="max" value={f().priceMax || ''}
            onInput={(e) => setF({ priceMax: parseFloat(e.currentTarget.value) || 0 })} />
        </label>
        <button class="ghost-btn" classList={{ on: f().aboveVwap }} onClick={() => setF({ aboveVwap: !f().aboveVwap })} title="Show only symbols trading ABOVE their day VWAP (volume-weighted average price) — buyers in control, usually bullish intraday.">
          <Icon n="trending_up" /> Above VWAP
        </button>
        <button class="ghost-btn" classList={{ on: f().buyFlowOnly }} onClick={() => setF({ buyFlowOnly: !f().buyFlowOnly })} title="Show only symbols with more buyer-initiated than seller-initiated volume — i.e. net buying pressure (from the tick-rule order flow).">
          <Icon n="north_east" /> Net Buying
        </button>
        <Show when={filtersActive()}>
          <button class="ghost-btn" onClick={() => t.setFilters({ ...DEFAULT_SCAN_FILTERS, text: f().text })} title="Clear all filters">
            <Icon n="filter_alt_off" /> Clear
          </button>
        </Show>
      </div>

      <SymbolTable order={t.order()} sort={t.sort()} sortDir={t.sortDir()} onSort={t.cycleSort} onOpen={(m) => navigate('/analytics/' + m.name)} />

      {/* bento widgets */}
      <div class="bento">
        <div class="card breadth">
          <div class="card-head">
            <h3>Watchlist Breadth <InfoTip id="widget.breadth" /></h3>
            <span class="chip">{t.tracked()} symbols</span>
          </div>
          <div class="ad-labels">
            <span class="a">ADVANCE ({t.adv()})</span>
            <span class="d">DECLINE ({t.dec()})</span>
          </div>
          <div class="ad-row">
            <div class="ad-bar">
              <div class="ad-seg up" style={{ width: advPct() + '%' }} />
              <div class="ad-seg down" style={{ width: 100 - advPct() + '%' }} />
            </div>
            <div class="ad-ratio">
              <div class="v">{adRatio()}</div>
              <div class="l">A/D RATIO</div>
            </div>
          </div>
        </div>

        <div class="card pressure">
          <div class="card-head">
            <h3><Icon n="import_export" /> Order Book Pressure <InfoTip id="widget.pressure" /></h3>
            <span class="chip">Aggregate</span>
          </div>
          <div class="press-row">
            <div class="press-line">
              <div class="press-top">
                <span class="lbl-buy">BUY VOLUME</span>
                <span class="val">{Math.round(buyPct())}%</span>
              </div>
              <div class="press-track"><div class="press-bar buy" style={{ width: buyPct() + '%' }} /></div>
              <p class="press-sub">Active Bids: {fmtVol(t.buy())} shares</p>
            </div>
            <div class="press-line">
              <div class="press-top">
                <span class="lbl-sell">SELL VOLUME</span>
                <span class="val">{Math.round(sellPct())}%</span>
              </div>
              <div class="press-track"><div class="press-bar sell" style={{ width: sellPct() + '%' }} /></div>
              <p class="press-sub">Active Asks: {fmtVol(t.sell())} shares</p>
            </div>
          </div>
          <div class="press-foot">
            <span>Volume Sentiment</span>
            <span class={'sentiment ' + sentimentCls()}>{sentiment()}</span>
          </div>
        </div>

        <div class="card vwap">
          <div class="card-head">
            <h3>VWAP Positioning <InfoTip id="widget.vwap" /></h3>
            <span class="chip">{t.tracked()} symbols</span>
          </div>
          <div class="ad-labels">
            <span class="a">ABOVE ({t.aboveVwap()})</span>
            <span class="d">BELOW ({t.tracked() - t.aboveVwap()})</span>
          </div>
          <div class="ad-row">
            <div class="ad-bar">
              <div class="ad-seg up" style={{ width: abovePct() + '%' }} />
              <div class="ad-seg down" style={{ width: 100 - abovePct() + '%' }} />
            </div>
            <div class="ad-ratio">
              <div class="v">{Math.round(abovePct())}%</div>
              <div class="l">ABOVE VWAP</div>
            </div>
          </div>
        </div>

        <div class="card breakouts">
          <div class="card-head">
            <h3><Icon n="history_toggle_off" /> Recent Volume Breakouts <InfoTip id="widget.breakouts" /></h3>
            <span class="chip">LIVE</span>
          </div>
          <div class="bk-list">
            <Show when={t.alerts().length} fallback={<div class="bk-empty">No spikes yet — try “Trigger spike”.</div>}>
              <For each={t.alerts()}>
                {(a) => (
                  <div class="bk-row">
                    <span class="bk-name">{a.name}<small>NSE • EQ</small></span>
                    <span class="bk-surge" classList={{ up: a.tier < 3, down: a.tier === 3 }}>{a.rvol.toFixed(1)}x</span>
                    <span class="bk-time">{fmtTime(a.ts)}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </>
  )
}

