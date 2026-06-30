import { For, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { symbols, ltp, chgPct, cumVol, rvol, type SymMeta } from '../store'
import { register, unregister, type RowRefs } from '../render'
import { fmtPrice, fmtVol } from '../format'

const ROW_H = 56
const OVERSCAN = 6
const SPARK_H = 30
const PRICE_H = 30

// Lightweight custom virtualization: only ~viewport rows exist in the DOM, each
// absolutely positioned. Keyed by stable SymMeta refs so scrolling reuses nodes.
export default function SymbolTable(props: { order: number[] }) {
  let scroller!: HTMLDivElement
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewH, setViewH] = createSignal(560)

  onMount(() => {
    const ro = new ResizeObserver(() => setViewH(scroller.clientHeight))
    ro.observe(scroller)
    setViewH(scroller.clientHeight)
    onCleanup(() => ro.disconnect())
  })

  const total = () => props.order.length
  const start = createMemo(() => Math.max(0, Math.floor(scrollTop() / ROW_H) - OVERSCAN))
  const end = createMemo(() => Math.min(total(), Math.ceil((scrollTop() + viewH()) / ROW_H) + OVERSCAN))
  const visMetas = createMemo(() => {
    const o = props.order
    const s = start()
    const e = end()
    const arr: SymMeta[] = []
    for (let i = s; i < e; i++) arr.push(symbols[o[i]])
    return arr
  })

  // Cap visible height so the bento widgets sit below without a huge gap.
  const bodyHeight = () => Math.min(total() * ROW_H, 9 * ROW_H)

  return (
    <div class="lb">
      <div class="thead">
        <div title="Instrument tradingsymbol and exchange segment.">Symbol</div>
        <div title="Intraday price line. Green when the last price is above the previous day's close, red when below. Grey dotted line = previous close; blue dotted line = day VWAP (above VWAP = buyers in control).">Price</div>
        <div class="num" title="Last Traded Price — the price of the most recent trade.">LTP</div>
        <div title="Day change = (LTP − previous-day close) ÷ previous close × 100. Green = up on the day, red = down — the same basis Kite/Groww show.">Chg%</div>
        <div class="num" title="Cumulative shares traded so far today (volume_traded), in K / L / Cr.">Current Volume</div>
        <div title="Relative Volume (×) = latest per-tick volume ÷ its recent average — the surge magnitude (drives alerts). Bar length = surge size; its green/red split = buyer- vs seller-initiated volume (tick rule). ▲ buying · ▼ selling.">Vol Surge · Flow</div>
        <div title="Volume velocity — per-tick traded volume over the last ~48 ticks. Taller bars mean bursts of trading.">Velocity</div>
      </div>
      <div class="tbody" ref={scroller} style={{ height: bodyHeight() + 'px', 'overflow-y': 'auto' }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div class="spacer" style={{ height: total() * ROW_H + 'px' }}>
          <For each={visMetas()}>
            {(meta, i) => <SymbolRow meta={meta} top={() => (start() + i()) * ROW_H} />}
          </For>
        </div>
      </div>
    </div>
  )
}

function SymbolRow(props: { meta: SymMeta; top: () => number }) {
  let root!: HTMLDivElement
  let ltpEl!: HTMLDivElement
  let chgEl!: HTMLSpanElement
  let volEl!: HTMLDivElement
  let surgeEl!: HTMLSpanElement
  let surgeBuy!: HTMLSpanElement
  let surgeSell!: HTMLSpanElement
  let canvas!: HTMLCanvasElement
  let priceCanvas!: HTMLCanvasElement

  const i = props.meta.idx

  onMount(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const ctx = canvas.getContext('2d')!
    const priceCtx = priceCanvas.getContext('2d')!

    // seed initial values so the first paint isn't blank
    ltpEl.textContent = fmtPrice(ltp[i])
    const c = chgPct[i]
    chgEl.textContent = (c > 0 ? '+' : '') + c.toFixed(2) + '%'
    chgEl.className = 'chg-pill ' + (c > 0.01 ? 'up' : c < -0.01 ? 'down' : 'flat')
    volEl.textContent = fmtVol(cumVol[i])
    surgeEl.textContent = rvol[i].toFixed(2) + 'x'

    const refs: RowRefs = {
      idx: i, root, ltpEl, chgEl, volEl, surgeEl, surgeBuy, surgeSell,
      ctx, canvasW: 120, canvasH: SPARK_H,
      priceCtx, priceW: 80, priceH: PRICE_H,
      lastLtp: NaN, lastVol: NaN, lastTier: -1
    }

    // Responsive canvases fill their (flexible) columns.
    const sizeCanvas = (cv: HTMLCanvasElement, cx: CanvasRenderingContext2D, h: number) => {
      const w = Math.max(40, Math.round(cv.clientWidth))
      cv.width = w * dpr
      cv.height = h * dpr
      cx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return w
    }
    const ro = new ResizeObserver(() => {
      refs.canvasW = sizeCanvas(canvas, ctx, SPARK_H)
      refs.canvasH = SPARK_H
      refs.priceW = sizeCanvas(priceCanvas, priceCtx, PRICE_H)
      refs.priceH = PRICE_H
    })
    ro.observe(canvas)
    ro.observe(priceCanvas)

    register(refs)
    onCleanup(() => {
      ro.disconnect()
      unregister(i)
    })
  })

  return (
    <div class="trow" ref={root} style={{ transform: `translateY(${props.top()}px)` }}>
      <div class="cell sym">
        <span class="sym-name">{props.meta.name}</span>
        <span class="sym-sub">Equity • {props.meta.exch}</span>
      </div>
      <div class="cell price">
        <canvas ref={priceCanvas} style={{ width: '100%', height: PRICE_H + 'px' }} />
      </div>
      <div class="cell num ltp" ref={ltpEl} />
      <div class="cell"><span class="chg-pill flat" ref={chgEl} /></div>
      <div class="cell num" ref={volEl} />
      <div class="cell surge">
        <span class="surge-val up" ref={surgeEl} />
        <span class="surge-track"><span class="surge-buy" ref={surgeBuy} /><span class="surge-sell" ref={surgeSell} /></span>
      </div>
      <div class="cell spark">
        <canvas ref={canvas} style={{ width: '100%', height: SPARK_H + 'px' }} />
      </div>
    </div>
  )
}
