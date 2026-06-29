import { For, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { symbols, ltp, chgPct, cumVol, rvol, type SymMeta } from '../store'
import { register, unregister, type RowRefs } from '../render'
import { fmtPrice, fmtVol } from '../format'

const ROW_H = 56
const OVERSCAN = 6
const SPARK_H = 30

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
        <div>Symbol</div>
        <div class="num">LTP</div>
        <div>Chg%</div>
        <div class="num">Current Volume</div>
        <div>Vol Surge (RVOL)</div>
        <div>Velocity</div>
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
  let surgeBar!: HTMLSpanElement
  let canvas!: HTMLCanvasElement

  const i = props.meta.idx

  onMount(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const ctx = canvas.getContext('2d')!

    // seed initial values so the first paint isn't blank
    ltpEl.textContent = fmtPrice(ltp[i])
    const c = chgPct[i]
    chgEl.textContent = (c > 0 ? '+' : '') + c.toFixed(2) + '%'
    chgEl.className = 'chg-pill ' + (c > 0.01 ? 'up' : c < -0.01 ? 'down' : 'flat')
    volEl.textContent = fmtVol(cumVol[i])
    surgeEl.textContent = rvol[i].toFixed(2) + 'x'

    const refs: RowRefs = {
      idx: i, root, ltpEl, chgEl, volEl, surgeEl, surgeBar,
      ctx, canvasW: 120, canvasH: SPARK_H,
      lastLtp: NaN, lastVol: NaN, lastTier: -1
    }

    // Responsive velocity sparkline: fills its (flexible) column.
    const ro = new ResizeObserver(() => {
      const w = Math.max(40, Math.round(canvas.clientWidth))
      canvas.width = w * dpr
      canvas.height = SPARK_H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      refs.canvasW = w
      refs.canvasH = SPARK_H
    })
    ro.observe(canvas)

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
      <div class="cell num ltp" ref={ltpEl} />
      <div class="cell"><span class="chg-pill flat" ref={chgEl} /></div>
      <div class="cell num" ref={volEl} />
      <div class="cell surge">
        <span class="surge-val up" ref={surgeEl} />
        <span class="surge-track"><span class="surge-bar up" ref={surgeBar} /></span>
      </div>
      <div class="cell spark">
        <canvas ref={canvas} style={{ width: '100%', height: SPARK_H + 'px' }} />
      </div>
    </div>
  )
}
