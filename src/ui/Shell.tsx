import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { A, useLocation, type RouteSectionProps } from '@solidjs/router'
import { MockTicker } from '../mock/mockTicker'
import { KiteTickerAdapter } from '../data/kiteTicker'
import type { Ticker } from '../data/kite'
import {
  ingest, computeOrder, drainAlerts, getAndResetIngestCount,
  getBreakoutConfig, setBreakoutConfig, applyWatchlist, ensureSlot,
  seedScannerWatchlist, activeScannerTokens, DEFAULT_SCAN_FILTERS, naturalDir,
  N, chgPct, buyQty, sellQty, ltp, vwap, type Alert, type SortKey, type SortDir, type ScanFilters
} from '../core/store'
import { startPump } from '../core/render'
import { updateSettings, getSettings, subscribeSettings, type Theme } from '../core/settings'
import { session, useMock, revokeSession } from '../core/session'
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
  // First-run seed: put the base universe in the scanner watchlist so the board
  // opens with 5 stocks (idempotent; never re-seeds once the user edits it).
  seedScannerWatchlist()

  const [sort, setSort] = createSignal<SortKey>('symbol')
  const [sortDir, setSortDir] = createSignal<SortDir>('asc')
  const [filters, setFilters] = createSignal<ScanFilters>(DEFAULT_SCAN_FILTERS)
  // The board only shows the scanner watchlist (activeScannerTokens); computeOrder
  // is restricted to those members everywhere it's called below.
  const [order, setOrder] = createSignal<number[]>(computeOrder('symbol', DEFAULT_SCAN_FILTERS, 'asc', activeScannerTokens()))
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
  const [wsConnected, setWsConnected] = createSignal(false)
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

  // Collapsible sidebar (icon rail) — animated width, state persisted so it
  // survives reloads and stays in sync if changed elsewhere.
  const [collapsed, setCollapsed] = createSignal(getSettings().sidebarCollapsed)
  onCleanup(subscribeSettings((s) => setCollapsed(s.sidebarCollapsed)))
  function toggleSidebar() {
    updateSettings({ sidebarCollapsed: !collapsed() })
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
    // Reflect real socket state in the WS pill (green + latency vs red OFFLINE).
    // Register BEFORE connect() so MockTicker's synchronous connect is caught.
    ticker.on('connect', () => setWsConnected(true))
    ticker.on('disconnect', () => setWsConnected(false))
    // Repeated data-less sockets ⇒ the access_token is dead. The socket is the
    // only component that truly knows this — the server's /auth/session only
    // checks the cookie, which outlives the daily Kite token — so trust it and
    // drop the user on Login to refresh the token.
    ticker.on('authError', () => revokeSession())
    ticker.connect()
  }

  onMount(() => {
    // Re-register persisted watchlist instruments FIRST, so their real names are
    // in the store before the ticker seeds any slots (otherwise a live watchlist
    // token would be created with its numeric id as the name). Live subscribe/
    // unsubscribe follows as the active watchlist edits.
    const wlMeta = getSettings().watchlistMeta
    for (const k of Object.keys(wlMeta)) {
      const m = wlMeta[Number(k)]
      ensureSlot({ token: Number(k), name: m.name, exch: m.exch })
    }

    startTicker()

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
    // On any settings change, (live) re-sync socket subscriptions AND re-derive
    // the board so scanner add/remove is reflected immediately.
    const onSettingsChange = () => {
      syncSubscriptions()
      setOrder(computeOrder(sort(), filters(), sortDir(), activeScannerTokens()))
    }
    const unsubWatchlist = subscribeSettings(onSettingsChange)
    // Real network health: ping our own server every 4s and measure the actual
    // round-trip. RTT → bars (4 best, 0 offline). navigator.connection.downlink
    // (Chromium only) caps strength if bandwidth is poor. navigator.onLine
    // flips strength to 0 instantly without waiting for the next ping.
    const conn = (navigator as any).connection
    const updateOnline = () => setOnline(navigator.onLine)
    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)

    async function measurePing() {
      if (!navigator.onLine) {
        setNetRtt(null)
        return
      }
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 3500)
      const t0 = performance.now()
      try {
        await fetch('/auth/ping?t=' + t0, { cache: 'no-store', signal: ctrl.signal })
        const rtt = performance.now() - t0
        // EWMA smoothing so a single spike doesn't flicker the bars (α=0.4).
        setNetRtt((prev) => (prev == null ? rtt : prev + 0.4 * (rtt - prev)))
      } catch {
        setNetRtt(null) // timeout / failure
      } finally {
        clearTimeout(timeout)
      }
    }
    measurePing()
    const pingTimer = setInterval(measurePing, 4000)
    // Surface effective downlink hint when available (Chromium) — used as a cap.
    const updateDownlink = () => setNetType(conn?.effectiveType ?? '')
    updateDownlink()
    conn?.addEventListener?.('change', updateDownlink)

    const orderTimer = setInterval(() => setOrder(computeOrder(sort(), filters(), sortDir(), activeScannerTokens())), 750)
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
      clearInterval(pingTimer)
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      conn?.removeEventListener?.('change', updateDownlink)
      unsubWatchlist()
      ticker?.disconnect()
    })
  })

  createEffect(() => setOrder(computeOrder(sort(), filters(), sortDir(), activeScannerTokens())))

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
  // Network strength = measured RTT band, capped by effectiveType when poor.
  // 0 offline · 1 poor · 2 fair · 3 good · 4 excellent.
  const netBars = () => {
    if (!online()) return 0
    const r = netRtt()
    if (r == null) return 1 // online but last ping failed
    let bars = r < 60 ? 4 : r < 150 ? 3 : r < 400 ? 2 : 1
    const et = netType()
    if (et === '2g' || et === 'slow-2g') bars = Math.min(bars, 1)
    else if (et === '3g') bars = Math.min(bars, 2)
    return bars
  }
  const netIcon = () => {
    const b = netBars()
    if (b === 0) return 'signal_wifi_off'
    if (b === 4) return 'signal_wifi_4_bar'
    if (b === 3) return 'network_wifi_3_bar'
    if (b === 2) return 'network_wifi_2_bar'
    return 'network_wifi_1_bar'
  }
  const connLabel = () => {
    const b = netBars()
    return ['Offline', 'Poor', 'Fair', 'Good', 'Excellent'][b]
  }
  const connCls = () => {
    const b = netBars()
    return b === 0 ? 'stalled' : b === 1 ? 'weak' : b === 2 ? 'fair' : 'ok'
  }
  const netDetail = () => {
    const r = netRtt()
    if (r == null) return ''
    return ' · ' + Math.round(r) + ' ms'
  }
  const latText = () => (wsLat() < 10 ? wsLat().toFixed(1) : Math.round(wsLat()).toString())
  const latCls = () => {
    if (!paused() && !wsConnected()) return 'bad' // socket down → red
    return wsLat() < 50 ? '' : wsLat() < 150 ? 'warn' : 'bad'
  }

  const ctx: TerminalCtx = {
    sort, setSort, filters, setFilters, order, alerts, live, userName, feedIdle,
    sortDir, cycleSort,
    adv, dec, aboveVwap, buy, sell, tracked,
    rps, chaos, paused, onRps, toggleChaos, togglePause, triggerBurst,
    thInfo, thWarn, thCrit, thCool, onTh, onCooldown, resetBreakout
  }

  return (
    <div class="app" classList={{ 'sidebar-collapsed': collapsed() }}>
      {/* ---------------- sidebar ---------------- */}
      <aside class="sidebar">
        <div class="brand-block">
          <div class="brand-row">
            <img class="brand-mark" src="/tickpulse-icon.svg" width="30" height="30" alt="" />
            <div class="brand-text">
              <h1>TickPulse</h1>
              <p>Terminal v2.4</p>
            </div>
            <button class="icon-btn burger" onClick={toggleSidebar} title={collapsed() ? 'Expand sidebar' : 'Collapse sidebar'} aria-label="Toggle sidebar">
              <Icon n="menu" />
            </button>
          </div>
        </div>
        <nav class="nav">
          <A href="/scanner" class="nav-item" activeClass="active" title="Scanner" end><Icon n="leaderboard" /> <span class="nav-label">Scanner</span></A>
          <A href="/analytics" class="nav-item" activeClass="active" title="Analytics"><Icon n="analytics" /> <span class="nav-label">Analytics</span></A>
        </nav>
        <div class="sidebar-foot">
          <div class="conn" title={helpText('conn')}><Icon n={netIcon()} /> <b class={connCls()}>{connLabel()}</b><span class="net-detail">{netDetail()}</span></div>
          <Show when={useMock()}>
            <div class="conn demo-badge"><Icon n="construction" /> <span class="nav-label">Demo mode (dev)</span></div>
          </Show>
        </div>
      </aside>

      {/* ---------------- main ---------------- */}
      <main class="main">
        <header class="topnav">
          <div class="topnav-left" />
          <button class="topnav-search" onClick={() => openPalette()} title={'Search symbols (' + SHORTCUT_LABEL + ')'}>
            <Icon n="search" />
            <span class="topnav-search-text">Search stocks…</span>
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
            <A href="/settings" class="icon-btn" activeClass="active" title="Settings"><Icon n="settings" /></A>
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
          <span
            class="dot"
            classList={{ off: paused(), bad: !paused() && !wsConnected() }}
            title={paused() ? 'Paused' : wsConnected() ? 'Live' : 'Disconnected'}
          />
          <div class="ws-col" title={helpText('ws.ping')}>
            <span class="k">WS PING</span>
            <span class="v" classList={{ [latCls()]: !!latCls() }}>
              {paused() ? '—' : !wsConnected() ? 'OFFLINE' : latText() + ' ms'}
            </span>
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


