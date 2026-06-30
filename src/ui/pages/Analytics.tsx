import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { DepthLadder } from '../DepthLadder'
import {
  resolveByName, ensureSlot, symbols, ltp, chgPct, rvol, open, high, low, vwap, prevClose,
  turnoverOf, oi, cumDelta, buyQty, sellQty, cumVol
} from '../../core/store'
import { drawAnalyticsChart, makeChartState } from '../../core/chart'
import { fmtPrice, fmtVol, fmtTurnover } from '../../core/format'
import { SHORTCUT_LABEL } from '../CommandPalette'

// Per-symbol deep dive (DEV_PLAN §2.4) at /analytics/:symbol. Reads the live SoA
// for ONE symbol on a cheap rAF loop (not the rAF table pump).
export default function Analytics() {
  const params = useParams()
  const navigate = useNavigate()

  // `/analytics` (no symbol) → redirect to a sensible default so the page is
  // never empty. The component INSTANCE is reused across /analytics/:symbol?,
  // so we need a reactive effect (not an early-return Navigate, which renders
  // nothing once the route matches the same component).
  createEffect(() => {
    if (!params.symbol && symbols.length) {
      navigate('/analytics/' + symbols[0].name, { replace: true })
    }
  })

  const [bumpResolve, setBumpResolve] = createSignal(0)
  const idx = createMemo(() => (bumpResolve(), resolveByName(params.symbol ?? '')))
  const [resolving, setResolving] = createSignal(false)

  // Deep-link to ANY symbol — if it isn't tracked yet (e.g. a URL pasted
  // directly, no Scanner/palette involved), look it up in the instruments
  // dump and register a slot so the page can render. Decoupled from Scanner.
  createEffect(() => {
    const sym = params.symbol
    if (!sym || resolveByName(sym)) return
    setResolving(true)
    fetch('/auth/instruments?exchange=NSE&limit=1&q=' + encodeURIComponent(sym))
      .then((r) => r.json())
      .then((rows: { instrument_token: number; tradingsymbol: string; exchange: string }[]) => {
        const hit = rows?.find?.((r) => r.tradingsymbol.toUpperCase() === sym.toUpperCase()) ?? rows?.[0]
        if (hit) {
          ensureSlot({ token: hit.instrument_token, name: hit.tradingsymbol, exch: hit.exchange })
          setBumpResolve((n) => n + 1) // re-evaluate `idx`
        }
      })
      .catch(() => {})
      .finally(() => setResolving(false))
  })

  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250)
    onCleanup(() => clearInterval(id))
  })

  // Accessors that track `tick` and read the resolved slot.
  const at = (arr: Float64Array) => () => (tick(), idx() !== undefined ? arr[idx()!] : 0)
  const ltpV = at(ltp)
  const chgV = at(chgPct)
  const rvolV = at(rvol)
  const openV = at(open)
  const highV = at(high)
  const lowV = at(low)
  const vwapV = at(vwap)
  const pcV = at(prevClose)
  const oiV = at(oi)
  const cvdV = at(cumDelta)
  const cumVolV = at(cumVol)
  const buyQtyV = at(buyQty)
  const sellQtyV = at(sellQty)
  const turnoverV = () => (tick(), idx() !== undefined ? turnoverOf(idx()!) : 0)
  const name = () => (idx() !== undefined ? symbols[idx()!].name : (params.symbol ?? ''))
  const exch = () => (idx() !== undefined ? symbols[idx()!].exch : '')

  const chgCls = () => (chgV() > 0.01 ? 'up' : chgV() < -0.01 ? 'down' : 'flat')
  const flowTot = () => buyQtyV() + sellQtyV()
  const buyPct = () => (flowTot() ? (buyQtyV() / flowTot()) * 100 : 50)

  // Hero chart — rAF loop with an eased Y-scale so updates glide instead of
  // snapping. Honors prefers-reduced-motion by falling back to a coarse tick.
  let canvas: HTMLCanvasElement | undefined
  const chartState = makeChartState()
  onMount(() => {
    let raf = 0
    let running = true
    const frame = () => {
      if (!running) return
      const i = idx()
      if (i !== undefined && canvas) {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const w = Math.max(80, Math.round(canvas.clientWidth))
        const h = Math.max(80, Math.round(canvas.clientHeight))
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr
          canvas.height = h * dpr
        }
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawAnalyticsChart(ctx, i, w, h, chartState)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    onCleanup(() => {
      running = false
      cancelAnimationFrame(raf)
    })
  })

  return (
    <Show
      when={idx() !== undefined}
      fallback={
        <div class="content-head">
          <div>
            <h2 class="content-title">Analytics{params.symbol ? ' · ' + params.symbol : ''}</h2>
            <p class="content-sub">{resolving() ? 'Looking up instrument…' : params.symbol ? `Couldn't find "${params.symbol}". Press ${SHORTCUT_LABEL} to search.` : 'Open a symbol to see its deep dive.'}</p>
          </div>
        </div>
      }
    >
      <div class="analytics">
        <div class="content-head">
          <div class="ana-title">
            <h2 class="content-title">{name()}</h2>
            <span class={'ana-ltp ' + chgCls()}>{fmtPrice(ltpV())}</span>
            <span class={'chg-pill ' + chgCls()}>{(chgV() > 0 ? '+' : '') + chgV().toFixed(2)}%</span>
            <span class="ana-rvol">{rvolV().toFixed(2)}× RVOL</span>
          </div>
        </div>

        <div class="ana-grid">
          <div class="card ana-chart">
            <div class="ana-chart-head">
              <span class="ana-ovl">{exch()} • EQ · Intraday</span>
              <span class="ana-ovl-legend">
                <span class="lg lg-ltp"><i class={'lg-dot ' + chgCls()} /> LTP</span>
                <span class="lg lg-vwap"><i class="lg-dash vwap" /> VWAP</span>
                <span class="lg lg-pdc"><i class="lg-dash pdc" /> Prev close</span>
              </span>
            </div>
            <canvas ref={canvas} class="ana-canvas" />
          </div>

          <div class="card ana-side">
            <div class="ana-block">
              <div class="ana-block-h">Order-flow pressure</div>
              <div class="press-track"><div class="press-bar buy" style={{ width: buyPct() + '%' }} /></div>
              <div class="ana-flow-labels"><span class="up">{Math.round(buyPct())}% BUY</span><span class="down">{Math.round(100 - buyPct())}% SELL</span></div>
            </div>
            <div class="ana-block">
              <div class="ana-block-h">5-level depth ladder</div>
              <DepthLadder idx={idx()!} tick={tick()} />
            </div>
            <div class="ana-block">
              <div class="ana-block-h">CVD · cumulative volume delta</div>
              <div class={'ana-cvd ' + (cvdV() >= 0 ? 'up' : 'down')}>{fmtVol(Math.abs(cvdV()))} {cvdV() >= 0 ? 'net buying' : 'net selling'}</div>
            </div>
          </div>
        </div>

        <div class="ana-stats">
          <div class="ana-stat"><div class="ana-stat-l">Open</div><div class="ana-stat-v">{fmtPrice(openV())}</div></div>
          <div class="ana-stat"><div class="ana-stat-l">High</div><div class="ana-stat-v">{fmtPrice(highV())}</div></div>
          <div class="ana-stat"><div class="ana-stat-l">Low</div><div class="ana-stat-v">{fmtPrice(lowV())}</div></div>
          <div class="ana-stat"><div class="ana-stat-l">VWAP</div><div class="ana-stat-v">{fmtPrice(vwapV())}</div></div>
          <div class="ana-stat"><div class="ana-stat-l">Prev Close</div><div class="ana-stat-v">{fmtPrice(pcV())}</div></div>
          <div class="ana-stat"><div class="ana-stat-l">Turnover</div><div class="ana-stat-v">{fmtTurnover(turnoverV())}</div></div>
          <div class="ana-stat"><div class="ana-stat-l">Volume</div><div class="ana-stat-v">{fmtVol(cumVolV())}</div></div>
          <div class="ana-stat"><div class="ana-stat-l">OI</div><div class="ana-stat-v">{oiV() ? fmtVol(oiV()) : '—'}</div></div>
        </div>
      </div>
    </Show>
  )
}

