import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { A, useLocation, type RouteSectionProps } from '@solidjs/router'
import { MockTicker } from '../mock/mockTicker'
import { KiteTickerAdapter } from '../data/kiteTicker'
import type { Ticker } from '../data/kite'
import {
  ingest, computeOrder, drainAlerts, getAndResetIngestCount,
  getBreakoutConfig, setBreakoutConfig, applyWatchlist, ensureSlot, DEFAULT_SCAN_FILTERS, naturalDir,
  N, chgPct, buyQty, sellQty, ltp, vwap, type Alert, type SortKey, type SortDir, type ScanFilters
} from '../core/store'
import { startPump } from '../core/render'
import { updateSettings, getSettings, subscribeSettings, type Theme } from '../core/settings'
import { session, useMock } from '../core/session'
import { helpText } from '../core/help'
import { Icon } from './Icon'
import { CommandPalette, openPalette, SHORTCUT_KEYS, SHORTCUT_LABEL } from './CommandPalette'
import { TerminalContext, type TerminalCtx } from './terminal'

// Shell — the persistent app layout (DEV_PLAN §1.B). As the Router `root` it
// mounts ONCE and only swaps the routed page in `.content`, so the ticker, rAF
// pump and timers are created a single time and survive navigation. Shared state
// is handed to pages via <TerminalContext>; shell-local UI (search, ws-status,
// toasts, connection) stays here.
export default function Shell(props: RouteSectionProps) {
  const [sort, setSort] = createSignal<SortKey>('symbol')
  const [sortDir, setSortDir] = createSignal<SortDir>('asc')
  const [filters, setFilters] = createSignal<ScanFilters>(DEFAULT_SCAN_FILTERS)
  const [order, setOrder] = createSignal<number[]>(computeOrder('symbol', DEFAULT_SCAN_FILTERS, 'asc'))
  const [alerts, setAlerts] = createSignal<Alert[]>([])
  const [toasts, setToasts] = createSignal<Alert[]>([])
  const [fps, setFps] = createSignal(60)
  const [tps, setTps] = createSignal(0)
  const [rps, setRps] = createSignal(1)
  const [chaos, setChaos] = createSignal(false)
  const [paused, setPaused] = createSignal(false)
  const [adv, setAdv] = createSignal(0)
  const [dec, setDec] = createSignal(0)
  const [aboveVwap, setAboveVwap] = createSignal(0)
  const [tracked, setTracked] = createSignal(N) // count of symbols after filters
  const [buy, setBuy] = createSignal(0)
  const [sell, setSell] = createSignal(0)
  const [wsLat, setWsLat] = createSignal(0)
  const [online, setOnline] = createSignal(navigator.onLine)
  const [netType, setNetType] = createSignal('')
  const [netRtt, setNetRtt] = createSignal<number | null>(null)
  const [live, setLive] = createSignal(false)
  const [userName, setUserName] = createSignal<string | null>(null)
  const [feedIdle, setFeedIdle] = createSignal(false)
  const bk = getBreakoutConfig()
  const [thInfo, setThInfo] = createSignal(bk.info)
  const [thWarn, setThWarn] = createSignal(bk.warn)
  const [thCrit, setThCrit] = createSignal(bk.crit)
  const [thCool, setThCool] = createSignal(bk.cooldownMs)

  let ticker: Ticker | undefined
  let mockTicker: MockTicker | null = null
  let log: Alert[] = []
  let idleSecs = 0

  const loc = useLocation()

  // Theme (Obsidian/Daylight) quick-toggle — stays in sync with the Settings
  // page via the settings subscription; core/theme.ts applies the change.
  const [theme, setTheme] = createSignal<Theme>(getSettings().theme)
  onCleanup(subscribeSettings((s) => setTheme(s.theme)))
  function toggleTheme() {
    updateSettings({ theme: theme() === 'obsidian' ? 'daylight' : 'obsidian' })
  }

  // Unread-alerts badge for the topnav bell: alert ids increase monotonically,
  // so (latest id − last-seen id) is the count raised since /alerts was viewed.
  const [seenAlertId, setSeenAlertId] = createSignal(0)
  const unreadAlerts = () => Math.max(0, (alerts()[0]?.id ?? 0) - seenAlertId())
  createEffect(() => {
    if (loc.pathname === '/alerts') setSeenAlertId(alerts()[0]?.id ?? seenAlertId())
  })

  // Data source: live Zerodha socket (authenticated) or — dev only — the mock.
  // The session was already fetched by the auth gate (session.ts); no re-fetch.
  function startTicker() {
    if (useMock()) {
      mockTicker = new MockTicker()
      ticker = mockTicker
      setLive(false)
    } else {
      const sess = session()
      ticker = new KiteTickerAdapter({
        apiKey: sess?.api_key ?? '',
        accessToken: sess?.access_token ?? '',
        tokens: applyWatchlist({ live: true }).tokens
      })
      setLive(true)
      setUserName(sess?.user_name ?? sess?.user_id ?? null)
    }
    ticker.on('ticks', ingest)
    ticker.connect()
  }

  onMount(() => {
    startTicker()

    // Re-register persisted watchlist instruments so their names resolve after a
    // reload, and (live only) subscribe/unsubscribe as the active watchlist edits.
    const wlMeta = getSettings().watchlistMeta
    for (const k of Object.keys(wlMeta)) {
      const m = wlMeta[Number(k)]
      ensureSlot({ token: Number(k), name: m.name, exch: m.exch })
    }
    let subscribed = new Set<number>()
    const syncSubscriptions = () => {
      if (!live() || !ticker) return
      const st = getSettings()
      const tokens = st.watchlists.find((w) => w.id === st.activeWatchlist)?.tokens ?? []
      const next = new Set(tokens)
      const toAdd = tokens.filter((x) => !subscribed.has(x))
      const toRemove = [...subscribed].filter((x) => !next.has(x))
      if (toAdd.length) ticker.subscribe(toAdd)
      if (toRemove.length) ticker.unsubscribe(toRemove)
      subscribed = next
    }
    const unsubWatchlist = subscribeSettings(syncSubscriptions)
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

    const orderTimer = setInterval(() => setOrder(computeOrder(sort(), filters(), sortDir())), 750)
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

      // Breadth / pressure / VWAP stats reflect the CURRENTLY FILTERED set only.
      const ord = order()
      let a = 0
      let d = 0
      let sb = 0
      let ss = 0
      let av = 0
      for (let k = 0; k < ord.length; k++) {
        const i = ord[k]
        if (chgPct[i] > 0.01) a++
        else if (chgPct[i] < -0.01) d++
        sb += buyQty[i]
        ss += sellQty[i]
        if (ltp[i] > vwap[i]) av++
      }
      setAdv(a)
      setDec(d)
      setBuy(sb)
      setSell(ss)
      setAboveVwap(av)
      setTracked(ord.length)
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
      unsubWatchlist()
      ticker?.disconnect()
    })
  })

  createEffect(() => setOrder(computeOrder(sort(), filters(), sortDir())))

  // Click-to-sort: re-clicking the active column flips direction; a new column
  // resets to its natural direction (names A→Z, metrics high→low).
  function cycleSort(key: SortKey) {
    if (key === sort()) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setSortDir(naturalDir(key))
    }
  }

  // Persist the active section (first path segment) whenever the route changes.
  createEffect(() => {
    const seg = loc.pathname.split('/')[1]
    if (seg) updateSettings({ activeSection: seg })
  })

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
  function triggerBurst() {
    mockTicker?.triggerBurst()
  }

  // Breakout threshold controls — persisted via the store → settings.ts.
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

  // --- shell-local derived (ws-status + sidebar connection) ---
  const fpsCls = () => (fps() >= 55 ? '' : fps() >= 30 ? 'warn' : 'bad')
  const netSlow = () => netType() === '2g' || netType() === 'slow-2g'
  const connLabel = () => (!online() ? 'Offline' : netSlow() ? 'Weak' : 'Online')
  const connCls = () => (!online() ? 'stalled' : netSlow() ? 'weak' : 'ok')
  const netDetail = () => {
    const parts: string[] = []
    if (netType()) parts.push(netType().toUpperCase())
    if (netRtt() != null) parts.push(netRtt() + 'ms')
    return parts.length ? ' · ' + parts.join(' · ') : ''
  }
  const latText = () => (wsLat() < 10 ? wsLat().toFixed(1) : Math.round(wsLat()).toString())
  const latCls = () => (wsLat() < 50 ? '' : wsLat() < 150 ? 'warn' : 'bad')

  const ctx: TerminalCtx = {
    sort, setSort, filters, setFilters, order, alerts, live, userName, feedIdle,
    sortDir, cycleSort,
    adv, dec, aboveVwap, buy, sell, tracked,
    rps, chaos, paused, onRps, toggleChaos, togglePause, triggerBurst,
    thInfo, thWarn, thCrit, thCool, onTh, onCooldown, resetBreakout
  }

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
          <A href="/dashboard" class="nav-item" activeClass="active" end><Icon n="dashboard" /> Dashboard</A>
          <A href="/marketwatch" class="nav-item" activeClass="active" end><Icon n="list_alt" /> Marketwatch</A>
          <A href="/scanner" class="nav-item" activeClass="active" end><Icon n="leaderboard" /> Scanner</A>
          <A href="/analytics" class="nav-item" activeClass="active"><Icon n="analytics" /> Analytics</A>
          <A href="/alerts" class="nav-item" activeClass="active" end><Icon n="notifications_active" /> Alerts</A>
          <A href="/settings" class="nav-item" activeClass="active" end><Icon n="settings" /> Settings</A>
        </nav>
        <div class="sidebar-foot">
          <div class="conn" title={helpText('conn')}><Icon n="wifi" /> Connection: <b class={connCls()}>{connLabel()}</b><span class="net-detail">{netDetail()}</span></div>
          <Show when={useMock()}>
            <div class="conn demo-badge"><Icon n="construction" /> Demo mode (dev)</div>
          </Show>
        </div>
      </aside>

      {/* ---------------- main ---------------- */}
      <main class="main">
        <header class="topnav">
          <div class="topnav-left">
            <nav class="tabs">
              <span class="tab active" title="National Stock Exchange — the segment currently tracked">NSE</span>
            </nav>
          </div>
          <button class="topnav-search" onClick={() => openPalette()} title={'Search symbols (' + SHORTCUT_LABEL + ')'}>
            <Icon n="search" />
            <span class="topnav-search-text">Search symbols…</span>
            <span class="kbd-row">
              <kbd class="kbd-cap">{SHORTCUT_KEYS[0]}</kbd>
              <kbd class="kbd-cap">{SHORTCUT_KEYS[1]}</kbd>
            </span>
          </button>
          <div class="topnav-right">
            <A href="/alerts" class="icon-btn icon-wrap" activeClass="active" title="Alerts">
              <Icon n="notifications" />
              <Show when={unreadAlerts() > 0}><span class="icon-badge">{unreadAlerts() > 9 ? '9+' : unreadAlerts()}</span></Show>
            </A>
            <button class="icon-btn" onClick={toggleTheme} title={theme() === 'obsidian' ? 'Switch to Daylight (light)' : 'Switch to Obsidian (dark)'}>
              <Icon n={theme() === 'obsidian' ? 'light_mode' : 'dark_mode'} />
            </button>
            <A class="avatar" href="/profile" title={userName() ?? 'Account'}>{(userName() ?? 'T').charAt(0).toUpperCase()}</A>
          </div>
        </header>

        {/* routed page */}
        <div class="content">
          <TerminalContext.Provider value={ctx}>
            {props.children}
          </TerminalContext.Provider>
        </div>

        {/* WS status pill — real-time WebSocket telemetry */}
        <div class="ws-status">
          <span class="dot" classList={{ off: paused() }} title={paused() ? 'Paused' : 'Live'} />
          <div class="ws-col" title={helpText('ws.ping')}>
            <span class="k">WS PING</span>
            <span class="v" classList={{ [latCls()]: !!latCls() }}>{paused() ? '—' : latText() + ' ms'}</span>
          </div>
          <span class="ws-sep" />
          <div class="ws-col" title={helpText('ws.throughput')}>
            <span class="k">THROUGHPUT</span>
            <span class="v">{tps().toLocaleString('en-IN')}/s</span>
          </div>
          <span class="ws-sep" />
          <div class="ws-col" title={helpText('ws.render')}>
            <span class="k">RENDER</span>
            <span class="v" classList={{ [fpsCls()]: !!fpsCls() }}>{Math.round(fps())} fps</span>
          </div>
        </div>

        {/* ⌘K / Ctrl+K command palette */}
        <CommandPalette />

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


