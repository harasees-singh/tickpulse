import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import SymbolTable from './SymbolTable'
import { MockTicker } from '../data/mockTicker'
import { KiteTickerAdapter } from '../data/kiteTicker'
import type { Ticker } from '../data/kite'
import {
  ingest, computeOrder, drainAlerts, getAndResetIngestCount,
  getBreakoutConfig, setBreakoutConfig,
  N, symbols, chgPct, buyQty, sellQty, type Alert, type SortKey
} from '../store'
import { startPump } from '../render'
import { fmtTime, fmtVol } from '../format'

const Icon = (p: { n: string }) => <span class="material-symbols-outlined">{p.n}</span>


export default function App() {
  const [sort, setSort] = createSignal<SortKey>('activity')
  const [filter, setFilter] = createSignal('')
  const [order, setOrder] = createSignal<number[]>(computeOrder('activity', ''))
  const [alerts, setAlerts] = createSignal<Alert[]>([])
  const [toasts, setToasts] = createSignal<Alert[]>([])
  const [fps, setFps] = createSignal(60)
  const [tps, setTps] = createSignal(0)
  const [rps, setRps] = createSignal(1)
  const [chaos, setChaos] = createSignal(false)
  const [paused, setPaused] = createSignal(false)
  const [adv, setAdv] = createSignal(0)
  const [dec, setDec] = createSignal(0)
  const [activity, setActivity] = createSignal(0)
  const [buy, setBuy] = createSignal(0)
  const [sell, setSell] = createSignal(0)
  const [wsLat, setWsLat] = createSignal(0)
  const [online, setOnline] = createSignal(navigator.onLine)
  const [netType, setNetType] = createSignal('')
  const [netRtt, setNetRtt] = createSignal<number | null>(null)
  const [live, setLive] = createSignal(false)
  const [userName, setUserName] = createSignal<string | null>(null)
  const [feedIdle, setFeedIdle] = createSignal(false)
  const [view, setView] = createSignal<'board' | 'settings'>('board')
  const bk = getBreakoutConfig()
  const [thInfo, setThInfo] = createSignal(bk.info)
  const [thWarn, setThWarn] = createSignal(bk.warn)
  const [thCrit, setThCrit] = createSignal(bk.crit)
  const [thCool, setThCool] = createSignal(bk.cooldownMs)

  let ticker: Ticker | undefined
  let mockTicker: MockTicker | null = null
  let log: Alert[] = []
  let idleSecs = 0
  const act60: number[] = []

  // Choose the data source from the Zerodha session: real feed if logged in,
  // otherwise the simulated mock. Both implement the same Ticker interface.
  function startTicker(sess: any) {
    if (sess?.connected && sess.access_token) {
      ticker = new KiteTickerAdapter({
        apiKey: sess.api_key,
        accessToken: sess.access_token,
        tokens: symbols.map((s) => s.token)
      })
      setLive(true)
      setUserName(sess.user_name ?? sess.user_id ?? null)
    } else {
      mockTicker = new MockTicker()
      ticker = mockTicker
      setLive(false)
    }
    ticker.on('ticks', ingest)
    ticker.connect()
  }

  onMount(() => {
    // Pick the data source from the Zerodha session (live vs simulated).
    fetch('/auth/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then(startTicker)
      .catch(() => startTicker(null))

    // tidy the ?auth=… param the OAuth redirect leaves behind
    if (location.search.includes('auth=')) {
      history.replaceState({}, '', location.pathname)
    }

    // User's real network health: online state + Network Information API.
    const conn = (navigator as any).connection
    const updateNet = () => {
      setOnline(navigator.onLine)
      setNetType(conn?.effectiveType ?? '')
      setNetRtt(typeof conn?.rtt === 'number' ? conn.rtt : null)
    }
    updateNet()
    window.addEventListener('online', updateNet)
    window.addEventListener('offline', updateNet)
    conn?.addEventListener?.('change', updateNet)

    const orderTimer = setInterval(() => setOrder(computeOrder(sort(), filter())), 750)
    const statsTimer = setInterval(() => {
      const t = getAndResetIngestCount()
      setTps(t)
      ticker?.ping()
      setWsLat(ticker?.getLatency() ?? 0)
      // Detect a live feed that's gone quiet (market closed / after-hours snapshot).
      if (t > 0) {
        idleSecs = 0
        if (feedIdle()) setFeedIdle(false)
      } else if (live()) {
        if (++idleSecs >= 8 && !feedIdle()) setFeedIdle(true)
      }
      act60.push(t)
      if (act60.length > 60) act60.shift()
      setActivity(act60.reduce((a, b) => a + b, 0))

      let a = 0
      let d = 0
      let sb = 0
      let ss = 0
      for (let i = 0; i < N; i++) {
        if (chgPct[i] > 0.01) a++
        else if (chgPct[i] < -0.01) d++
        sb += buyQty[i]
        ss += sellQty[i]
      }
      setAdv(a)
      setDec(d)
      setBuy(sb)
      setSell(ss)
    }, 1000)

    let fpsTick = 0
    startPump((_now, f) => {
      const a = drainAlerts()
      if (a.length) {
        log = [...a.slice().reverse(), ...log].slice(0, 60)
        setAlerts(log)
        const crit = a.filter((x) => x.tier === 3)
        if (crit.length) {
          setToasts((t) => [...crit, ...t].slice(0, 4))
          crit.forEach((c) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== c.id)), 4500))
        }
      }
      if (fpsTick++ % 6 === 0) setFps(f)
    })

    onCleanup(() => {
      clearInterval(orderTimer)
      clearInterval(statsTimer)
      window.removeEventListener('online', updateNet)
      window.removeEventListener('offline', updateNet)
      conn?.removeEventListener?.('change', updateNet)
      ticker?.disconnect()
    })
  })

  createEffect(() => setOrder(computeOrder(sort(), filter())))

  function onRps(v: number) {
    setRps(v)
    mockTicker?.setRpsScale(v)
  }
  function toggleChaos() {
    const next = !chaos()
    setChaos(next)
    mockTicker?.setBurstProb(next ? 0.01 : 0.0006)
  }
  function togglePause() {
    const next = !paused()
    setPaused(next)
    next ? mockTicker?.pause() : mockTicker?.resume()
  }

  // Breakout threshold controls (Settings tab) — persisted via the store.
  function onTh(which: 'info' | 'warn' | 'crit', v: number) {
    if (which === 'info') setThInfo(v)
    else if (which === 'warn') setThWarn(v)
    else setThCrit(v)
    setBreakoutConfig({ [which]: v } as any)
  }
  function onCooldown(secs: number) {
    setThCool(secs * 1000)
    setBreakoutConfig({ cooldownMs: secs * 1000 })
  }
  function resetBreakout() {
    const d = { info: 2.5, warn: 3.5, crit: 5, cooldownMs: 4000 }
    setBreakoutConfig(d)
    setThInfo(d.info)
    setThWarn(d.warn)
    setThCrit(d.crit)
    setThCool(d.cooldownMs)
  }

  const total = () => adv() + dec()
  const advPct = () => (total() ? (adv() / total()) * 100 : 50)
  const adRatio = () => (dec() ? (adv() / dec()).toFixed(2) : adv().toFixed(2))
  const fpsCls = () => (fps() >= 55 ? '' : fps() >= 30 ? 'warn' : 'bad')
  // User's network connection health (browser online state + Network Info API).
  const netSlow = () => netType() === '2g' || netType() === 'slow-2g'
  const connLabel = () => (!online() ? 'Offline' : netSlow() ? 'Weak' : 'Online')
  const connCls = () => (!online() ? 'stalled' : netSlow() ? 'weak' : 'ok')
  const netDetail = () => {
    const parts: string[] = []
    if (netType()) parts.push(netType().toUpperCase())
    if (netRtt() != null) parts.push(netRtt() + 'ms')
    return parts.length ? ' · ' + parts.join(' · ') : ''
  }
  // WebSocket health = measured pipeline latency (real-time, ms).
  const latText = () => (wsLat() < 10 ? wsLat().toFixed(1) : Math.round(wsLat()).toString())
  const latCls = () => (wsLat() < 50 ? '' : wsLat() < 150 ? 'warn' : 'bad')
  // Order-book pressure (aggregate buy vs sell quantity across tracked symbols).
  const obTotal = () => buy() + sell()
  const buyPct = () => (obTotal() ? (buy() / obTotal()) * 100 : 50)
  const sellPct = () => 100 - buyPct()
  const sentiment = () => (buyPct() >= 55 ? 'BULLISH' : buyPct() <= 45 ? 'BEARISH' : 'NEUTRAL')
  const sentimentCls = () => (buyPct() >= 55 ? 'up' : buyPct() <= 45 ? 'down' : 'flat')

  return (
    <div class="app">
      {/* ---------------- sidebar ---------------- */}
      <aside class="sidebar">
        <div class="brand-block">
          <div class="brand-row">
            <img class="brand-mark" src="/tickpulse-icon.svg" width="30" height="30" alt="" />
            <div>
              <h1>TickPulse</h1>
              <p>Terminal v2.4</p>
            </div>
          </div>
        </div>
        <nav class="nav">
          <div class="nav-item"><Icon n="dashboard" /> Dashboard</div>
          <div class="nav-item"><Icon n="list_alt" /> Marketwatch</div>
          <div class="nav-item" classList={{ active: view() === 'board' }} onClick={() => setView('board')}><Icon n="leaderboard" /> Leaderboard</div>
          <div class="nav-item"><Icon n="analytics" /> Analytics</div>
          <div class="nav-item" classList={{ active: view() === 'settings' }} onClick={() => setView('settings')}><Icon n="settings" /> Settings</div>
        </nav>
        <div class="sidebar-foot">
          <button class="btn-primary" onClick={() => (window.location.href = '/auth/login')} title="Sign in with your Zerodha account"><Icon n="bolt" /> Live Terminal</button>
          <div class="conn" title="Browser online state (navigator.onLine) + Network Information API estimate (Chromium only). Not a server reachability probe."><Icon n="wifi" /> Connection: <b class={connCls()}>{connLabel()}</b><span class="net-detail">{netDetail()}</span></div>
          <div class="conn"><Icon n="help" /> Help</div>
        </div>
      </aside>

      {/* ---------------- main ---------------- */}
      <main class="main">
        <header class="topnav">
          <div class="topnav-left">
            <div class="search-box">
              <Icon n="search" />
              <input
                type="text"
                placeholder="Search instruments…"
                value={filter()}
                onInput={(e) => setFilter(e.currentTarget.value)}
              />
            </div>
            <nav class="tabs">
              <a class="tab active" href="#">NSE</a>
              <a class="tab" href="#">BSE</a>
              <a class="tab" href="#">MCX</a>
            </nav>
          </div>
          <div class="topnav-right">
            <button class="icon-btn"><Icon n="notifications" /></button>
            <button class="icon-btn"><Icon n="bolt" /></button>
            <div class="avatar">T</div>
          </div>
        </header>


        {/* content */}
        <div class="content">
          <Show when={view() === 'settings'}>
            <div class="settings">
              <div class="content-head">
                <div>
                  <h2 class="content-title">Breakout Settings</h2>
                  <p class="content-sub">Define what counts as a volume breakout. These thresholds drive the alerts, row glows and the Recent Breakouts log — saved in this browser.</p>
                </div>
              </div>
              <div class="settings-card">
                <div class="setting-row">
                  <div class="setting-label"><span><span class="dot info" /> Watch (mild flag)</span><small>Slightly unusual volume.</small></div>
                  <div class="setting-control">
                    <input type="range" min="1" max="8" step="0.1" value={thInfo()} onInput={(e) => onTh('info', parseFloat(e.currentTarget.value))} />
                    <span class="setting-val">{thInfo().toFixed(1)}σ</span>
                  </div>
                </div>
                <div class="setting-row">
                  <div class="setting-label"><span><span class="dot warn" /> High</span><small>Notable surge in volume.</small></div>
                  <div class="setting-control">
                    <input type="range" min="1" max="10" step="0.1" value={thWarn()} onInput={(e) => onTh('warn', parseFloat(e.currentTarget.value))} />
                    <span class="setting-val">{thWarn().toFixed(1)}σ</span>
                  </div>
                </div>
                <div class="setting-row">
                  <div class="setting-label"><span><span class="dot crit" /> Spike (breakout)</span><small>Critical alert + toast.</small></div>
                  <div class="setting-control">
                    <input type="range" min="1" max="12" step="0.1" value={thCrit()} onInput={(e) => onTh('crit', parseFloat(e.currentTarget.value))} />
                    <span class="setting-val">{thCrit().toFixed(1)}σ</span>
                  </div>
                </div>
                <div class="setting-row">
                  <div class="setting-label"><span>Alert cooldown</span><small>Minimum gap between alerts per symbol.</small></div>
                  <div class="setting-control">
                    <input type="range" min="0" max="30" step="1" value={thCool() / 1000} onInput={(e) => onCooldown(parseFloat(e.currentTarget.value))} />
                    <span class="setting-val">{(thCool() / 1000).toFixed(0)}s</span>
                  </div>
                </div>
                <div class="setting-actions">
                  <span class="setting-note">A <b>breakout</b> fires when a symbol's latest per-tick volume is ≥ <b>{thCrit().toFixed(1)}σ</b> above its recent average (z-score). Watch / High are softer tiers.</span>
                  <button class="ghost-btn" onClick={resetBreakout}><Icon n="restart_alt" /> Reset defaults</button>
                </div>
              </div>
            </div>
          </Show>

          <Show when={view() === 'board'}>
          <div class="content-head">
            <div>
              <h2 class="content-title">Volume Leaderboard</h2>
              <p class="content-sub">{live()
                ? (feedIdle()
                  ? 'Live feed idle — last snapshot (market likely closed). Chg% is vs previous close.'
                  : 'Live NSE feed via Zerodha Kite — Chg% is vs previous close.')
                : 'Simulated demo feed — click “Live Terminal” to stream your real Zerodha data.'}</p>
            </div>
            <div class="content-actions">
              <label class="ctl">
                Sort
                <select value={sort()} onChange={(e) => setSort(e.currentTarget.value as SortKey)}>
                  <option value="activity">Activity</option>
                  <option value="rvol">RVOL</option>
                  <option value="volume">Volume</option>
                  <option value="change">Change %</option>
                  <option value="symbol">Symbol</option>
                </select>
              </label>
              <Show when={!live()}>
                <label class="ctl">
                  Load {rps().toFixed(1)}×
                  <input type="range" min="0.5" max="6" step="0.5" value={rps()}
                    onInput={(e) => onRps(parseFloat(e.currentTarget.value))} />
                </label>
                <button class="ghost-btn" classList={{ on: chaos() }} onClick={toggleChaos} title="More spontaneous spikes">
                  <Icon n="bolt" /> Chaos
                </button>
                <button class="ghost-btn" onClick={() => mockTicker?.triggerBurst()} title="Force a spike on a random symbol">
                  <Icon n="add_alert" /> Trigger spike
                </button>
                <button class="ghost-btn" classList={{ on: paused() }} onClick={togglePause}>
                  <Icon n={paused() ? 'play_arrow' : 'pause'} /> {paused() ? 'Resume' : 'Pause'}
                </button>
              </Show>
              <Show when={live()}>
                <span class="live-badge"><span class="live-dot" classList={{ idle: feedIdle() }} /> {feedIdle() ? 'IDLE' : 'LIVE'} · {userName()}</span>
                <button class="ghost-btn" onClick={() => (window.location.href = '/auth/logout')} title="Disconnect Zerodha">
                  <Icon n="logout" /> Logout
                </button>
              </Show>
            </div>
          </div>

          <SymbolTable order={order()} />

          {/* bento widgets */}
          <div class="bento">
            <div class="card breadth">
              <div class="card-head">
                <h3>Watchlist Breadth</h3>
                <span class="chip">{N} symbols</span>
              </div>
              <div class="ad-labels">
                <span class="a">ADVANCE ({adv()})</span>
                <span class="d">DECLINE ({dec()})</span>
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
                <h3><Icon n="import_export" /> Order Book Pressure</h3>
                <span class="chip">Aggregate</span>
              </div>
              <div class="press-row">
                <div class="press-line">
                  <div class="press-top">
                    <span class="lbl-buy">BUY VOLUME</span>
                    <span class="val">{Math.round(buyPct())}%</span>
                  </div>
                  <div class="press-track"><div class="press-bar buy" style={{ width: buyPct() + '%' }} /></div>
                  <p class="press-sub">Active Bids: {fmtVol(buy())} shares</p>
                </div>
                <div class="press-line">
                  <div class="press-top">
                    <span class="lbl-sell">SELL VOLUME</span>
                    <span class="val">{Math.round(sellPct())}%</span>
                  </div>
                  <div class="press-track"><div class="press-bar sell" style={{ width: sellPct() + '%' }} /></div>
                  <p class="press-sub">Active Asks: {fmtVol(sell())} shares</p>
                </div>
              </div>
              <div class="press-foot">
                <span>Volume Sentiment</span>
                <span class={'sentiment ' + sentimentCls()}>{sentiment()}</span>
              </div>
            </div>

            <div class="card activity">
              <div class="lbl">Trading Activity</div>
              <div class="big">{activity().toLocaleString('en-IN')}</div>
              <div class="sub">Ticks processed in the last 60s</div>
              <span class="material-symbols-outlined ghost-icon">insights</span>
            </div>

            <div class="card breakouts">
              <div class="card-head">
                <h3><Icon n="history_toggle_off" /> Recent Volume Breakouts</h3>
                <span class="chip">LIVE</span>
              </div>
              <div class="bk-list">
                <Show when={alerts().length} fallback={<div class="bk-empty">No spikes yet — try “Trigger spike”.</div>}>
                  <For each={alerts()}>
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
          </Show>
        </div>

        {/* WS status pill — real-time WebSocket telemetry */}
        <div class="ws-status">
          <span class="dot" classList={{ off: paused() }} title={paused() ? 'Paused' : 'Live'} />
          <div class="ws-col" title="Measured round-trip ping through the live data pipeline (worker↔UI). With the real socket this becomes the WebSocket ping/pong RTT.">
            <span class="k">WS PING</span>
            <span class="v" classList={{ [latCls()]: !!latCls() }}>{paused() ? '—' : latText() + ' ms'}</span>
          </div>
          <span class="ws-sep" />
          <div class="ws-col">
            <span class="k">THROUGHPUT</span>
            <span class="v">{tps().toLocaleString('en-IN')}/s</span>
          </div>
          <span class="ws-sep" />
          <div class="ws-col">
            <span class="k">RENDER</span>
            <span class="v" classList={{ [fpsCls()]: !!fpsCls() }}>{Math.round(fps())} fps</span>
          </div>
        </div>

        {/* critical toasts */}
        <div class="toasts">
          <For each={toasts()}>
            {(a) => (
              <div class="toast">
                <span class="material-symbols-outlined">bolt</span>
                <div>
                  <div class="tname">{a.name} — volume spike</div>
                  <div class="tmeta">z {a.z.toFixed(1)} · {a.rvol.toFixed(1)}× RVOL</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </main>
    </div>
  )
}
